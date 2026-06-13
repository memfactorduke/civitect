/**
 * Milestone readout (GDD §13, board phase-5 task 5): renders straight from
 * the snapshot's milestone block — current index, the next population gate,
 * and how many mechanics are unlocked. The milestone-toast advisor (emitted
 * on each crossing) rides the advisor feed; this panel is the standing status.
 */
import type { ReactNode } from "react";
import { formatCount } from "./format";
import { t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

function popcount(n: number): number {
  let v = n >>> 0;
  let c = 0;
  while (v !== 0) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

export function MilestoneToast(props: { readonly store: UiStore }): ReactNode {
  const milestone = useUiStore(props.store, (s) => s.milestone);
  if (milestone === null) {
    return null;
  }
  return (
    <section aria-label={t("milestone.title")} data-testid="milestone-toast">
      <strong data-testid="milestone-index">
        {t("milestone.title")} {milestone.index}
      </strong>
      {milestone.populationTarget > 0 && (
        <span data-testid="milestone-next">
          {t("milestone.next")} {formatCount(milestone.populationTarget)}{" "}
          {t("milestone.population")}
        </span>
      )}
      <span data-testid="milestone-unlocks">{popcount(milestone.unlockedMask)}</span>
    </section>
  );
}
