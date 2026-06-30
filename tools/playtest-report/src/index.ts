import { aggregates, BuildingStatus, TICKS_PER_GAME_YEAR, type World } from "@civitect/sim";

export interface PlaytestSummary {
  readonly name: string;
  readonly tick: number;
  readonly gameYears: number;
  readonly population: number;
  readonly fundsCents: number;
  readonly milestoneIndex: number;
  readonly aliveBuildings: number;
  readonly abandonedBuildings: number;
  readonly abandonmentPermille: number;
  readonly housingCapacity: number;
  readonly adults: number;
  readonly employed: number;
  readonly unemploymentPermille: number;
  readonly jobs: number;
  readonly loansActive: number;
  readonly monthlyNetCents: number | null;
  readonly topDrains: readonly ReportLineDrain[];
}

export interface ReportLineDrain {
  readonly kind: number;
  readonly label: string;
  readonly amountCents: number;
}

export interface PlaytestThresholds {
  readonly minPopulation: number;
  readonly minFundsCents: number;
  readonly minMonthlyNetCents: number;
  readonly maxAbandonmentPermille: number;
  readonly maxUnemploymentPermille: number;
  readonly requireMonthlyReport: boolean;
}

export interface PlaytestWarning {
  readonly code:
    | "stalled-growth"
    | "solvency-risk"
    | "budget-drain"
    | "abandonment-pressure"
    | "labor-mismatch"
    | "housing-shortage"
    | "missing-report";
  readonly severity: "watch" | "fail";
  readonly message: string;
}

export interface ScoredPlaytestSummary {
  readonly summary: PlaytestSummary;
  readonly warnings: readonly PlaytestWarning[];
}

export const DEFAULT_THRESHOLDS: PlaytestThresholds = {
  minPopulation: 240,
  minFundsCents: 0,
  minMonthlyNetCents: -50_000_00,
  maxAbandonmentPermille: 100,
  maxUnemploymentPermille: 600,
  requireMonthlyReport: false,
};

const REPORT_LINE_LABELS: readonly string[] = [
  "Residential tax",
  "Commercial tax",
  "Industrial tax",
  "Office tax",
  "Service upkeep",
  "Road maintenance",
  "Loan principal",
  "Loan interest",
  "Imports",
  "Exports",
  "Tourism",
  "Bailout",
  "Construction",
];

function thresholdsWith(overrides: Partial<PlaytestThresholds> = {}): PlaytestThresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}

function reportLabel(kind: number): string {
  return REPORT_LINE_LABELS[kind - 1] ?? `Report line ${kind}`;
}

function reportNet(lines: readonly number[] | undefined): number | null {
  if (lines === undefined || lines.length === 0) {
    return null;
  }
  return lines.reduce((sum, amount) => sum + amount, 0);
}

function topDrains(lines: readonly number[] | undefined): readonly ReportLineDrain[] {
  if (lines === undefined) {
    return [];
  }
  return lines
    .map((amountCents, i) => ({ kind: i + 1, label: reportLabel(i + 1), amountCents }))
    .filter((line) => line.amountCents < 0)
    .sort((a, b) => a.amountCents - b.amountCents || a.kind - b.kind)
    .slice(0, 3);
}

function countBuildingStates(world: World): {
  readonly aliveBuildings: number;
  readonly abandonedBuildings: number;
} {
  let aliveBuildings = 0;
  let abandonedBuildings = 0;
  const b = world.buildings;
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    aliveBuildings++;
    const status = b.status[i] as number;
    if (status === BuildingStatus.abandoned || status === BuildingStatus.ruin) {
      abandonedBuildings++;
    }
  }
  return { aliveBuildings, abandonedBuildings };
}

export function summarizeWorld(name: string, world: World): PlaytestSummary {
  const agg = aggregates(world.buildings);
  const { aliveBuildings, abandonedBuildings } = countBuildingStates(world);
  const jobs = agg.jobsC + agg.jobsI + agg.jobsO;
  const unemploymentPermille =
    agg.adults === 0 ? 0 : Math.floor(((agg.adults - agg.employed) * 1000) / agg.adults);
  const abandonmentPermille =
    aliveBuildings === 0 ? 0 : Math.floor((abandonedBuildings * 1000) / aliveBuildings);
  const lastMonthCents = world.economy.lastMonthCents;

  return {
    name,
    tick: world.tick,
    gameYears: world.tick / TICKS_PER_GAME_YEAR,
    population: world.population,
    fundsCents: world.fundsCents,
    milestoneIndex: world.economy.milestoneIndex,
    aliveBuildings,
    abandonedBuildings,
    abandonmentPermille,
    housingCapacity: agg.housingCapacity,
    adults: agg.adults,
    employed: agg.employed,
    unemploymentPermille,
    jobs,
    loansActive: world.economy.loans.filter(
      (loan) => loan.monthsLeft > 0 && loan.principalCents > 0,
    ).length,
    monthlyNetCents: reportNet(lastMonthCents),
    topDrains: topDrains(lastMonthCents),
  };
}

