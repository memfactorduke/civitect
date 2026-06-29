/**
 * Phase 7 settings scaffold: player-facing preferences that affect
 * presentation and workload, not sim truth. The app shell owns persistence
 * and runtime wiring; this package owns the accessible controls.
 */
import type { ReactNode } from "react";
import { t } from "./i18n";

export interface UiPreferences {
  readonly reducedMotion: boolean;
  readonly batterySaver: boolean;
  /** 250..1000, where 1000 is full visual agent density. */
  readonly agentDensityPermille: number;
}

export const AGENT_DENSITY_MIN_PERMILLE = 250;
export const AGENT_DENSITY_MAX_PERMILLE = 1000;
export const AGENT_DENSITY_STEP_PERMILLE = 50;

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  reducedMotion: false,
  batterySaver: false,
  agentDensityPermille: AGENT_DENSITY_MAX_PERMILLE,
};

export function normalizeUiPreferences(preferences: UiPreferences): UiPreferences {
  const stepped =
    Math.round(preferences.agentDensityPermille / AGENT_DENSITY_STEP_PERMILLE) *
    AGENT_DENSITY_STEP_PERMILLE;
  return {
    reducedMotion: preferences.reducedMotion,
    batterySaver: preferences.batterySaver,
    agentDensityPermille: Math.max(
      AGENT_DENSITY_MIN_PERMILLE,
      Math.min(AGENT_DENSITY_MAX_PERMILLE, stepped),
    ),
  };
}

export function SettingsPanel(props: {
  readonly preferences: UiPreferences;
  readonly onChange: (preferences: UiPreferences) => void;
}): ReactNode {
  const preferences = normalizeUiPreferences(props.preferences);
  const set = (next: Partial<UiPreferences>): void => {
    props.onChange(normalizeUiPreferences({ ...preferences, ...next }));
  };

  return (
    <section aria-label={t("settings.title")} data-testid="settings-panel">
      <h2>{t("settings.title")}</h2>
      <label>
        <input
          type="checkbox"
          checked={preferences.reducedMotion}
          onChange={(event) => set({ reducedMotion: event.currentTarget.checked })}
        />
        {t("settings.reducedMotion")}
      </label>
      <label>
        <input
          type="checkbox"
          checked={preferences.batterySaver}
          onChange={(event) => set({ batterySaver: event.currentTarget.checked })}
        />
        {t("settings.batterySaver")}
      </label>
      <label htmlFor="settings-agent-density">{t("settings.agentDensity")}</label>
      <input
        id="settings-agent-density"
        type="range"
        min={AGENT_DENSITY_MIN_PERMILLE}
        max={AGENT_DENSITY_MAX_PERMILLE}
        step={AGENT_DENSITY_STEP_PERMILLE}
        value={preferences.agentDensityPermille}
        onChange={(event) => set({ agentDensityPermille: Number(event.currentTarget.value) })}
        data-testid="settings-agent-density"
      />
      <output htmlFor="settings-agent-density" data-testid="settings-agent-density-value">
        {Math.round(preferences.agentDensityPermille / 10)}%
      </output>
    </section>
  );
}
