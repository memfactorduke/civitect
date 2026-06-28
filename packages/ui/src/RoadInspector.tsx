/**
 * Road inspector panel (GDD §9.5): volume, capacity, v/c, travel time for
 * the road under the selected tile. Renders nothing when the selection has
 * no road — the panel IS the presence signal.
 */
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { t } from "./i18n";
import type { UiStore } from "./store";

const LOAD_BUSY_PERMILLE = 700;
const LOAD_JAMMED_PERMILLE = 950;
const DELAY_BUSY_PERMILLE = 1_250;
const DELAY_JAMMED_PERMILLE = 1_750;

function congestionStatus(vcPermille: number, delayPermille: number): "clear" | "busy" | "jammed" {
  if (vcPermille >= LOAD_JAMMED_PERMILLE || delayPermille >= DELAY_JAMMED_PERMILLE) {
    return "jammed";
  }
  if (vcPermille >= LOAD_BUSY_PERMILLE || delayPermille >= DELAY_BUSY_PERMILLE) {
    return "busy";
  }
  return "clear";
}

export function RoadInspector(props: { readonly store: UiStore }): ReactNode {
  const road = useStore(props.store, (s) => s.roadInfo);
  if (road === null) {
    return null;
  }
  const delayPermille =
    road.freeFlowCost === 0 ? 1000 : Math.floor((road.congestedCost * 1000) / road.freeFlowCost);
  const status = congestionStatus(road.vcPermille, delayPermille);
  return (
    <section aria-label={t("roadInspector.title")} data-testid="road-inspector">
      <h2>{t("roadInspector.title")}</h2>
      <dl>
        <dt>{t("roadInspector.status")}</dt>
        <dd data-testid="road-status">{t(`roadInspector.status.${status}`)}</dd>
        <dt>{t("roadInspector.volume")}</dt>
        <dd data-testid="road-volume">{road.volume}</dd>
        <dt>{t("roadInspector.capacity")}</dt>
        <dd data-testid="road-capacity">{road.capacity}</dd>
        <dt>{t("roadInspector.vc")}</dt>
        <dd data-testid="road-vc">{(road.vcPermille / 10).toFixed(1)}%</dd>
        <dt>{t("roadInspector.delay")}</dt>
        <dd data-testid="road-delay">×{(delayPermille / 1000).toFixed(2)}</dd>
      </dl>
    </section>
  );
}
