/**
 * Advisor feed with the generic CauseChain renderer (ADR-009 / GDD §15):
 * every event shows its WHY as tappable links carrying real entity refs —
 * the e2e resolves those refs against live world state (exit criterion 2).
 */
import type { ReactNode } from "react";
import { CauseChainView } from "./CauseChainView";
import { t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

export function AdvisorFeed(props: { readonly store: UiStore }): ReactNode {
  const events = useUiStore(props.store, (s) => s.advisorEvents);
  // GROUPED BY CAUSE (GDD §15 [LOCKED]: "problem notifications grouped by
  // cause"): one row per summaryKey, newest exemplar shown, count badged.
  const groups = new Map<string, { latest: (typeof events)[number]; count: number }>();
  for (const event of events) {
    const group = groups.get(event.cause.summaryKey);
    if (group === undefined) {
      groups.set(event.cause.summaryKey, { latest: event, count: 1 });
    } else {
      group.count++;
    }
  }
  return (
    <section aria-label={t("advisor.title")}>
      <h2>{t("advisor.title")}</h2>
      <ul data-testid="advisor-feed">
        {[...groups.values()].map(({ latest: event, count }) => (
          <li
            key={event.cause.summaryKey}
            data-testid="advisor-event"
            data-message-key={event.messageKey}
            data-severity={event.severity}
          >
            <span>{event.messageKey}</span>
            {count > 1 && <strong data-testid="advisor-count">×{count}</strong>}
            <em>{event.cause.summaryKey}</em>
            <CauseChainView chain={event.cause} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
