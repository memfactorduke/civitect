/**
 * Advisor feed with the generic CauseChain renderer (ADR-009 / GDD §15):
 * every event shows its WHY as tappable links carrying real entity refs —
 * the e2e resolves those refs against live world state (exit criterion 2).
 */
import type { ReactNode } from "react";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

interface AdvisorGroup {
  readonly latest: ReturnType<UiStore["getState"]>["advisorEvents"][number];
  readonly count: number;
  readonly maxSeverity: number;
}

const ENTITY_KIND_KEYS: Readonly<Record<number, I18nKey>> = {
  1: "entity.tile",
  2: "entity.building",
  3: "entity.edge",
  4: "entity.agent",
  5: "entity.system",
};

const MESSAGE_KEYS: Readonly<Record<string, I18nKey>> = {
  "advisor.abandonment": "advisor.message.abandonment",
  "advisor.achievement": "advisor.message.achievement",
  "advisor.bailout": "advisor.message.bailout",
  "advisor.congestion": "advisor.message.congestion",
  "advisor.deathcare": "advisor.message.deathcare",
  "advisor.fire": "advisor.message.fire",
  "advisor.fireSpreading": "advisor.message.fireSpreading",
  "advisor.garbage": "advisor.message.garbage",
  "advisor.health": "advisor.message.health",
  "advisor.milestone": "advisor.message.milestone",
  "advisor.receivership": "advisor.message.receivership",
  "advisor.sewage": "advisor.message.sewage",
  "advisor.waterCrisis": "advisor.message.waterCrisis",
};

const CAUSE_KEYS: Readonly<Record<string, I18nKey>> = {
  "cause.achievementEarned": "cause.message.achievementEarned",
  "cause.bailoutExhausted": "cause.message.bailoutExhausted",
  "cause.bankruptcy": "cause.message.bankruptcy",
  "cause.bankruptcyFinal": "cause.message.bankruptcyFinal",
  "cause.buildingOnFire": "cause.message.buildingOnFire",
  "cause.cemeteriesFull": "cause.message.cemeteriesFull",
  "cause.cityInsolvent": "cause.message.cityInsolvent",
  "cause.cityMilestone": "cause.message.cityMilestone",
  "cause.deathcareCapacityShort": "cause.message.deathcareCapacityShort",
  "cause.edgeSaturated": "cause.message.edgeSaturated",
  "cause.fireRagingUnanswered": "cause.message.fireRagingUnanswered",
  "cause.garbageCapacityShort": "cause.message.garbageCapacityShort",
  "cause.healthCapacityShort": "cause.message.healthCapacityShort",
  "cause.ignition": "cause.message.ignition",
  "cause.jamLocation": "cause.message.jamLocation",
  "cause.milestoneReached": "cause.message.milestoneReached",
  "cause.noDeathcare": "cause.message.noDeathcare",
  "cause.noFireService": "cause.message.noFireService",
  "cause.noGarbageService": "cause.message.noGarbageService",
  "cause.noHealthcare": "cause.message.noHealthcare",
  "cause.noUtilities": "cause.message.noUtilities",
  "cause.pollutedIntake": "cause.message.pollutedIntake",
  "cause.pollutedWater": "cause.message.pollutedWater",
  "cause.populationGrowth": "cause.message.populationGrowth",
  "cause.pumpDrinksPollution": "cause.message.pumpDrinksPollution",
  "cause.respondingStation": "cause.message.respondingStation",
  "cause.sewageDeficit": "cause.message.sewageDeficit",
  "cause.sewageOverCapacity": "cause.message.sewageOverCapacity",
  "cause.truckDelayedByTraffic": "cause.message.truckDelayedByTraffic",
  "cause.truckLate": "cause.message.truckLate",
  "cause.utilityFailure": "cause.message.utilityFailure",
  "cause.volumeOverCapacity": "cause.message.volumeOverCapacity",
};

function severityLabel(severity: number): string {
  if (severity >= 3) {
    return t("advisor.severity.alert");
  }
  if (severity >= 2) {
    return t("advisor.severity.warning");
  }
  return t("advisor.severity.info");
}

function messageLabel(key: string): string {
  const labelKey = MESSAGE_KEYS[key];
  return labelKey === undefined ? key : t(labelKey);
}

function causeLabel(key: string): string {
  const labelKey = CAUSE_KEYS[key];
  return labelKey === undefined ? key : t(labelKey);
}

function entityKindName(kind: number): string {
  const labelKey = ENTITY_KIND_KEYS[kind];
  return labelKey === undefined ? String(kind) : t(labelKey);
}

function linkWeight(weightPermille: number): string {
  return `${(weightPermille / 10).toFixed(0)}%`;
}

export function AdvisorFeed(props: { readonly store: UiStore }): ReactNode {
  const events = useUiStore(props.store, (s) => s.advisorEvents);
  // GROUPED BY CAUSE (GDD §15 [LOCKED]: "problem notifications grouped by
  // cause"): one row per summaryKey, newest exemplar shown, count badged.
  const groups = new Map<string, AdvisorGroup>();
  for (const event of events) {
    const group = groups.get(event.cause.summaryKey);
    if (group === undefined) {
      groups.set(event.cause.summaryKey, { latest: event, count: 1, maxSeverity: event.severity });
    } else {
      groups.set(event.cause.summaryKey, {
        latest: event.tick >= group.latest.tick ? event : group.latest,
        count: group.count + 1,
        maxSeverity: Math.max(group.maxSeverity, event.severity),
      });
    }
  }
  const sortedGroups = [...groups.values()].sort(
    (a, b) =>
      b.maxSeverity - a.maxSeverity ||
      b.latest.tick - a.latest.tick ||
      a.latest.cause.summaryKey.localeCompare(b.latest.cause.summaryKey),
  );
  return (
    <section aria-label={t("advisor.title")}>
      <h2>{t("advisor.title")}</h2>
      <ul data-testid="advisor-feed">
        {sortedGroups.map(({ latest: event, count, maxSeverity }) => (
          <li
            key={event.cause.summaryKey}
            data-testid="advisor-event"
            data-message-key={event.messageKey}
            data-severity={maxSeverity}
            data-latest-tick={event.tick}
          >
            <strong data-testid="advisor-severity">{severityLabel(maxSeverity)}</strong>
            <span data-testid="advisor-message">{messageLabel(event.messageKey)}</span>
            {count > 1 && <strong data-testid="advisor-count">×{count}</strong>}
            <em data-testid="advisor-summary">{causeLabel(event.cause.summaryKey)}</em>
            <small>
              {t("advisor.latestTick")} {event.tick}
            </small>
            <ul aria-label={t("advisor.causes")}>
              {event.cause.links.map((link) => (
                <li
                  key={`${link.subject.kind}:${link.subject.id}:${link.labelKey}`}
                  data-testid="cause-link"
                  data-subject-kind={entityKindName(link.subject.kind)}
                  data-subject-id={link.subject.id}
                  data-link-weight={link.weightPermille}
                >
                  <span>{causeLabel(link.labelKey)}</span>{" "}
                  <span>
                    {entityKindName(link.subject.kind)} #{link.subject.id}
                  </span>{" "}
                  <span>{linkWeight(link.weightPermille)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
