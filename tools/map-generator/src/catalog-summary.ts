import type { MapFile } from "@civitect/protocol";
import {
  CATALOG_SEEDS,
  GENERATED_MAP_SIZE,
  generateMap,
  MAP_ARCHETYPES,
  type MapArchetype,
} from "./generate";

export type MapWaterProfile = "low-water" | "balanced-water" | "water-heavy";
export type MapResourceProfile = "sparse-resources" | "resource-rich";
export type MapReliefProfile = "flat" | "rolling" | "steep";
export type MapDifficulty = "gentle" | "standard" | "demanding";

export interface MapCatalogSummary {
  readonly archetype: MapArchetype;
  readonly mapId: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly landTiles: number;
  readonly waterTiles: number;
  readonly resourceTiles: number;
  readonly maxElevation: number;
  readonly waterPermille: number;
  readonly resourcePermille: number;
  readonly relief: MapReliefProfile;
  readonly waterProfile: MapWaterProfile;
  readonly resourceProfile: MapResourceProfile;
  readonly difficulty: MapDifficulty;
  readonly tags: readonly string[];
}

interface TerrainScan {
  readonly landTiles: number;
  readonly waterTiles: number;
  readonly resourceTiles: number;
  readonly maxElevation: number;
}

function permille(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value * 1000) / total);
}

function scanMap(map: MapFile): TerrainScan {
  const { elevation, resource, water } = map.terrain.layers;
  let landTiles = 0;
  let waterTiles = 0;
  let resourceTiles = 0;
  let maxElevation = 0;

  for (let i = 0; i < water.length; i++) {
    if ((water[i] as number) !== 0) {
      waterTiles++;
      continue;
    }

    landTiles++;
    if ((resource[i] as number) !== 0) {
      resourceTiles++;
    }
    if ((elevation[i] as number) > maxElevation) {
      maxElevation = elevation[i] as number;
    }
  }

  return { landTiles, maxElevation, resourceTiles, waterTiles };
}

function reliefFor(maxElevation: number): MapReliefProfile {
  if (maxElevation <= 2) {
    return "flat";
  }
  if (maxElevation >= 5) {
    return "steep";
  }
  return "rolling";
}

function waterProfileFor(waterPermille: number): MapWaterProfile {
  if (waterPermille < 120) {
    return "low-water";
  }
  if (waterPermille >= 260) {
    return "water-heavy";
  }
  return "balanced-water";
}

function resourceProfileFor(resourcePermille: number): MapResourceProfile {
  return resourcePermille >= 15 ? "resource-rich" : "sparse-resources";
}

function difficultyFor(
  waterPermille: number,
  resourcePermille: number,
  maxElevation: number,
): MapDifficulty {
  if (waterPermille >= 300 || (maxElevation >= 5 && resourcePermille < 15)) {
    return "demanding";
  }
  if (waterPermille <= 120 && maxElevation <= 3 && resourcePermille >= 10) {
    return "gentle";
  }
  return "standard";
}

export function summarizeMap(
  archetype: MapArchetype,
  seed: number,
  map: MapFile,
): MapCatalogSummary {
  const totalTiles = map.terrain.width * map.terrain.height;
  const scan = scanMap(map);
  const waterPermille = permille(scan.waterTiles, totalTiles);
  const resourcePermille = permille(scan.resourceTiles, scan.landTiles);
  const relief = reliefFor(scan.maxElevation);
  const waterProfile = waterProfileFor(waterPermille);
  const resourceProfile = resourceProfileFor(resourcePermille);
  const difficulty = difficultyFor(waterPermille, resourcePermille, scan.maxElevation);

  return {
    archetype,
    difficulty,
    height: map.terrain.height,
    landTiles: scan.landTiles,
    mapId: map.mapId,
    maxElevation: scan.maxElevation,
    relief,
    resourcePermille,
    resourceProfile,
    resourceTiles: scan.resourceTiles,
    seed,
    tags: [archetype, waterProfile, relief, resourceProfile, difficulty],
    waterPermille,
    waterProfile,
    waterTiles: scan.waterTiles,
    width: map.terrain.width,
  };
}

export function catalogSummaries(size = GENERATED_MAP_SIZE): readonly MapCatalogSummary[] {
  return MAP_ARCHETYPES.map((archetype) => {
    const seed = CATALOG_SEEDS[archetype];
    return summarizeMap(archetype, seed, generateMap(archetype, seed, size));
  });
}
