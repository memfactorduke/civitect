/**
 * Advisor feed with the generic CauseChain renderer (ADR-009 / GDD §15):
 * every event shows its WHY as tappable links carrying real entity refs —
 * the e2e resolves those refs against live world state (exit criterion 2).
 */
import type { ReactNode } from "react";
import { t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

const KIND_NAMES: Readonly<Record<number, string>> = {
  1: "tile",
  2: "building",
  3: "edge",
  4: "agent",
  5: "system",
};

export function AdvisorFeed(props: { readonly store: UiStore }): ReactNode {
  const events = useUiStore(props.store, (s) => s.advisorEvents);
  return (
    <section aria-label={t("advisor.title")}>
      <h2>{t("advisor.title")}</h2>
      <ul data-testid="advisor-feed">
        {events.map((event) => (
          <li key={event.id} data-testid="advisor-event" data-message-key={event.messageKey}>
            <span>{event.messageKey}</span>
            <em>{event.cause.summaryKey}</em>
            <ul>
              {event.cause.links.map((link) => (
                <li
                  key={`${link.subject.kind}:${link.subject.id}:${link.labelKey}`}
                  data-testid="cause-link"
                  data-subject-kind={KIND_NAMES[link.subject.kind] ?? link.subject.kind}
                  data-subject-id={link.subject.id}
                >
                  {link.labelKey} → {KIND_NAMES[link.subject.kind] ?? "?"}#{link.subject.id} (
                  {link.weightPermille}‰)
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
