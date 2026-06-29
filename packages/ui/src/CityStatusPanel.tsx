/**
 * City status summary: a compact readout of the existing snapshot signals.
 * It does not invent game state; it summarizes HUD, demand, report,
 * milestone, and advisor data already crossing the protocol wall.
 */
import type { DemandBlock, MilestoneBlock, MonthlyReport } from "@civitect/protocol";
import type { ReactNode } from "react";
import { formatCount, formatSignedCents } from "./format";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

type DemandSector = "r" | "c" | "i" | "o";

const SECTORS: readonly { readonly key: DemandSector; readonly label: I18nKey }[] = [
  { key: "r", label: "demand.residential" },
  { key: "c", label: "demand.commercial" },
  { key: "i", label: "demand.industrial" },
  { key: "o", label: "demand.office" },
];

const SEVERITY_LABELS: Readonly<Record<number, I18nKey>> = {
  0: "cityStatus.advisors.clear",
  1: "cityStatus.advisors.notice",
  2: "cityStatus.advisors.warning",
  3: "cityStatus.advisors.critical",
};

function reportNet(report: MonthlyReport | null): number | null {
  return report === null ? null : report.lines.reduce((sum, line) => sum + line.amountCents, 0);
}

function cashState(
  fundsCents: number,
  netCents: number | null,
): { readonly state: string; readonly label: I18nKey } {
  if (fundsCents < 0) {
    return { state: "debt", label: "cityStatus.cash.debt" };
  }
  if (netCents === null) {
    return { state: "no-report", label: "cityStatus.cash.noReport" };
  }
  if (netCents < 0) {
    return { state: "deficit", label: "cityStatus.cash.deficit" };
  }
  if (netCents > 0) {
    return { state: "surplus", label: "cityStatus.cash.surplus" };
  }
  return { state: "balanced", label: "cityStatus.cash.balanced" };
}

function demandSummary(demand: DemandBlock): {
  readonly pressure: number;
  readonly strongest: { readonly label: I18nKey; readonly value: number } | null;
} {
  let pressure = 0;
  let strongest: { readonly label: I18nKey; readonly value: number } | null = null;
  for (const sector of SECTORS) {
    const value = demand[sector.key];
    const magnitude = Math.abs(value);
    pressure += magnitude;
    if (strongest === null || magnitude > Math.abs(strongest.value)) {
      strongest = { label: sector.label, value };
    }
  }
  return {
    pressure,
    strongest: pressure === 0 ? null : strongest,
  };
}

function milestoneProgress(
  population: number,
  milestone: MilestoneBlock | null,
): { readonly percent: number; readonly target: number } | null {
  if (milestone === null || milestone.populationTarget <= 0) {
    return null;
  }
  return {
    percent: Math.min(100, Math.floor((population * 100) / milestone.populationTarget)),
    target: milestone.populationTarget,
  };
}

export function CityStatusPanel({ store }: { readonly store: UiStore }): ReactNode {
  const population = useUiStore(store, (s) => s.population);
  const fundsCents = useUiStore(store, (s) => s.fundsCents);
  const demand = useUiStore(store, (s) => s.demand);
  const report = useUiStore(store, (s) => s.report);
  const milestone = useUiStore(store, (s) => s.milestone);
  const advisorEvents = useUiStore(store, (s) => s.advisorEvents);

  const netCents = reportNet(report);
  const cash = cashState(fundsCents, netCents);
  const demandReadout = demandSummary(demand);
  const progress = milestoneProgress(population, milestone);
  const maxSeverity = advisorEvents.reduce((max, event) => Math.max(max, event.severity), 0);
  const severityLabel = SEVERITY_LABELS[maxSeverity] ?? "cityStatus.advisors.notice";

  return (
    <section aria-label={t("cityStatus.title")} data-testid="city-status-panel">
      <h2>{t("cityStatus.title")}</h2>
      <dl>
        <div data-testid="city-status-cash" data-state={cash.state}>
          <dt>{t("cityStatus.cash")}</dt>
          <dd>
            <strong>{t(cash.label)}</strong>{" "}
            {netCents !== null && (
              <output data-testid="city-status-net" data-cents={netCents}>
                {formatSignedCents(netCents)}
              </output>
            )}
          </dd>
        </div>
        <div data-testid="city-status-demand" data-pressure={demandReadout.pressure}>
          <dt>{t("cityStatus.demand")}</dt>
          <dd>
            {demandReadout.strongest === null ? (
              t("cityStatus.demand.quiet")
            ) : (
              <>
                <span data-testid="city-status-demand-sector">
                  {t(demandReadout.strongest.label)}
                </span>{" "}
                <output data-testid="city-status-demand-value">
                  {demandReadout.strongest.value}
                </output>{" "}
                <span>
                  {t("cityStatus.demand.pressure")}{" "}
                  <output data-testid="city-status-demand-pressure">
                    {demandReadout.pressure}
                  </output>
                </span>
              </>
            )}
          </dd>
        </div>
        <div data-testid="city-status-milestone">
          <dt>{t("cityStatus.milestone")}</dt>
          <dd>
            {progress === null ? (
              t("cityStatus.milestone.none")
            ) : (
              <>
                <output
                  data-testid="city-status-milestone-progress"
                  data-percent={progress.percent}
                >
                  {progress.percent}%
                </output>{" "}
                <span>
                  {t("cityStatus.milestone.target")} {formatCount(progress.target)}
                </span>
              </>
            )}
          </dd>
        </div>
        <div data-testid="city-status-advisors" data-severity={maxSeverity}>
          <dt>{t("cityStatus.advisors")}</dt>
          <dd>
            <strong>{t(severityLabel)}</strong>{" "}
            <output data-testid="city-status-advisor-count">
              {formatCount(advisorEvents.length)}
            </output>
          </dd>
        </div>
      </dl>
    </section>
  );
}
