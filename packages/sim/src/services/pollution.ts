/**
 * Pollution v1 (GDD §10, board phase-4 task 4).
 *
 * Four fields, two natures:
 * - GROUND: canonical (hashed, save v7) — industry/landfill legacy that
 *   accrues at sources and decays over days. The only pollution that
 *   persists when its source is gone.
 * - AIR / NOISE / WATER: derived, cache-fenced — recomputed from live
 *   sources (industry kernels + traffic volumes; sewage outlets flowing
 *   downstream) whenever buildings/roads/volumes move. Values are pure
 *   functions of canonical state, so they can never desync a loaded world.
 *
 * The headline event (GDD §10): a water pump drinking from polluted water
 * triggers a CITYWIDE sickness multiplier with a three-link cause chain —
 * outlet → polluted intake tile → pump. Dramatic, diagnosable, classic.
 */
import { BuildingKind, ZoneKind } from "@civitect/protocol";
import { type Buildings, PLOPPABLE_KIND_OFFSET } from "../growth/buildings";
import { fnv1a64 } from "../hash";
import { supercoverTiles } from "../roads/geometry";
import type { RoadGraph } from "../roads/graph";
import type { TrafficCore } from "../traffic/solver";

// ── rates, all [TUNE] ──────────────────────────────────────────────────────
/** Ground pollution added per industry building per day (at its tile). */
export const GROUND_PER_INDUSTRY_DAY = 3;
/** Ground pollution per landfill per day, per 10k units of fill. */
export const GROUND_PER_LANDFILL_10K_DAY = 4;
/** Ground decays 1 point every N days (slow legacy — GDD §10). */
export const GROUND_DECAY_DAYS = 4;
/** Air kernel radius (tiles) and per-level source strength. */
export const AIR_RADIUS = 6;
export const AIR_PER_INDUSTRY_LEVEL = 40;
export const AIR_PER_INCINERATOR = 80;
export const AIR_PER_POWER_PLANT = 60;
/** Map wind: constant +x drift, in tiles (wind maps join with map-gen v2). */
export const WIND_DRIFT_X = 1;
/** Air added per 100 vehicles of edge volume, at the edge's tiles. */
export const AIR_PER_100_VOLUME = 6;
/** Noise kernel radius and sources. */
export const NOISE_RADIUS = 3;
export const NOISE_PER_100_VOLUME = 14;
export const NOISE_PER_INDUSTRY_LEVEL = 25;
/** Water pollution seeded at an outlet and its downstream decay per tile. */
export const WATER_AT_OUTLET = 200;
export const WATER_DECAY_PER_TILE = 4;
/** Sewage demand per occupied building per level (capacity units). */
export const SEWAGE_PER_LEVEL = 2;
/** Sickness multipliers (added permille of residents per day). */
export const SICK_PER_64_AIR = 1;
export const SICK_PER_64_GROUND = 1;
export const SICK_WATER_CRISIS = 8;

export interface PollutionInputs {
  readonly buildings: Buildings;
  readonly roads: RoadGraph;
  readonly traffic: TrafficCore;
  readonly waterLayer: Uint16Array;
  readonly elevation: Uint16Array;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

function stamp(
  field: Uint16Array,
  cx: number,
  cy: number,
  strength: number,
  radius: number,
  mapWidth: number,
  mapHeight: number,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= mapHeight) {
      continue;
    }
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= mapWidth) {
        continue;
      }
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const add = Math.floor((strength * (radius + 1 - dist)) / (radius + 1));
      if (add > 0) {
        const at = y * mapWidth + x;
        field[at] = Math.min(0xffff, (field[at] as number) + add);
      }
    }
  }
}

/** Clamp a u16 working field down to the u8 wire/inspector domain. */
function toU8(field: Uint16Array): Uint8Array {
  const out = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) {
    out[i] = Math.min(255, field[i] as number);
  }
  return out;
}

/**
 * AIR: industry/incinerator/power kernels (wind-drifted) + traffic volume
 * along edge supercovers. Derived — pure function of canonical state.
 */
