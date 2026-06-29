import {
  type CivSave,
  decodeCiv,
  decodeMap,
  type MapFile,
  ResourceKind,
  SAVE_FORMAT_VERSION,
  type TerrainGrid,
} from "@civitect/protocol";

export interface TerrainInspection {
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  readonly landTiles: number;
  readonly waterTiles: number;
  readonly elevationCounts: Readonly<Record<string, number>>;
  readonly resourceCounts: Readonly<Record<string, number>>;
  readonly zoneTiles: number;
  readonly districtTiles: number;
  readonly districtIds: readonly number[];
}

export interface MapInspection {
  readonly kind: "map";
  readonly source: string | null;
  readonly mapId: number;
  readonly generatorSeed: number;
  readonly terrain: TerrainInspection;
}

export interface SaveInspection {
  readonly kind: "save";
  readonly source: string | null;
  readonly header: {
    readonly formatVersion: number;
    readonly currentSaveFormatVersion: number;
    readonly simVersion: number;
    readonly mapId: number;
    readonly seed: number;
    readonly tick: number;
    readonly flags: number;
  };
  readonly world: {
    readonly speed: number;
    readonly selectedTileIdx: number;
    readonly fundsCents: number;
    readonly population: number;
    readonly rngStreamCount: number;
  };
  readonly terrain: TerrainInspection;
  readonly roads: {
    readonly count: number;
    readonly byClass: Readonly<Record<string, number>>;
  };
  readonly buildings: {
    readonly count: number;
    readonly byKind: Readonly<Record<string, number>>;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly onFire: number;
  };
  readonly cohorts: {
    readonly values: number;
    readonly rows: number;
  };
  readonly traffic: {
    readonly generated: number;
    readonly assigned: number;
    readonly walked: number;
    readonly unroutable: number;
    readonly volumeTotal: number;
    readonly activeJob: boolean;
  };
  readonly services: {
    readonly budgetsPermille: readonly number[];
    readonly pollutedGroundTiles: number;
  };
  readonly economy: {
    readonly taxRatesPermille: readonly number[];
    readonly activeLoans: number;
    readonly monthAccumNetCents: number;
    readonly lastMonthNetCents: number;
    readonly milestoneIndex: number;
    readonly difficulty: number;
    readonly receivership: boolean;
    readonly bailoutUsed: boolean;
  };
  readonly chain: {
    readonly shipments: number;
    readonly produced: readonly number[];
    readonly consumed: readonly number[];
    readonly imported: readonly number[];
    readonly exported: readonly number[];
    readonly lost: readonly number[];
  };
  readonly districts: {
    readonly count: number;
    readonly ordinanceMask: number;
    readonly named: readonly string[];
  };
  readonly pins: number;
  readonly commandTail: number;
}

export type ArtifactInspection = MapInspection | SaveInspection;

const RESOURCE_NAMES: Readonly<Record<number, string>> = {
  [ResourceKind.none]: "none",
  [ResourceKind.ore]: "ore",
  [ResourceKind.farm]: "farm",
  [ResourceKind.forest]: "forest",
  [ResourceKind.oil]: "oil",
};

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

