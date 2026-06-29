/**
 * Milestone readout (GDD §13, board phase-5 task 5): renders straight from
 * the snapshot's milestone block — current index, the next population gate,
 * and how many mechanics are unlocked. The milestone-toast advisor (emitted
 * on each crossing) rides the advisor feed; this panel is the standing status.
 */
import type { ReactNode } from "react";
import { formatCount } from "./format";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

const UNLOCK_LABELS: readonly {
  readonly id: string;
  readonly mask: number;
  readonly label: I18nKey;
}[] = [
  { id: "budget-panel", mask: 1 << 0, label: "milestone.unlock.budgetPanel" },
  { id: "loans", mask: 1 << 1, label: "milestone.unlock.loans" },
  { id: "high-density", mask: 1 << 2, label: "milestone.unlock.highDensity" },
  { id: "uniques", mask: 1 << 3, label: "milestone.unlock.uniques" },
  { id: "congestion-pricing", mask: 1 << 4, label: "milestone.unlock.congestionPricing" },
  { id: "airport", mask: 1 << 5, label: "milestone.unlock.airport" },
  { id: "districts", mask: 1 << 6, label: "milestone.unlock.districts" },
  { id: "policies", mask: 1 << 7, label: "milestone.unlock.policies" },
  { id: "transit", mask: 1 << 8, label: "milestone.unlock.transit" },
];

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
  const knownUnlocks = UNLOCK_LABELS.filter(
    (unlock) => (milestone.unlockedMask & unlock.mask) !== 0,
  );
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
      {knownUnlocks.length > 0 && (
        <ul aria-label={t("milestone.unlocks")} data-testid="milestone-unlock-list">
          {knownUnlocks.map((unlock) => (
            <li data-testid={`milestone-unlock-${unlock.id}`} key={unlock.id}>
              {t(unlock.label)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
