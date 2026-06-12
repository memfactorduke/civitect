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
import { flatTerrain, SAVE_FORMAT_VERSION } from "@civitect/protocol";
import { Pcg32, type Pcg32State, RNG_STREAM_NAMES, type World } from "@civitect/sim";
import { BOOT } from "./boot-config";

/**
 * Rules version stamped into save headers (TDD §10). Lives here until rules
 * actually version — first balance change (ROADMAP Phase 2) moves it into
 * @civitect/sim, where it belongs once it varies.
 */
export const SIM_VERSION = 1;

export function worldToCiv(world: World, commandTail: CivSave["commandTail"]): CivSave {
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
    // Phase 0 worlds ARE flat; World.terrain replaces this with task 7b
    // (the terrain bless), and civToWorld starts consuming save.terrain.
    terrain: flatTerrain(world.mapWidth, world.mapHeight),
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
    rng,
  };
}
