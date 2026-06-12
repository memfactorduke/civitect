/**
 * World ↔ CivSave mapping (TDD §10) — the worker-side halves of save and
 * load, kept pure so the board's "save→load→state-hash-equal" verification
 * runs in Node against the exact code the worker executes.
 *
 * Protocol owns the byte layout (encodeCiv/decodeCiv); this module owns the
 * semantic mapping and load-time validation. The sim stays untouched: World
 * is constructed structurally, RNG streams restore via Pcg32.fromState
 * (provided by sim for exactly this).
 */
import type { BuildingRow, CivSave, RngStreamState } from "@civitect/protocol";
import { SAVE_FORMAT_VERSION } from "@civitect/protocol";
import {
  addEdge,
  addNode,
  COHORT_BLOCK,
  canonicalGraph,
  createAgentPool,
  createBuildings,
  createCoverageCache,
  createPollutionCache,
  createRoadGraph,
  emptyServiceFlows,
  Pcg32,
  type Pcg32State,
  RNG_STREAM_NAMES,
  type RoadClass,
  spawnBuilding,
  trafficFromSave,
  trafficToSave,
  type World,
} from "@civitect/sim";
import { BOOT } from "./boot-config";

/**
 * Rules version stamped into save headers (TDD §10). Lives here until rules
 * actually version — first balance change (ROADMAP Phase 2) moves it into
 * @civitect/sim, where it belongs once it varies.
 */
export const SIM_VERSION = 1;

function buildingRows(world: World): { rows: BuildingRow[]; cohorts: Uint16Array } {
  const b = world.buildings;
  const order: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] === 1) {
      order.push(i);
    }
  }
  order.sort((p, q) => (b.tileIdx[p] as number) - (b.tileIdx[q] as number));
  const cohorts = new Uint16Array(order.length * COHORT_BLOCK);
  const rows = order.map((i, at) => {
    cohorts.set(b.cohorts.subarray(i * COHORT_BLOCK, (i + 1) * COHORT_BLOCK), at * COHORT_BLOCK);
    return {
      tileIdx: b.tileIdx[i] as number,
      kind: b.kind[i] as number,
      level: b.level[i] as number,
      status: b.status[i] as number,
      failDays: b.failDays[i] as number,
      thriveDays: b.thriveDays[i] as number,
      stock: b.stock[i] as number,
      sick: b.sick[i] as number,
      corpses: b.corpses[i] as number,
      fireTicks: b.fireTicks[i] as number,
    };
  });
  return { rows, cohorts };
}

export function worldToCiv(world: World, commandTail: CivSave["commandTail"]): CivSave {
  const persisted = buildingRows(world);
  const rngStreams: RngStreamState[] = RNG_STREAM_NAMES.map((name) => ({
    name,
    ...world.rng[name].state(),
  }));
  return {
    header: {
      formatVersion: SAVE_FORMAT_VERSION,
      simVersion: SIM_VERSION,
      seed: world.seed,
      tick: world.tick,
      mapId: 0,
      flags: 0,
    },
    terrain: world.terrain,
    buildings: persisted.rows,
    cohorts: persisted.cohorts,
    roads: canonicalGraph(world.roads).edges.map((e) => ({
      ax: e.ax,
      ay: e.ay,
      bx: e.bx,
      by: e.by,
      roadClass: e.roadClass,
    })),
    // Same canonical edge order as roads — trafficToSave sorts identically.
    traffic: trafficToSave(world.traffic, world.roads),
    services: {
      budgetsPermille: Uint16Array.from(world.services.budgetsPermille),
      groundPollution: Uint8Array.from(world.groundPollution),
    },
    pins: world.pins.map((p) => ({ tileIdx: p.tileIdx, slot: p.slot })),
    worldCore: {
      speed: world.speed,
      selectedTileIdx: world.selectedTileIdx,
      mapWidth: world.mapWidth,
      mapHeight: world.mapHeight,
      fundsCents: world.fundsCents,
      population: world.population,
      rngStreams,
    },
    commandTail,
  };
}