function array(values: Iterable<number>): readonly number[] {
  return [...values];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inspectTerrain(terrain: TerrainGrid): TerrainInspection {
  const elevationCounts: Record<string, number> = {};
  const resourceCounts: Record<string, number> = {};
  const districtIds = new Set<number>();
  let waterTiles = 0;
  let zoneTiles = 0;
  let districtTiles = 0;

  for (let i = 0; i < terrain.width * terrain.height; i++) {
    const water = terrain.layers.water[i] ?? 0;
    const elevation = terrain.layers.elevation[i] ?? 0;
    const resource = terrain.layers.resource[i] ?? 0;
    const zone = terrain.layers.zone[i] ?? 0;
    const district = terrain.layers.district[i] ?? 0;

    if (water !== 0) {
      waterTiles++;
    }
    if (zone !== 0) {
      zoneTiles++;
    }
    if (district !== 0) {
      districtTiles++;
      districtIds.add(district);
    }
    bump(elevationCounts, String(elevation));
    bump(resourceCounts, RESOURCE_NAMES[resource] ?? `unknown:${resource}`);
  }

  const tileCount = terrain.width * terrain.height;
  return {
    width: terrain.width,
    height: terrain.height,
    tileCount,
    landTiles: tileCount - waterTiles,
    waterTiles,
    elevationCounts,
    resourceCounts,
    zoneTiles,
    districtTiles,
    districtIds: [...districtIds].sort((a, b) => a - b),
  };
}

export function inspectMap(map: MapFile, source: string | null = null): MapInspection {
  return {
    kind: "map",
    source,
    mapId: map.mapId,
    generatorSeed: map.generatorSeed,
    terrain: inspectTerrain(map.terrain),
  };
}

export function inspectSave(save: CivSave, source: string | null = null): SaveInspection {
  const byClass: Record<string, number> = {};
  for (const road of save.roads) {
    bump(byClass, String(road.roadClass));
  }

  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let onFire = 0;
  for (const building of save.buildings) {
    bump(byKind, String(building.kind));
    bump(byStatus, String(building.status));
    if (building.fireTicks > 0) {
      onFire++;
    }
  }

  let pollutedGroundTiles = 0;
  for (const pollution of save.services.groundPollution) {
    if (pollution !== 0) {
      pollutedGroundTiles++;
    }
  }

  return {
    kind: "save",
    source,
    header: {
      formatVersion: save.header.formatVersion,
      currentSaveFormatVersion: SAVE_FORMAT_VERSION,
      simVersion: save.header.simVersion,
      mapId: save.header.mapId,
      seed: save.header.seed,
      tick: save.header.tick,
      flags: save.header.flags,
    },
    world: {
      speed: save.worldCore.speed,
      selectedTileIdx: save.worldCore.selectedTileIdx,
      fundsCents: save.worldCore.fundsCents,
      population: save.worldCore.population,
      rngStreamCount: save.worldCore.rngStreams.length,
    },
    terrain: inspectTerrain(save.terrain),
    roads: { count: save.roads.length, byClass },
    buildings: {
      count: save.buildings.length,
      byKind,
      byStatus,
      onFire,
    },
    cohorts: {
      values: save.cohorts.length,
      rows: Math.floor(save.cohorts.length / 20),
    },
    traffic: {
      generated: save.traffic.generated,
      assigned: save.traffic.assigned,
      walked: save.traffic.walked,
      unroutable: save.traffic.unroutable,
      volumeTotal: sum(save.traffic.volumes),
      activeJob: save.traffic.job !== null,
    },
    services: {
      budgetsPermille: array(save.services.budgetsPermille),
      pollutedGroundTiles,
    },
    economy: {
      taxRatesPermille: array(save.economy.taxRatesPermille),
      activeLoans: save.economy.loans.length,
      monthAccumNetCents: sum(save.economy.monthAccumCents),
      lastMonthNetCents: sum(save.economy.lastMonthCents),
      milestoneIndex: save.economy.milestoneIndex,
      difficulty: save.economy.difficulty,
      receivership: save.economy.receivership !== 0,
      bailoutUsed: save.economy.bailoutUsed !== 0,
    },
    chain: {
      shipments: save.chain.shipments.length,
      produced: array(save.chain.produced),
      consumed: array(save.chain.consumed),
      imported: array(save.chain.imported),
      exported: array(save.chain.exported),
      lost: array(save.chain.lost),
    },
    districts: {
      count: save.districts.districts.length,
      ordinanceMask: save.districts.ordinanceMask,
      named: save.districts.districts.map((district) => district.name),
    },
    pins: save.pins.length,
    commandTail: save.commandTail.length,
  };
}

export async function inspectArtifact(
  bytes: Uint8Array,
  source: string | null = null,
): Promise<ArtifactInspection> {
  let mapError = "";
  try {
    return inspectMap(await decodeMap(bytes), source);
  } catch (error) {
    mapError = errorMessage(error);
  }

  try {
    return inspectSave(await decodeCiv(bytes), source);
  } catch (error) {
    throw new Error(
      `could not decode artifact as .civmap or .civ; map: ${mapError}; save: ${errorMessage(error)}`,
    );
  }
}