export function computeAirField(inputs: PollutionInputs): Uint8Array {
  const { buildings: b, roads: g, traffic, mapWidth, mapHeight } = inputs;
  const work = new Uint16Array(mapWidth * mapHeight);
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = b.kind[i] as number;
    const tile = b.tileIdx[i] as number;
    const cx = (tile % mapWidth) + WIND_DRIFT_X;
    const cy = Math.floor(tile / mapWidth);
    let strength = 0;
    if (kind === ZoneKind.industrial) {
      strength = AIR_PER_INDUSTRY_LEVEL * (b.level[i] as number);
    } else if (kind === PLOPPABLE_KIND_OFFSET + BuildingKind.incinerator) {
      strength = AIR_PER_INCINERATOR;
    } else if (kind === PLOPPABLE_KIND_OFFSET + BuildingKind.powerPlant) {
      strength = AIR_PER_POWER_PLANT;
    }
    if (strength > 0) {
      stamp(work, cx, cy, strength, AIR_RADIUS, mapWidth, mapHeight);
    }
  }
  // Traffic exhaust: volumes live on canonical edge identity; the live
  // mirror is value-stable, so reading per live slot is order-safe.
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const volume = traffic.volumes[e] as number;
    if (volume < 100) {
      continue;
    }
    const add = Math.floor((volume / 100) * AIR_PER_100_VOLUME);
    const a = g.edgeA[e] as number;
    const bn = g.edgeB[e] as number;
    for (const t of supercoverTiles(
      g.nodeX[a] as number,
      g.nodeY[a] as number,
      g.nodeX[bn] as number,
      g.nodeY[bn] as number,
    )) {
      const at = t.y * mapWidth + t.x + WIND_DRIFT_X;
      if (at < mapWidth * mapHeight) {
        work[at] = Math.min(0xffff, (work[at] as number) + add);
      }
    }
  }
  return toU8(work);
}

/** NOISE: road volume/class along supercovers + industry hum. Derived. */
export function computeNoiseField(inputs: PollutionInputs): Uint8Array {
  const { buildings: b, roads: g, traffic, mapWidth, mapHeight } = inputs;
  const work = new Uint16Array(mapWidth * mapHeight);
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const volume = traffic.volumes[e] as number;
    if (volume < 50) {
      continue;
    }
    const add = Math.floor((volume / 100) * NOISE_PER_100_VOLUME);
    const a = g.edgeA[e] as number;
    const bn = g.edgeB[e] as number;
    for (const t of supercoverTiles(
      g.nodeX[a] as number,
      g.nodeY[a] as number,
      g.nodeX[bn] as number,
      g.nodeY[bn] as number,
    )) {
      stamp(work, t.x, t.y, add, 1, mapWidth, mapHeight);
    }
  }
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1 || (b.kind[i] as number) !== ZoneKind.industrial) {
      continue;
    }
    const tile = b.tileIdx[i] as number;
    stamp(
      work,
      tile % mapWidth,
      Math.floor(tile / mapWidth),
      NOISE_PER_INDUSTRY_LEVEL * (b.level[i] as number),
      NOISE_RADIUS,
      mapWidth,
      mapHeight,
    );
  }
  return toU8(work);
}

/**
 * WATER: sewage outlets seed pollution into their nearest water tile; it
 * flows DOWNSTREAM — to 4-connected water neighbors of equal-or-lower
 * elevation — decaying per tile. Deterministic BFS in tile-index order.
 */
export function computeWaterField(inputs: PollutionInputs): Uint8Array {
  const { buildings: b, waterLayer, elevation, mapWidth, mapHeight } = inputs;
  const out = new Uint8Array(mapWidth * mapHeight);
  const seeds: { tile: number; strength: number }[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = (b.kind[i] as number) - PLOPPABLE_KIND_OFFSET;
    if (kind !== BuildingKind.sewageOutlet) {
      continue;
    }
    const tile = b.tileIdx[i] as number;
    // Nearest water tile within a small ring (outlets pipe a short way).
    const x = tile % mapWidth;
    const y = Math.floor(tile / mapWidth);
    let found = -1;
    for (let radius = 1; radius <= 4 && found === -1; radius++) {
      for (let dy = -radius; dy <= radius && found === -1; dy++) {
        for (let dx = -radius; dx <= radius && found === -1; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) {
            continue;
          }
          if ((waterLayer[ny * mapWidth + nx] as number) !== 0) {
            found = ny * mapWidth + nx;
          }
        }
      }
    }
    if (found !== -1) {
      seeds.push({ tile: found, strength: WATER_AT_OUTLET });
    }
  }
  // Downstream spread: per seed, BFS over water tiles never climbing
  // elevation; each tile keeps the max arriving pollution.
  for (const seed of seeds) {
    const queue: { tile: number; strength: number }[] = [seed];
    const seen = new Set<number>([seed.tile]);
    while (queue.length > 0) {
      const { tile, strength } = queue.shift() as { tile: number; strength: number };
      if (strength > (out[tile] as number)) {
        out[tile] = Math.min(255, strength);
      }
      const next = strength - WATER_DECAY_PER_TILE;
      if (next <= 0) {
        continue;
      }
      const x = tile % mapWidth;
      const y = Math.floor(tile / mapWidth);
      // Fixed neighbor order (N, W, E, S → ascending tile index).
      const neighbors = [tile - mapWidth, tile - 1, tile + 1, tile + mapWidth];
      for (const n of neighbors) {
        if (n < 0 || n >= out.length || seen.has(n)) {
          continue;
        }
        const nx = n % mapWidth;
        if (Math.abs(nx - x) > 1) {
          continue; // row wrap
        }
        if ((inputs.waterLayer[n] as number) === 0) {
          continue;
        }
        if ((elevation[n] as number) > (elevation[tile] as number)) {
          continue; // water does not flow uphill
        }
        seen.add(n);
        queue.push({ tile: n, strength: next });
      }
    }
  }
  return out;
}

