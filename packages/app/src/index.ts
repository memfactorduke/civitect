/**
 * @civitect/app — composition root: boot, sim-worker management, scenes,
 * settings, save manager (TDD §1 runtime topology).
 *
 * This is the only package allowed to depend on all the others — it wires
 * the worker boundary (entire sim in a dedicated Worker; main thread =
 * renderer + UI + input, ADR-006). `main.tsx` is the page entry; `worker.ts`
 * is the sim side. The exports below are the pure seams, unit-tested in
 * Node; the wired round trip is covered by the e2e smoke (TDD §12.5).
 */
export { BOOT } from "./boot-config";
export { type CommandQueue, createCommandQueue, type PostFn } from "./command-queue";
export { pickTileAt } from "./picking";
export {
  AGENT_DENSITY_MAX_PERMILLE,
  AGENT_DENSITY_MIN_PERMILLE,
  AGENT_DENSITY_STEP_PERMILLE,
  APP_PREFERENCES_KEY,
  type AppPreferenceStorage,
  type AppPreferenceStore,
  type AppPreferences,
  appPreferenceDataAttributes,
  createAppPreferenceStore,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  normalizeAppPreferences,
  saveAppPreferences,
} from "./preferences";
export { civToWorld, SIM_VERSION, worldToCiv } from "./save-codec";
export {
  createSaveManager,
  type SaveManager,
  type SaveManagerPorts,
} from "./save-manager";
