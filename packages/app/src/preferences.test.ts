import { describe, expect, it } from "vitest";
import {
  APP_PREFERENCES_KEY,
  type AppPreferenceStorage,
  appPreferenceDataAttributes,
  createAppPreferenceStore,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  normalizeAppPreferences,
  saveAppPreferences,
} from "./preferences";

function memoryStorage(seed: Record<string, string> = {}): AppPreferenceStorage {
  const entries = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

describe("app preferences", () => {
  it("normalizes workload preferences to the supported range and step", () => {
    expect(
      normalizeAppPreferences({
        reducedMotion: true,
        batterySaver: true,
        agentDensityPermille: 1024,
      }),
    ).toEqual({ reducedMotion: true, batterySaver: true, agentDensityPermille: 1000 });
    expect(
      normalizeAppPreferences({
        reducedMotion: false,
        batterySaver: true,
        agentDensityPermille: 221,
      }),
    ).toEqual({ reducedMotion: false, batterySaver: true, agentDensityPermille: 250 });
    expect(
      normalizeAppPreferences({
        reducedMotion: true,
        batterySaver: false,
        agentDensityPermille: 627,
      }),
    ).toEqual({ reducedMotion: true, batterySaver: false, agentDensityPermille: 650 });
  });

  it("loads defaults when storage is empty or corrupted", () => {
    expect(loadAppPreferences(memoryStorage())).toEqual(DEFAULT_APP_PREFERENCES);
    expect(loadAppPreferences(memoryStorage({ [APP_PREFERENCES_KEY]: "{" }))).toEqual(
      DEFAULT_APP_PREFERENCES,
    );
  });

  it("loads only well-typed stored fields and normalizes them", () => {
    const storage = memoryStorage({
      [APP_PREFERENCES_KEY]: JSON.stringify({
        reducedMotion: true,
        batterySaver: "no",
        agentDensityPermille: 730,
      }),
    });

    expect(loadAppPreferences(storage)).toEqual({
      reducedMotion: true,
      batterySaver: false,
      agentDensityPermille: 750,
    });
  });

  it("saves normalized preferences for durable reloads", () => {
    const storage = memoryStorage();
    const saved = saveAppPreferences(storage, {
      reducedMotion: true,
      batterySaver: true,
      agentDensityPermille: 449,
    });

    expect(saved).toEqual({ reducedMotion: true, batterySaver: true, agentDensityPermille: 450 });
    expect(loadAppPreferences(storage)).toEqual(saved);
  });

  it("updates and resets through the app preference store", () => {
    const storage = memoryStorage();
    const store = createAppPreferenceStore(storage);

    expect(store.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(store.set({ batterySaver: true, agentDensityPermille: 500 })).toEqual({
      reducedMotion: false,
      batterySaver: true,
      agentDensityPermille: 500,
    });
    expect(store.set({ reducedMotion: true })).toEqual({
      reducedMotion: true,
      batterySaver: true,
      agentDensityPermille: 500,
    });
    expect(store.reset()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(loadAppPreferences(storage)).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("projects preferences into stable document data attributes", () => {
    expect(
      appPreferenceDataAttributes({
        reducedMotion: true,
        batterySaver: false,
        agentDensityPermille: 501,
      }),
    ).toEqual({
      civitectReducedMotion: "true",
      civitectBatterySaver: "false",
      civitectAgentDensity: "500",
    });
  });
});
