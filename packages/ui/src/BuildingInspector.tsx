/**
 * Building inspector panel (pillar 1: every entity has a panel): kind,
 * level, status, and — for service buildings — budget-scaled capacity and
 * coverage effectiveness, plus the per-tile environment block (GDD §10).
 */
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { t } from "./i18n";
import type { UiStore } from "./store";

const STATUS_NAMES: Readonly<Record<number, string>> = {
  0: "normal",
  1: "unpowered",
  2: "unwatered",
  3: "abandoned",
  4: "on fire",
  5: "ruin",
};

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
          <dd data-testid="building-status">{STATUS_NAMES[building.status] ?? building.status}</dd>
          {building.serviceId !== 0 && (
            <>
              <dt>{t("buildingInspector.capacity")}</dt>
              <dd data-testid="building-capacity">{building.capacityTotal}</dd>
              <dt>{t("buildingInspector.effectiveness")}</dt>
              <dd data-testid="building-effectiveness">
                {(building.effectivenessPermille / 10).toFixed(0)}%
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
