/**
 * Building inspector panel (pillar 1: every entity has a panel): kind,
 * level, status, and — for service buildings — budget-scaled capacity and
 * coverage effectiveness, plus the per-tile environment block (GDD §10).
 */
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { type I18nKey, t } from "./i18n";
import type { UiStore } from "./store";

const STATUS_KEYS: Readonly<Record<number, I18nKey>> = {
  0: "buildingInspector.status.normal",
  1: "buildingInspector.status.unpowered",
  2: "buildingInspector.status.unwatered",
  3: "buildingInspector.status.abandoned",
  4: "buildingInspector.status.onFire",
  5: "buildingInspector.status.ruin",
};

type EffectivenessBand = "poor" | "partial" | "good";

function statusLabel(status: number): string {
  const key = STATUS_KEYS[status];
  return key === undefined ? `${t("buildingInspector.status.unknown")} ${status}` : t(key);
}

function effectivenessBand(permille: number): EffectivenessBand {
  if (permille < 600) {
    return "poor";
  }
  if (permille < 900) {
    return "partial";
  }
  return "good";
}

export function BuildingInspector(props: { readonly store: UiStore }): ReactNode {
  const building = useStore(props.store, (s) => s.buildingInfo);
  const environ = useStore(props.store, (s) => s.environInfo);
  if (building === null && environ === null) {
    return null;
  }
  return (
    <section aria-label={t("buildingInspector.title")} data-testid="building-inspector">
      {building !== null && (
        <dl>
          <dt>{t("buildingInspector.kind")}</dt>
          <dd data-testid="building-kind">{building.kind}</dd>
          <dt>{t("buildingInspector.level")}</dt>
          <dd data-testid="building-level">{building.level}</dd>
          <dt>{t("buildingInspector.status")}</dt>
          <dd data-building-status={building.status} data-testid="building-status">
            {statusLabel(building.status)}
          </dd>
          {building.serviceId !== 0 && (
            <>
              <dt>{t("buildingInspector.capacity")}</dt>
              <dd data-testid="building-capacity">{building.capacityTotal}</dd>
              <dt>{t("buildingInspector.effectiveness")}</dt>
              <dd
                data-effectiveness-band={effectivenessBand(building.effectivenessPermille)}
                data-testid="building-effectiveness-readout"
              >
                <span data-testid="building-effectiveness">
                  {(building.effectivenessPermille / 10).toFixed(0)}%
                </span>{" "}
                <span data-testid="building-effectiveness-label">
                  {t(
                    `buildingInspector.effectiveness.${effectivenessBand(building.effectivenessPermille)}`,
                  )}
                </span>
              </dd>
            </>
          )}
        </dl>
      )}
      {environ !== null && (
        <dl data-testid="environ-block">
          <dt>{t("environ.air")}</dt>
          <dd data-testid="environ-air">{environ.airPollution}</dd>
          <dt>{t("environ.ground")}</dt>
          <dd data-testid="environ-ground">{environ.groundPollution}</dd>
          <dt>{t("environ.noise")}</dt>
          <dd data-testid="environ-noise">{environ.noise}</dd>
          <dt>{t("environ.water")}</dt>
          <dd data-testid="environ-water">{environ.waterPollution}</dd>
        </dl>
      )}
    </section>
  );
}
