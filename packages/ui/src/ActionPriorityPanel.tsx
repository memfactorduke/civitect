/**
 * Turns existing snapshot signals into a ranked "what should I fix next?"
 * panel. This is intentionally UI-only: it derives advice from data the
 * player can already inspect instead of inventing new game truth.
 */
import {
  type AdvisorEvent,
  AdvisorSeverity,
  type CauseChain,
  type DemandBlock,
  type MilestoneBlock,
  type MonthlyReport,
} from "@civitect/protocol";
import type { ReactNode } from "react";
import { CauseChainView } from "./CauseChainView";
import { formatCount, formatFundsCents, formatSignedCents } from "./format";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

type ActionSeverity = "alert" | "warning" | "info";

interface PriorityItem {
  readonly id: string;
  readonly severity: ActionSeverity;
  readonly titleKey: I18nKey;
  readonly body: ReactNode;
  readonly cause?: CauseChain;
}

const SECTORS: readonly {
  readonly key: "r" | "c" | "i" | "o";
  readonly label: I18nKey;
}[] = [
  { key: "r", label: "demand.residential" },
  { key: "c", label: "demand.commercial" },
  { key: "i", label: "demand.industrial" },
  { key: "o", label: "demand.office" },
];

const DEMAND_PRIORITY_THRESHOLD = 300;

export function ActionPriorityPanel(props: { readonly store: UiStore }): ReactNode {
  const fundsCents = useUiStore(props.store, (s) => s.fundsCents);
  const population = useUiStore(props.store, (s) => s.population);
  const advisorEvents = useUiStore(props.store, (s) => s.advisorEvents);
  const demand = useUiStore(props.store, (s) => s.demand);
  const report = useUiStore(props.store, (s) => s.report);
  const milestone = useUiStore(props.store, (s) => s.milestone);

  const priorities = buildPriorities({
    fundsCents,
    population,
    advisorEvents,
    demand,
    report,
    milestone,
  });

  return (
    <section aria-label={t("action.title")} data-testid="action-priority-panel">
      <h2>{t("action.title")}</h2>
      {priorities.length === 0 ? (
        <p data-testid="action-empty">
          <strong>{t("action.empty.title")}</strong> {t("action.empty.detail")}
        </p>
      ) : (
        <ol>
          {priorities.map((priority) => (
            <li
              key={priority.id}
              data-testid="action-priority"
              data-priority-id={priority.id}
              data-severity={priority.severity}
            >
              <strong>{t(priority.titleKey)}</strong>
              <span data-testid="action-priority-severity">
                {" "}
                - {t(`action.severity.${priority.severity}` as I18nKey)}
              </span>
              <div>{priority.body}</div>
              {priority.cause !== undefined && <CauseChainView chain={priority.cause} compact />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function buildPriorities(input: {
  readonly fundsCents: number;
  readonly population: number;
  readonly advisorEvents: readonly AdvisorEvent[];
  readonly demand: DemandBlock;
  readonly report: MonthlyReport | null;
  readonly milestone: MilestoneBlock | null;
}): PriorityItem[] {
  const priorities: PriorityItem[] = [];

  if (input.fundsCents < 0) {
    priorities.push({
      id: "cash",
      severity: "alert",
      titleKey: "action.cash.title",
      body: (
        <span>
          {t("action.cash.detail")}:{" "}
          <output data-testid="action-cash-funds">{formatFundsCents(input.fundsCents)}</output>
        </span>
      ),
    });
  }

  const advisor = topAdvisorGroup(input.advisorEvents);
  if (advisor !== null) {
    priorities.push({
      id: "advisor",
      severity: advisor.latest.severity === AdvisorSeverity.alert ? "alert" : "warning",
      titleKey: "action.advisor.title",
      body: (
        <span>
          {t("action.advisor.detail")}:{" "}
          <output data-testid="action-advisor-count">{advisor.count}</output>{" "}
          {advisor.latest.messageKey}
        </span>
      ),
      cause: advisor.latest.cause,
    });
  }

  const reportPriority = reportGap(input.report);
  if (reportPriority !== null) {
    priorities.push(reportPriority);
  }

  const demandPriority = strongestDemand(input.demand);
  if (demandPriority !== null) {
    priorities.push(demandPriority);
  }

  if (input.milestone !== null && input.milestone.populationTarget > input.population) {
    priorities.push({
      id: "milestone",
      severity: "info",
      titleKey: "action.milestone.title",
      body: (
        <span>
          {t("action.milestone.detail")}:{" "}
          <output data-testid="action-milestone-needed">
            {formatCount(input.milestone.populationTarget - input.population)}
          </output>
        </span>
      ),
    });
  }

  return priorities;
}

function topAdvisorGroup(events: readonly AdvisorEvent[]): {
  readonly latest: AdvisorEvent;
  readonly count: number;
} | null {
  const groups = new Map<string, { latest: AdvisorEvent; count: number }>();
  for (const event of events) {
    const group = groups.get(event.cause.summaryKey);
    if (group === undefined) {
      groups.set(event.cause.summaryKey, { latest: event, count: 1 });
    } else {
      group.count++;
      if (event.tick > group.latest.tick) {
        groups.set(event.cause.summaryKey, { latest: event, count: group.count });
      }
    }
  }
  const sorted = [...groups.values()].sort((a, b) => {
    if (b.latest.severity !== a.latest.severity) {
      return b.latest.severity - a.latest.severity;
    }
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (b.latest.tick !== a.latest.tick) {
      return b.latest.tick - a.latest.tick;
    }
    return a.latest.cause.summaryKey.localeCompare(b.latest.cause.summaryKey);
  });
  return sorted[0] ?? null;
}

function reportGap(report: MonthlyReport | null): PriorityItem | null {
  if (report === null) {
    return null;
  }
  const net = report.lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (net >= 0) {
    return null;
  }
  const worstExpense = [...report.lines].sort((a, b) => a.amountCents - b.amountCents)[0];
  return {
    id: "report",
    severity: "warning",
    titleKey: "action.report.title",
    body: (
      <span>
        {t("action.report.detail")}:{" "}
        <output data-testid="action-report-net">{formatSignedCents(net)}</output>
        {worstExpense !== undefined && (
          <>
            {" "}
            <span data-testid="action-report-worst">
              {t(`report.line.${worstExpense.kind}` as I18nKey)}{" "}
              {formatSignedCents(worstExpense.amountCents)}
            </span>
          </>
        )}
      </span>
    ),
  };
}

function strongestDemand(demand: DemandBlock): PriorityItem | null {
  const strongest = SECTORS.map((sector) => ({ ...sector, value: demand[sector.key] })).sort(
    (a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return a.key.localeCompare(b.key);
    },
  )[0];
  if (strongest === undefined || strongest.value < DEMAND_PRIORITY_THRESHOLD) {
    return null;
  }
  return {
    id: "demand",
    severity: strongest.value >= 650 ? "warning" : "info",
    titleKey: "action.demand.title",
    body: (
      <span>
        {t("action.demand.detail")}:{" "}
        <span data-testid="action-demand-sector">{t(strongest.label)}</span>{" "}
        <output data-testid="action-demand-value">{strongest.value}</output>
      </span>
    ),
  };
}
