/**
 * Map generator v1 (TDD §13, GDD §3; phase-1 board task 6): seeded
 * terrace/water/resource generation with archetype shaping. Twelve archetypes
 * seed the catalog; zone/district layers stay empty (player-painted).
 *
 * Values are [TUNE] throughout — believable variety is the v1 bar, balance
 * comes with playtesting phases.
 */
import { flatTerrain, type MapFile, ResourceKind } from "@civitect/protocol";
import { fractalNoise, latticeHash } from "./noise";

export const MapArchetype = {
  terracedIsland: "terraced-island",
  riverValley: "river-valley",
  coastalBay: "coastal-bay",
  highlandPlateau: "highland-plateau",
  twinRivers: "twin-rivers",
  greatPlains: "great-plains",
  deltaMarsh: "delta-marsh",
  canyonLands: "canyon-lands",
  forestLake: "forest-lake",
  oilSands: "oil-sands",
  fjordCoast: "fjord-coast",
  volcanicCaldera: "volcanic-caldera",
} as const;
export type MapArchetype = (typeof MapArchetype)[keyof typeof MapArchetype];
type ResourceValue = (typeof ResourceKind)[keyof typeof ResourceKind];

export const MAP_ARCHETYPES: readonly MapArchetype[] = [
  MapArchetype.terracedIsland,
  MapArchetype.riverValley,
  MapArchetype.coastalBay,
  MapArchetype.highlandPlateau,
  MapArchetype.twinRivers,
  MapArchetype.greatPlains,
  MapArchetype.deltaMarsh,
  MapArchetype.canyonLands,
  MapArchetype.forestLake,
  MapArchetype.oilSands,
  MapArchetype.fjordCoast,
  MapArchetype.volcanicCaldera,
];

/** v1 catalog size [TUNE] — M maps; L (512²) arrive with perf validation. */
export const GENERATED_MAP_SIZE = 256;

const TERRACES = 7; // elevation levels 0..6, matching the renderer ramp

interface Shape {
  /** Base elevation 0-255 before terracing, per tile. */
  elevation(x: number, y: number, size: number, seed: number): number;
  /** Forced water predicate (rivers/sea), beyond low-elevation water. */
  water?(x: number, y: number, size: number, seed: number): boolean;
  /** Optional resource painter for raw industry starts (GDD §8). */
  resource?(x: number, y: number, size: number, seed: number, elevation: number): ResourceValue;
  /** Sea level in 0-255 [TUNE]; elevation below it becomes water. */
  seaLevel: number;
}

function radialFalloff(x: number, y: number, size: number): number {
  const half = size / 2;
  const dx = Math.abs(x - half);
  const dy = Math.abs(y - half);
  const d = Math.max(dx, dy);
  // Full strength to ~half radius, then a soft shoulder to the rim [TUNE].
  return Math.max(0, 255 - Math.floor((d * 220) / half));
}

/** A meandering vertical river: center column wobbles with low-freq noise. */
function riverMask(x: number, y: number, size: number, seed: number, center: number): boolean {
  const wobble = fractalNoise(seed, 0, y, 64, 2) - 128; // [-128, 127]
  const cx = center + Math.floor((wobble * size) / 1024);
  const width = 2 + (fractalNoise(seed + 7, 0, y, 32, 1) >> 6); // 2-5 tiles
  return Math.abs(x - cx) <= width;
}

/** A meandering horizontal river, used when the terrain puzzle needs crossings. */
function horizontalRiverMask(
  x: number,
  y: number,
  size: number,
  seed: number,
  center: number,
): boolean {
  const wobble = fractalNoise(seed, x, 0, 64, 2) - 128;
  const cy = center + Math.floor((wobble * size) / 1024);
  const width = 2 + (fractalNoise(seed + 11, x, 0, 32, 1) >> 6);
  return Math.abs(y - cy) <= width;
}

function ellipseMask(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): boolean {
  const dx = x - centerX;
  const dy = y - centerY;
  return (
    dx * dx * radiusY * radiusY + dy * dy * radiusX * radiusX <=
    radiusX * radiusX * radiusY * radiusY
  );
}

function defaultOre(seed: number, x: number, y: number, elevation: number): ResourceValue {
  if (elevation >= 2 && latticeHash(seed ^ 0xbeef, x, y) % 1000 < 20) {
    return ResourceKind.ore;
  }
  return ResourceKind.none;
}

