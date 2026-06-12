/**
 * Map generator v1 (TDD §13, GDD §3; phase-1 board task 6): seeded
 * terrace/water/resource generation with archetype shaping. Six archetypes
 * seed the catalog; zone/district layers stay empty (player-painted).
 *
 * Values are [TUNE] throughout — believable variety is the v1 bar, balance
 * comes with playtesting phases.
 */
import { flatTerrain, type MapFile } from "@civitect/protocol";
import { fractalNoise, latticeHash } from "./noise";

export const MapArchetype = {
  terracedIsland: "terraced-island",
  riverValley: "river-valley",
  coastalBay: "coastal-bay",
  highlandPlateau: "highland-plateau",
  twinRivers: "twin-rivers",
  greatPlains: "great-plains",
} as const;
export type MapArchetype = (typeof MapArchetype)[keyof typeof MapArchetype];

export const MAP_ARCHETYPES: readonly MapArchetype[] = [
  MapArchetype.terracedIsland,
  MapArchetype.riverValley,
  MapArchetype.coastalBay,
  MapArchetype.highlandPlateau,
  MapArchetype.twinRivers,
  MapArchetype.greatPlains,
];

/** v1 catalog size [TUNE] — M maps; L (512²) arrive with perf validation. */
export const GENERATED_MAP_SIZE = 256;

const TERRACES = 7; // elevation levels 0..6, matching the renderer ramp

interface Shape {
  /** Base elevation 0-255 before terracing, per tile. */
  elevation(x: number, y: number, size: number, seed: number): number;
  /** Forced water predicate (rivers/sea), beyond low-elevation water. */
  water?(x: number, y: number, size: number, seed: number): boolean;
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
        // Sparse ore veins on mid-high ground [TUNE: ~2% of land tiles].
        if (terrain.layers.elevation[i] >= 2 && latticeHash(seed ^ 0xbeef, x, y) % 1000 < 20) {
          terrain.layers.resource[i] = 1;
        }
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
};
