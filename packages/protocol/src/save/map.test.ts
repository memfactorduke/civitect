/**
 * Phase 1 task 1 verification: terrain RLE + map round-trip properties,
 * plus the archived map fixture (same forever-loading contract as saves).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ByteReader } from "../bytes/reader";
import { ByteWriter } from "../bytes/writer";
import { DecodeError } from "../errors";
import { decodeMap, encodeMap, type MapFile } from "./map";
import {
  decodeTerrainSection,
  encodeTerrainSection,
  flatTerrain,
  TERRAIN_LAYER_NAMES,
  type TerrainGrid,
} from "./terrain";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "maps");
const V1_PATH = join(FIXTURES_DIR, "v1", "terraced-island-64.civmap");

/** Runs-biased cell generator — real terrain is runs, and runs stress RLE. */
const layerArb = (cells: number): fc.Arbitrary<Uint16Array> =>
  fc
    .array(
      fc.record({
        length: fc.integer({ min: 1, max: Math.max(1, cells) }),
        value: fc.integer({ min: 0, max: 0xffff }),
      }),
      { minLength: 1, maxLength: 24 },
    )
    .map((runs) => {
      const out = new Uint16Array(cells);
      let at = 0;
      for (const run of runs) {
        if (at >= cells) break;
        out.fill(run.value, at, Math.min(cells, at + run.length));
        at += run.length;
      }
      return out;
    });

const terrainArb: fc.Arbitrary<TerrainGrid> = fc
  .record({
    width: fc.integer({ min: 1, max: 48 }),
    height: fc.integer({ min: 1, max: 48 }),
  })
  .chain(({ width, height }) =>
    fc
      .tuple(...TERRAIN_LAYER_NAMES.map(() => layerArb(width * height)))
      .map(([elevation, water, resource, zone, district]) => ({
        width,
        height,
        layers: {
          elevation: elevation as Uint16Array,
          water: water as Uint16Array,
          resource: resource as Uint16Array,
          zone: zone as Uint16Array,
          district: district as Uint16Array,
        },
      })),
  );

function roundTripSection(grid: TerrainGrid): TerrainGrid {
  const w = new ByteWriter();
  encodeTerrainSection(grid, w);
  const r = new ByteReader(w.finish());
  const decoded = decodeTerrainSection(r);
  r.expectEnd();
  return decoded;
}

describe("terrain RLE section (TDD §5/§10)", () => {
  it("encode∘decode is identity (property)", () => {
    fc.assert(
      fc.property(terrainArb, (grid) => {
        expect(roundTripSection(grid)).toEqual(grid);
      }),
      { numRuns: 60 },
    );
  });

  it("survives the RLE worst case (alternating values)", () => {
    const grid = flatTerrain(16, 16);
    for (let i = 0; i < 256; i++) {
      grid.layers.elevation[i] = i % 2;
    }
    expect(roundTripSection(grid)).toEqual(grid);
  });

  it("flat layers collapse to one run regardless of size", () => {
    const w = new ByteWriter();
    encodeTerrainSection(flatTerrain(64, 64), w);
    // 5 layers × (id 1 + count 4 + one run 4) + dims/count header 5 = 50.
    expect(w.finish().length).toBe(50);
  });

  it("rejects truncated runs instead of inventing tiles", () => {
    const grid = flatTerrain(4, 4);
    const w = new ByteWriter();
    encodeTerrainSection(grid, w);
    const bytes = w.finish();
    const r = new ByteReader(bytes.subarray(0, bytes.length - 3));
    expect(() => decodeTerrainSection(r)).toThrow(DecodeError);
  });
});

describe("map files (.civmap)", () => {
  it("encode∘decode is identity (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        terrainArb,
        fc.nat({ max: 0xffff }),
        fc.maxSafeNat(),
        async (terrain, mapId, generatorSeed) => {
          const map: MapFile = { mapId, generatorSeed, terrain };
          expect(await decodeMap(await encodeMap(map))).toEqual(map);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("rejects saves posing as maps", async () => {
    // A real save (worldCore+tail) must not decode as a map.
    const { encodeCiv, SAVE_FORMAT_VERSION } = await import("./civ");
    const save = await encodeCiv({
      header: {
        formatVersion: SAVE_FORMAT_VERSION,
        simVersion: 1,
        seed: 1,
        tick: 1,
        mapId: 0,
        flags: 0,
      },
      terrain: flatTerrain(8, 8),
      roads: [],
      buildings: [],
      cohorts: new Uint16Array(0),
      traffic: {
        msaK: 0,
        generated: 0,
        assigned: 0,
        walked: 0,
        unroutable: 0,
        volumes: new Uint32Array(0),
        job: null,
      },
      services: {
        budgetsPermille: new Uint16Array(9).fill(1000),
        groundPollution: new Uint8Array(0),
      },
      economy: {
        taxRatesPermille: new Uint16Array(6).fill(90),
        loans: [],
        monthAccumCents: new Array(13).fill(0),
        lastMonthCents: new Array(13).fill(0),
        milestoneIndex: 0,
        achievements: new Uint8Array(8),
        uniquesMask: 0,
        difficulty: 1,
        receivership: 0,
        bailoutUsed: 0,
      },
      chain: {
        shipments: [],
        produced: new Uint32Array(6),
        consumed: new Uint32Array(6),
        imported: new Uint32Array(6),
        exported: new Uint32Array(6),
        lost: new Uint32Array(6),
      },
      districts: { districts: [], ordinanceMask: 0 },
      pins: [],
      worldCore: {
        speed: 1,
        selectedTileIdx: -1,
        mapWidth: 8,
        mapHeight: 8,
        fundsCents: 0,
        population: 0,
        rngStreams: [],
      },
      commandTail: [],
    });
    // v2 saves DO carry TERRAIN — the section-count check is what rejects them.
    await expect(decodeMap(save)).rejects.toThrow(/wants exactly TERRAIN/);
  });
});

describe("map fixture archive (ADR-010 contract extends to maps)", () => {
  function fixtureMap(): MapFile {
    // A deterministic 64×64 terraced island: elevation rings, water at the
    // rim, a resource vein — fixed by formula, not by generator (the
    // generator is board task 6; this is a format contract).
    const terrain = flatTerrain(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = y * 64 + x;
        const d = Math.max(Math.abs(x - 32), Math.abs(y - 32));
        terrain.layers.elevation[i] = d < 28 ? Math.max(0, 6 - (d >> 2)) : 0;
        terrain.layers.water[i] = d >= 28 ? 1 : 0;
        terrain.layers.resource[i] = x > 40 && x < 48 && y > 10 && y < 14 ? 1 : 0;
      }
    }
    return { mapId: 1, generatorSeed: 777, terrain };
  }

  if (process.env.SEED_FIXTURES === "1" && !existsSync(V1_PATH)) {
    it("seeds the v1 map fixture (first time only)", async () => {
      mkdirSync(dirname(V1_PATH), { recursive: true });
      writeFileSync(V1_PATH, await encodeMap(fixtureMap()));
      expect(existsSync(V1_PATH)).toBe(true);
    });
  }

  it("v1 map fixture decodes to its archived terrain, bit-faithfully", async () => {
    if (!existsSync(V1_PATH)) {
      throw new Error(`fixture missing: ${V1_PATH} — run SEED_FIXTURES=1 pnpm test and commit`);
    }
    const decoded = await decodeMap(new Uint8Array(readFileSync(V1_PATH)));
    expect(decoded).toEqual(fixtureMap());
  });
});
