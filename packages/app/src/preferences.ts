/**
 * App-owned presentation/workload preferences. These are never simulation
 * truth: they shape rendering/UI cost and accessibility, while cohorts,
 * agents, and city state remain authoritative in sim snapshots.
 */
export interface AppPreferences {
  readonly reducedMotion: boolean;
  readonly batterySaver: boolean;
  /** 250..1000, where 1000 means full visual agent density. */
  readonly agentDensityPermille: number;
}

export interface AppPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface AppPreferenceStore {
  get(): AppPreferences;
  set(next: Partial<AppPreferences>): AppPreferences;
  reset(): AppPreferences;
}

export const APP_PREFERENCES_KEY = "civitect.preferences.v1";
export const AGENT_DENSITY_MIN_PERMILLE = 250;
export const AGENT_DENSITY_MAX_PERMILLE = 1000;
export const AGENT_DENSITY_STEP_PERMILLE = 50;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  reducedMotion: false,
  batterySaver: false,
  agentDensityPermille: AGENT_DENSITY_MAX_PERMILLE,
};

export function normalizeAppPreferences(preferences: Partial<AppPreferences>): AppPreferences {
  const rawDensity =
    typeof preferences.agentDensityPermille === "number" &&
    Number.isFinite(preferences.agentDensityPermille)
      ? preferences.agentDensityPermille
      : DEFAULT_APP_PREFERENCES.agentDensityPermille;
  const stepped =
    Math.round(rawDensity / AGENT_DENSITY_STEP_PERMILLE) * AGENT_DENSITY_STEP_PERMILLE;

  return {
    reducedMotion: preferences.reducedMotion ?? DEFAULT_APP_PREFERENCES.reducedMotion,
    batterySaver: preferences.batterySaver ?? DEFAULT_APP_PREFERENCES.batterySaver,
    agentDensityPermille: Math.max(
      AGENT_DENSITY_MIN_PERMILLE,
      Math.min(AGENT_DENSITY_MAX_PERMILLE, stepped),
    ),
  };
}

function patchFromUnknown(value: unknown): Partial<AppPreferences> {
  if (value === null || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    reducedMotion: typeof record.reducedMotion === "boolean" ? record.reducedMotion : undefined,
    batterySaver: typeof record.batterySaver === "boolean" ? record.batterySaver : undefined,
    agentDensityPermille:
      typeof record.agentDensityPermille === "number" ? record.agentDensityPermille : undefined,
  };
}

export function loadAppPreferences(storage: AppPreferenceStorage): AppPreferences {
  const text = storage.getItem(APP_PREFERENCES_KEY);
  if (text === null) {
    return DEFAULT_APP_PREFERENCES;
  }
  try {
    return normalizeAppPreferences(patchFromUnknown(JSON.parse(text)));
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export function saveAppPreferences(
  storage: AppPreferenceStorage,
  preferences: Partial<AppPreferences>,
): AppPreferences {
  const normalized = normalizeAppPreferences(preferences);
  storage.setItem(APP_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createAppPreferenceStore(storage: AppPreferenceStorage): AppPreferenceStore {
  let current = loadAppPreferences(storage);
  return {
    get(): AppPreferences {
      return current;
    },
    set(next: Partial<AppPreferences>): AppPreferences {
      current = saveAppPreferences(storage, { ...current, ...next });
      return current;
    },
    reset(): AppPreferences {
      storage.removeItem?.(APP_PREFERENCES_KEY);
      current = DEFAULT_APP_PREFERENCES;
      return current;
    },
  };
}

export function appPreferenceDataAttributes(
  preferences: Partial<AppPreferences>,
): Record<string, string> {
  const normalized = normalizeAppPreferences(preferences);
  return {
    civitectReducedMotion: normalized.reducedMotion ? "true" : "false",
    civitectBatterySaver: normalized.batterySaver ? "true" : "false",
    civitectAgentDensity: String(normalized.agentDensityPermille),
  };
}
