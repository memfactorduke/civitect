/**
 * Building inspector panel (pillar 1: every entity has a panel): kind,
 * level, status, and — for service buildings — budget-scaled capacity and
 * coverage effectiveness.
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
  if (building === null) {
    return null;
  }
  return (
    <section aria-label={t("buildingInspector.title")} data-testid="building-inspector">
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
    </section>
  );
}