/**
 * The pump crisis (GDD §10): any water pump whose intake ring touches
 * polluted water poisons the whole grid — citywide sickness multiplier +
 * a 3-link cause chain. Returns the first offending pump (canonical
 * order) or null.
 */
export function findPumpCrisis(
  inputs: PollutionInputs,
  waterField: Uint8Array,
): { pumpTile: number; intakeTile: number } | null {
  const { buildings: b, mapWidth, mapHeight } = inputs;
  // Canonical (tile) order so built and loaded worlds agree on "first".
  const pumps: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (
      b.alive[i] === 1 &&
      (b.kind[i] as number) === PLOPPABLE_KIND_OFFSET + BuildingKind.waterPump
    ) {
      pumps.push(b.tileIdx[i] as number);
    }
  }
  pumps.sort((p, q) => p - q);
  for (const pumpTile of pumps) {
    const x = pumpTile % mapWidth;
    const y = Math.floor(pumpTile / mapWidth);
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) {
          continue;
        }
        const at = ny * mapWidth + nx;
        if ((waterField[at] as number) > 0) {
          return { pumpTile, intakeTile: at };
        }
      }
    }
  }
  return null;
}

/** Sewage adequacy: demand vs treatment/outlet capacity (city-wide v1). */
export function sewageBalance(b: Buildings): { demand: number; capacity: number } {
  let demand = 0;
  let capacity = 0;
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind < PLOPPABLE_KIND_OFFSET) {
      demand += SEWAGE_PER_LEVEL * (b.level[i] as number);
    } else {
      const plop = kind - PLOPPABLE_KIND_OFFSET;
      if (plop === BuildingKind.sewageOutlet || plop === BuildingKind.sewageTreatment) {
        capacity += 8000;
      }
    }
  }
  return { demand, capacity };
}

/** Derived-field cache (coverage-cache pattern; content digest for wire). */
export interface PollutionCache {
  fenceKey: string;
  air: Uint8Array | null;
  noise: Uint8Array | null;
  water: Uint8Array | null;
  crisis: { pumpTile: number; intakeTile: number } | null | undefined;
  digests: Map<string, number>;
}

export function createPollutionCache(): PollutionCache {
  return {
    fenceKey: "",
    air: null,
    noise: null,
    water: null,
    crisis: undefined,
    digests: new Map(),
  };
}

function refresh(cache: PollutionCache, fenceKey: string): void {
  if (cache.fenceKey !== fenceKey) {
    cache.fenceKey = fenceKey;
    cache.air = null;
    cache.noise = null;
    cache.water = null;
    cache.crisis = undefined;
    cache.digests.clear();
  }
}

export function airFor(cache: PollutionCache, inputs: PollutionInputs, fence: string): Uint8Array {
  refresh(cache, fence);
  if (cache.air === null) {
    cache.air = computeAirField(inputs);
  }
  return cache.air;
}

export function noiseFor(
  cache: PollutionCache,
  inputs: PollutionInputs,
  fence: string,
): Uint8Array {
  refresh(cache, fence);
  if (cache.noise === null) {
    cache.noise = computeNoiseField(inputs);
  }
  return cache.noise;
}

export function waterFor(
  cache: PollutionCache,
  inputs: PollutionInputs,
  fence: string,
): Uint8Array {
  refresh(cache, fence);
  if (cache.water === null) {
    cache.water = computeWaterField(inputs);
  }
  return cache.water;
}

export function crisisFor(
  cache: PollutionCache,
  inputs: PollutionInputs,
  fence: string,
): { pumpTile: number; intakeTile: number } | null {
  refresh(cache, fence);
  if (cache.crisis === undefined) {
    cache.crisis = findPumpCrisis(inputs, waterFor(cache, inputs, fence));
  }
  return cache.crisis;
}

/** Content digest of a derived field (overlay wire version, u32). */
export function fieldDigestU32(cache: PollutionCache, name: string, field: Uint8Array): number {
  let d = cache.digests.get(name);
  if (d === undefined) {
    d = Number.parseInt(fnv1a64(field).slice(0, 8), 16);
    cache.digests.set(name, d);
  }
  return d;
}
