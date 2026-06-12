/**
 * TERRAIN section codec (TDD §5/§10): five u16 tile layers — elevation
 * terrace, water, resource, zone, district — RLE-encoded per layer
 * (TDD §10 names RLE for terrain; deflate on the container squeezes the
 * rest). Layer ids are append-only wire ids.
 *
 * One RLE stream spans the whole layer (rows are not a codec concept) —
 * flat worlds collapse to a handful of runs regardless of map size.
 */
import type { ByteReader } from "../bytes/reader";
import type { ByteWriter } from "../bytes/writer";
import { DecodeError, EncodeError } from "../errors";

export const TerrainLayerId = {
  elevation: 1,
  water: 2,
  resource: 3,
  zone: 4,
  district: 5,
} as const;
export type TerrainLayerId = (typeof TerrainLayerId)[keyof typeof TerrainLayerId];

export const TERRAIN_LAYER_NAMES = ["elevation", "water", "resource", "zone", "district"] as const;
export type TerrainLayerName = (typeof TERRAIN_LAYER_NAMES)[number];

export interface TerrainGrid {
  readonly width: number;
  readonly height: number;
  /** Each layer is width×height u16, row-major. */
  readonly layers: Readonly<Record<TerrainLayerName, Uint16Array>>;
}

/** All-zero grid — the Phase 0 "flat world" and the migration filler (ADR-010). */
export function flatTerrain(width: number, height: number): TerrainGrid {
  const make = (): Uint16Array => new Uint16Array(width * height);
  return {
    width,
    height,
    layers: {
      elevation: make(),
      water: make(),
      resource: make(),
      zone: make(),
      district: make(),
    },
  };
}

const MAX_RUN = 0xffff;

function encodeLayer(w: ByteWriter, cells: Uint16Array): void {
  // Run count patched after the scan — single pass, no intermediate arrays.
  const countAt = w.length;
  w.u32(0);
  let runs = 0;
  let i = 0;
  while (i < cells.length) {
    const value = cells[i] as number;
    let length = 1;
    while (i + length < cells.length && cells[i + length] === value && length < MAX_RUN) {
      length++;
    }
    w.u16(length).u16(value);
    runs++;
    i += length;
  }
  w.patchU32(countAt, runs);
}

function decodeLayer(r: ByteReader, cellCount: number, layer: string): Uint16Array {
  const runs = r.u32();
  const cells = new Uint16Array(cellCount);
  let at = 0;
  for (let run = 0; run < runs; run++) {
    const length = r.u16();
    const value = r.u16();
    if (length === 0) {
      throw new DecodeError(`terrain layer ${layer}: zero-length RLE run`);
    }
    if (at + length > cellCount) {
      throw new DecodeError(`terrain layer ${layer}: runs overflow ${cellCount} cells`);
    }
    cells.fill(value, at, at + length);
    at += length;
  }
  if (at !== cellCount) {
    throw new DecodeError(`terrain layer ${layer}: runs cover ${at} of ${cellCount} cells`);
  }
  return cells;
}

export function encodeTerrainSection(grid: TerrainGrid, w: ByteWriter): void {
  const cellCount = grid.width * grid.height;
  if (grid.width < 1 || grid.height < 1 || grid.width > 0xffff || grid.height > 0xffff) {
    throw new EncodeError(`terrain dims ${grid.width}×${grid.height} out of u16 range`);
  }
  w.u16(grid.width).u16(grid.height).u8(TERRAIN_LAYER_NAMES.length);
  for (const name of TERRAIN_LAYER_NAMES) {
    const cells = grid.layers[name];
    if (cells.length !== cellCount) {
      throw new EncodeError(
        `terrain layer ${name} has ${cells.length} cells, grid wants ${cellCount}`,
      );
    }
    w.u8(TerrainLayerId[name]);
    encodeLayer(w, cells);
  }
}

export function decodeTerrainSection(r: ByteReader): TerrainGrid {
  const width = r.u16();
  const height = r.u16();
  if (width < 1 || height < 1) {
    throw new DecodeError(`terrain dims ${width}×${height} invalid`);
  }
  const layerCount = r.u8();
  if (layerCount !== TERRAIN_LAYER_NAMES.length) {
    throw new DecodeError(
      `terrain carries ${layerCount} layers, this build expects ${TERRAIN_LAYER_NAMES.length}`,
    );
  }
  const cellCount = width * height;
  const layers = {} as Record<TerrainLayerName, Uint16Array>;
  for (const name of TERRAIN_LAYER_NAMES) {
    const id = r.u8();
    if (id !== TerrainLayerId[name]) {
      throw new DecodeError(
        `terrain layer order: expected ${name} (${TerrainLayerId[name]}), got id ${id}`,
      );
    }
    layers[name] = decodeLayer(r, cellCount, name);
  }
  return { width, height, layers };
}