export function scorePlaytest(
  summary: PlaytestSummary,
  thresholdOverrides: Partial<PlaytestThresholds> = {},
): readonly PlaytestWarning[] {
  const thresholds = thresholdsWith(thresholdOverrides);
  const warnings: PlaytestWarning[] = [];
  if (summary.population < thresholds.minPopulation) {
    warnings.push({
      code: "stalled-growth",
      severity: "fail",
      message: `Population ${summary.population} is below target ${thresholds.minPopulation}.`,
    });
  }
  if (summary.fundsCents < thresholds.minFundsCents) {
    warnings.push({
      code: "solvency-risk",
      severity: "fail",
      message: `Funds ${formatCents(summary.fundsCents)} are below ${formatCents(
        thresholds.minFundsCents,
      )}.`,
    });
  }
  const missingRequiredReport =
    thresholds.requireMonthlyReport &&
    (summary.monthlyNetCents === null ||
      (summary.monthlyNetCents === 0 && summary.topDrains.length === 0));
  if (missingRequiredReport) {
    warnings.push({
      code: "missing-report",
      severity: "fail",
      message: "No completed monthly report is available for post-mortem review.",
    });
  } else if (
    summary.monthlyNetCents !== null &&
    summary.monthlyNetCents < thresholds.minMonthlyNetCents
  ) {
    warnings.push({
      code: "budget-drain",
      severity: "watch",
      message: `Monthly net ${formatCents(summary.monthlyNetCents)} is below ${formatCents(
        thresholds.minMonthlyNetCents,
      )}.`,
    });
  }
  if (summary.abandonmentPermille > thresholds.maxAbandonmentPermille) {
    warnings.push({
      code: "abandonment-pressure",
      severity: "fail",
      message: `${summary.abandonmentPermille} permille of live buildings are abandoned or ruined.`,
    });
  }
  if (summary.unemploymentPermille > thresholds.maxUnemploymentPermille) {
    warnings.push({
      code: "labor-mismatch",
      severity: "watch",
      message: `${summary.unemploymentPermille} permille adult unemployment suggests a jobs/skills mismatch.`,
    });
  }
  if (summary.population > summary.housingCapacity) {
    warnings.push({
      code: "housing-shortage",
      severity: "watch",
      message: `Population ${summary.population} exceeds housing capacity ${summary.housingCapacity}.`,
    });
  }
  return warnings;
}

export function scorePlaytests(
  summaries: readonly PlaytestSummary[],
  thresholdOverrides: Partial<PlaytestThresholds> = {},
): readonly ScoredPlaytestSummary[] {
  return summaries
    .map((summary) => ({
      summary,
      warnings: scorePlaytest(summary, thresholdOverrides),
    }))
    .sort((a, b) => a.summary.name.localeCompare(b.summary.name));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${centsPart}`;
}

function formatNet(cents: number | null): string {
  return cents === null ? "n/a" : formatCents(cents);
}

function warningText(warnings: readonly PlaytestWarning[]): string {
  return warnings.length === 0 ? "OK" : warnings.map((w) => w.code).join(", ");
}

export function renderPlaytestReport(
  summaries: readonly PlaytestSummary[],
  thresholdOverrides: Partial<PlaytestThresholds> = {},
): string {
  const scored = scorePlaytests(summaries, thresholdOverrides);
  const lines = [
    "# Playtest Health Report",
    "",
    "| city | years | pop | funds | milestone | monthly net | abandoned | unemployment | warnings |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const { summary, warnings } of scored) {
    lines.push(
      `| ${summary.name} | ${summary.gameYears.toFixed(2)} | ${summary.population} | ${formatCents(
        summary.fundsCents,
      )} | ${summary.milestoneIndex} | ${formatNet(summary.monthlyNetCents)} | ${
        summary.abandonmentPermille
      } permille | ${summary.unemploymentPermille} permille | ${warningText(warnings)} |`,
    );
  }
  lines.push("", "## Largest Drains", "");
  for (const { summary } of scored) {
    const drains =
      summary.topDrains.length === 0
        ? "none"
        : summary.topDrains
            .map((line) => `${line.label} ${formatCents(line.amountCents)}`)
            .join(", ");
    lines.push(`- ${summary.name}: ${drains}`);
  }
  lines.push("");
  return lines.join("\n");
}