const SHAPES: Readonly<Record<MapArchetype, Shape>> = {
  [MapArchetype.terracedIsland]: {
    seaLevel: 75,
    elevation: (x, y, size, seed) =>
      Math.min(255, ((fractalNoise(seed, x, y, 64, 4) * radialFalloff(x, y, size)) >> 8) + 55),
  },
  [MapArchetype.riverValley]: {
    seaLevel: 40,
    elevation: (x, y, size, seed) => {
      const base = fractalNoise(seed, x, y, 64, 4);
      const valley = Math.abs(x - size / 2) * 2; // higher away from the river
      return Math.min(255, (base >> 1) + Math.min(127, Math.floor((valley * 160) / size)));
    },
    water: (x, y, size, seed) => riverMask(x, y, size, seed, Math.floor(size / 2)),
  },
  [MapArchetype.coastalBay]: {
    seaLevel: 90,
    elevation: (x, y, size, seed) => {
      // Land rises to the northwest; a noisy diagonal coast cuts the SE.
      const coast = (size - x + (size - y)) * 0.5;
      const base = fractalNoise(seed, x, y, 48, 4);
      return Math.min(255, Math.floor((coast * 220) / size) + (base >> 2));
    },
  },
  [MapArchetype.highlandPlateau]: {
    seaLevel: 30,
    elevation: (x, y, _size, seed) => {
      const base = fractalNoise(seed, x, y, 96, 3);
      // Push mid-values up into a plateau band, keep ravines.
      return base > 100 ? Math.min(255, 150 + (base >> 2)) : base;
    },
    // A gorge river cuts the plateau — highlands without water aren't maps.
    water: (x, y, size, seed) => riverMask(x, y, size, seed + 31, Math.floor(size / 4)),
  },
  [MapArchetype.twinRivers]: {
    seaLevel: 40,
    elevation: (x, y, _size, seed) => fractalNoise(seed, x, y, 72, 4),
    water: (x, y, size, seed) =>
      riverMask(x, y, size, seed, Math.floor(size / 3)) ||
      riverMask(x, y, size, seed + 1013, Math.floor((2 * size) / 3)),
  },
  [MapArchetype.greatPlains]: {
    seaLevel: 25,
    elevation: (x, y, _size, seed) => 60 + (fractalNoise(seed, x, y, 128, 3) >> 2),
    // The lazy prairie river every plains map deserves.
    water: (x, y, size, seed) => riverMask(x, y, size, seed + 47, Math.floor(size / 2)),
  },
  [MapArchetype.deltaMarsh]: {
    seaLevel: 72,
    elevation: (x, y, size, seed) => {
      const northRise = Math.floor(((size - y) * 105) / size);
      return 55 + northRise + (fractalNoise(seed, x, y, 72, 3) >> 3);
    },
    water: (x, y, size, seed) =>
      y > (size * 9) / 10 ||
      riverMask(x, y, size, seed + 131, Math.floor(size / 3)) ||
      riverMask(x, y, size, seed + 197, Math.floor((2 * size) / 3)),
    resource: (x, y, _size, seed, elevation) =>
      elevation <= 2 && latticeHash(seed ^ 0xf00d, x, y) % 1000 < 90
        ? ResourceKind.farm
        : ResourceKind.none,
  },
  [MapArchetype.canyonLands]: {
    seaLevel: 24,
    elevation: (x, y, size, seed) => {
      const ridge = Math.min(Math.abs(x - size / 2), Math.abs(y - size / 2));
      return Math.min(
        255,
        105 + Math.floor((ridge * 130) / size) + (fractalNoise(seed, x, y, 48, 4) >> 2),
      );
    },
    water: (x, y, size, seed) =>
      horizontalRiverMask(x, y, size, seed + 313, Math.floor(size / 2)) ||
      riverMask(x, y, size, seed + 337, Math.floor(size / 2)),
    resource: (x, y, _size, seed, elevation) =>
      elevation >= 3 && latticeHash(seed ^ 0xcafe, x, y) % 1000 < 45
        ? ResourceKind.ore
        : ResourceKind.none,
  },
  [MapArchetype.forestLake]: {
    seaLevel: 50,
    elevation: (x, y, size, seed) =>
      72 + (fractalNoise(seed, x, y, 80, 4) >> 1) + Math.floor(radialFalloff(x, y, size) / 8),
    water: (x, y, size, seed) =>
      ellipseMask(x, y, size / 2, size / 2, size / 7, size / 9) ||
      riverMask(x, y, size, seed + 419, Math.floor(size / 2)),
    resource: (x, y, _size, seed, elevation) =>
      elevation >= 1 && elevation <= 4 && latticeHash(seed ^ 0x5eed, x, y) % 1000 < 70
        ? ResourceKind.forest
        : ResourceKind.none,
  },
  [MapArchetype.oilSands]: {
    seaLevel: 45,
    elevation: (x, y, _size, seed) => 48 + (fractalNoise(seed, x, y, 96, 4) >> 1),
    water: (x, y, size, seed) => riverMask(x, y, size, seed + 541, Math.floor((3 * size) / 5)),
    resource: (x, y, _size, seed, elevation) =>
      elevation <= 3 &&
      fractalNoise(seed + 577, x, y, 40, 2) > 176 &&
      latticeHash(seed ^ 0x011, x, y) % 1000 < 120
        ? ResourceKind.oil
        : ResourceKind.none,
  },
  [MapArchetype.fjordCoast]: {
    seaLevel: 98,
    elevation: (x, y, size, seed) => {
      const eastRise = Math.floor((x * 170) / size);
      return Math.min(255, 45 + eastRise + (fractalNoise(seed, x, y, 56, 4) >> 1));
    },
    water: (x, y, size, seed) => {
      if (x < size / 10) {
        return true;
      }
      const inletA = Math.abs(y - size / 3) < 8 + (fractalNoise(seed + 601, x, 0, 48, 1) >> 5);
      const inletB =
        Math.abs(y - (2 * size) / 3) < 6 + (fractalNoise(seed + 607, x, 0, 48, 1) >> 5);
      return (inletA || inletB) && x < size / 2;
    },
    resource: (x, y, _size, seed, elevation) => {
      if (elevation >= 4 && latticeHash(seed ^ 0x612, x, y) % 1000 < 35) {
        return ResourceKind.ore;
      }
      return elevation >= 2 && latticeHash(seed ^ 0x613, x, y) % 1000 < 35
        ? ResourceKind.forest
        : ResourceKind.none;
    },
  },
  [MapArchetype.volcanicCaldera]: {
    seaLevel: 70,
    elevation: (x, y, size, seed) => {
      const half = size / 2;
      const dx = Math.abs(x - half);
      const dy = Math.abs(y - half);
      const ring = Math.max(dx, dy);
      const centerRise = Math.abs(ring - size / 4);
      return Math.min(
        255,
        62 + Math.floor((centerRise * 260) / size) + (fractalNoise(seed, x, y, 32, 3) >> 2),
      );
    },
    water: (x, y, size, seed) =>
      ellipseMask(x, y, size / 2, size / 2, size / 10, size / 10) ||
      riverMask(x, y, size, seed + 701, Math.floor(size / 2)),
    resource: (x, y, _size, seed, elevation) => {
      if (elevation >= 3 && latticeHash(seed ^ 0x701, x, y) % 1000 < 45) {
        return ResourceKind.ore;
      }
      return elevation <= 2 && latticeHash(seed ^ 0x702, x, y) % 1000 < 25
        ? ResourceKind.oil
        : ResourceKind.none;
    },
  },
};

