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
import type { CivSave, RngStreamState } from "@civitect/protocol";
import { SAVE_FORMAT_VERSION } from "@civitect/protocol";
import {
  addEdge,
  addNode,
  canonicalGraph,
  createBuildings,
  createRoadGraph,
  Pcg32,
  type Pcg32State,
  RNG_STREAM_NAMES,
  type RoadClass,
  type World,
  worldHasBuildings,
} from "@civitect/sim";
import { BOOT } from "./boot-config";

/**
 * Rules version stamped into save headers (TDD §10). Lives here until rules
 * actually version — first balance change (ROADMAP Phase 2) moves it into
 * @civitect/sim, where it belongs once it varies.
 */
export const SIM_VERSION = 1;

export function worldToCiv(world: World, commandTail: CivSave["commandTail"]): CivSave {
  if (worldHasBuildings(world)) {
    throw new Error("this build cannot save worlds with buildings yet (save format v4 pending)");
  }
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
    roads: canonicalGraph(world.roads).edges.map((e) => ({
      ax: e.ax,
      ay: e.ay,
      bx: e.bx,
      by: e.by,
      roadClass: e.roadClass,
    })),
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
    // Canonical segments rebuild deterministically (sorted order); undo/redo
    // stacks are session-local — loading starts them fresh.
    roads: rebuildRoads(save.roads),
    undoStack: [],
    redoStack: [],
    // Phase 2 state: buildings persist with save format v4 (follow-up PR,
    // 12f recipe); until then worldToCiv refuses worlds with buildings.
    buildings: createBuildings(),
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
    rng,
  };
}