function rebuildBuildings(save: CivSave): World["buildings"] {
  const b = createBuildings();
  save.buildings.forEach((row, at) => {
    const i = spawnBuilding(b, row.tileIdx, row.kind);
    b.level[i] = row.level;
    b.status[i] = row.status;
    b.failDays[i] = row.failDays;
    b.thriveDays[i] = row.thriveDays;
    b.stock[i] = row.stock;
    b.sick[i] = row.sick;
    b.corpses[i] = row.corpses;
    b.fireTicks[i] = row.fireTicks;
    b.cohorts.set(
      save.cohorts.subarray(at * COHORT_BLOCK, (at + 1) * COHORT_BLOCK),
      i * COHORT_BLOCK,
    );
  });
  return b;
}

function rebuildRoads(segments: CivSave["roads"]): World["roads"] {
  const g = createRoadGraph();
  for (const seg of segments) {
    addEdge(g, addNode(g, seg.ax, seg.ay), addNode(g, seg.bx, seg.by), seg.roadClass as RoadClass);
  }
  return g;
}

/**
 * Validate + rebuild a World from a decoded save. Throws with a
 * player-relayable message on anything structurally wrong — the worker
 * turns that into loadResponse{ok:false}.
 */
export function civToWorld(save: CivSave): World {
  const core = save.worldCore;
  if (core.mapWidth !== BOOT.mapWidth || core.mapHeight !== BOOT.mapHeight) {
    // The stage is built for BOOT dims at boot time; scene rebuild on load
    // arrives with Phase 1 terrain/maps. Refuse rather than render lies.
    throw new Error(
      `save is a ${core.mapWidth}×${core.mapHeight} map; this build only loads ` +
        `${BOOT.mapWidth}×${BOOT.mapHeight} until Phase 1 scene rebuild`,
    );
  }
  const states = new Map<string, Pcg32State>();
  for (const stream of core.rngStreams) {
    states.set(stream.name, stream);
  }
  const rng = {} as Record<(typeof RNG_STREAM_NAMES)[number], Pcg32>;
  for (const name of RNG_STREAM_NAMES) {
    const state = states.get(name);
    if (state === undefined) {
      throw new Error(`save is missing RNG stream "${name}" — corrupt or from foreign rules`);
    }
    rng[name] = Pcg32.fromState(state);
  }
  if (core.rngStreams.length !== RNG_STREAM_NAMES.length) {
    throw new Error(
      `save carries ${core.rngStreams.length} RNG streams, this build expects ` +
        `${RNG_STREAM_NAMES.length}`,
    );
  }
  // Canonical segments rebuild deterministically (sorted order); undo/redo
  // stacks are session-local — loading starts them fresh.
  const roads = rebuildRoads(save.roads);
  return {
    seed: save.header.seed,
    tick: save.header.tick,
    speed: core.speed,
    selectedTileIdx: core.selectedTileIdx,
    mapWidth: core.mapWidth,
    mapHeight: core.mapHeight,
    fundsCents: core.fundsCents,
    population: core.population,
    terrain: save.terrain,
    roads,
    undoStack: [],
    redoStack: [],
    buildings: rebuildBuildings(save),
    lastDemand: { r: 0, c: 0, i: 0, o: 0, factors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    flows: { births: 0, deaths: 0, immigrants: 0, emigrants: 0 },
    advisorQueue: [],
    utilities: {
      componentOf: new Int32Array(0),
      powered: new Uint8Array(0),
      watered: new Uint8Array(0),
    },
    utilitiesRoadVersion: -1,
    utilitiesBuildingVersion: -1,
    advisorIdCounter: 0,
    zoneVersion: 0,
    // Canonical (TDD §6.3): MSA volumes + any in-flight solver job restore
    // exactly — per-edge values remap onto the rebuilt graph by canonical
    // edge identity; the continued-identity test enforces it.
    traffic: trafficFromSave(save.traffic, roads),
    pins: save.pins.map((p) => ({ tileIdx: p.tileIdx, slot: p.slot })),
    services: { budgetsPermille: Uint16Array.from(save.services.budgetsPermille), version: 0 },
    // Length 0 = the v6→v7 migration's dimension-free "all clean".
    groundPollution:
      save.services.groundPollution.length === 0
        ? new Uint8Array(core.mapWidth * core.mapHeight)
        : Uint8Array.from(save.services.groundPollution),
    coverageCache: createCoverageCache(),
    serviceFlows: emptyServiceFlows(),
    pollutionCache: createPollutionCache(),
    agents: createAgentPool(save.header.seed),
    viewport: null,
    rng,
  };
}