/** Deterministic map id per archetype (catalog order, 1-based). */
export function archetypeMapId(archetype: MapArchetype): number {
  return MAP_ARCHETYPES.indexOf(archetype) + 1;
}

export function generateMap(
  archetype: MapArchetype,
  seed: number,
  size = GENERATED_MAP_SIZE,
): MapFile {
  const shape = SHAPES[archetype];
  const terrain = flatTerrain(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const raw = shape.elevation(x, y, size, seed);
      const isWater = raw < shape.seaLevel || (shape.water?.(x, y, size, seed) ?? false);
      if (isWater) {
        terrain.layers.water[i] = 1;
        terrain.layers.elevation[i] = 0;
      } else {
        // Terrace the land portion of the range into 0..TERRACES-1.
        const land = raw - shape.seaLevel;
        const span = 256 - shape.seaLevel;
        terrain.layers.elevation[i] = Math.min(TERRACES - 1, Math.floor((land * TERRACES) / span));
        terrain.layers.resource[i] =
          shape.resource?.(x, y, size, seed, terrain.layers.elevation[i] as number) ??
          defaultOre(seed, x, y, terrain.layers.elevation[i] as number);
      }
    }
  }
  return { mapId: archetypeMapId(archetype), generatorSeed: seed, terrain };
}

/** The v1 catalog: one map per archetype, seeds fixed for reproducibility. */
export const CATALOG_SEEDS: Readonly<Record<MapArchetype, number>> = {
  [MapArchetype.terracedIsland]: 101,
  [MapArchetype.riverValley]: 202,
  [MapArchetype.coastalBay]: 303,
  [MapArchetype.highlandPlateau]: 404,
  [MapArchetype.twinRivers]: 505,
  [MapArchetype.greatPlains]: 606,
  [MapArchetype.deltaMarsh]: 707,
  [MapArchetype.canyonLands]: 808,
  [MapArchetype.forestLake]: 909,
  [MapArchetype.oilSands]: 1010,
  [MapArchetype.fjordCoast]: 1111,
  [MapArchetype.volcanicCaldera]: 1212,
};
