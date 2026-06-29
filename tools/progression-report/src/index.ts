import {
  MILESTONE_POPULATIONS,
  nextMilestonePopulation,
  Unlock,
  unlockedMask,
} from "@civitect/sim";

export type UnlockStatus = "active" | "reserved" | "stub";

export interface UnlockMetadata {
  readonly bit: number;
  readonly key: string;
  readonly label: string;
  readonly status: UnlockStatus;
  readonly problemClass: string;
}

export interface ProgressionStep {
  readonly milestoneIndex: number;
  readonly label: string;
  readonly population: number;
  readonly nextPopulation: number;
  readonly cumulativeMask: number;
  readonly cumulativeUnlocks: readonly UnlockMetadata[];
  readonly newlyUnlocked: readonly UnlockMetadata[];
}

export interface ProgressionWarning {
  readonly code:
    | "no-new-unlock"
    | "reserved-unlock"
    | "stub-unlock"
    | "large-population-gap"
    | "unknown-unlock-bit";
  readonly milestoneIndex: number;
  readonly severity: "watch" | "fail";
  readonly message: string;
}

export interface ProgressionReport {
  readonly steps: readonly ProgressionStep[];
  readonly warnings: readonly ProgressionWarning[];
}

export interface ProgressionReportOptions {
  /** Warn when the next milestone is more than this ratio of the previous one. */
  readonly maxGapPermille: number;
}

export const DEFAULT_OPTIONS: ProgressionReportOptions = {
  maxGapPermille: 2500,
};

export const UNLOCK_METADATA: readonly UnlockMetadata[] = [
  {
    bit: Unlock.budgetPanel,
    key: "budgetPanel",
    label: "Budget panel",
    status: "active",
    problemClass: "monthly budget pressure",
  },
  {
    bit: Unlock.loans,
    key: "loans",
    label: "Loans",
    status: "active",
    problemClass: "early cash-flow recovery",
  },
  {
    bit: Unlock.districts,
    key: "districts",
    label: "Districts",
    status: "reserved",
    problemClass: "neighborhood identity and boundaries",
  },
  {
    bit: Unlock.policies,
    key: "policies",
    label: "Policies",
    status: "reserved",
    problemClass: "local tradeoffs and specialization",
  },
  {
    bit: Unlock.highDensity,
    key: "highDensity",
    label: "High density",
    status: "active",
    problemClass: "space pressure and upzoning",
  },
  {
    bit: Unlock.transit,
    key: "transit",
    label: "Transit",
    status: "reserved",
    problemClass: "mode shift and line design",
  },
  {
    bit: Unlock.uniques,
    key: "uniques",
    label: "Unique buildings",
    status: "active",
    problemClass: "city identity and tourism goals",
  },
  {
    bit: Unlock.congestionPricing,
    key: "congestionPricing",
    label: "Congestion pricing",
    status: "stub",
    problemClass: "downtown demand management",
  },
  {
    bit: Unlock.airport,
    key: "airport",
    label: "Airport",
    status: "stub",
    problemClass: "late-game tourism and regional access",
  },
];

const UNLOCK_BY_BIT = new Map(UNLOCK_METADATA.map((unlock) => [unlock.bit, unlock]));

function optionsWith(overrides: Partial<ProgressionReportOptions> = {}): ProgressionReportOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function bitValues(mask: number): readonly number[] {
  const bits: number[] = [];
  for (let bit = 1; bit <= mask; bit <<= 1) {
    if ((mask & bit) !== 0) {
      bits.push(bit);
    }
  }
  return bits;
}

function metadataForMask(mask: number): readonly UnlockMetadata[] {
  return bitValues(mask)
    .map((bit) => UNLOCK_BY_BIT.get(bit))
    .filter((unlock): unlock is UnlockMetadata => unlock !== undefined)
    .sort((a, b) => a.bit - b.bit);
}

function unknownBits(mask: number): readonly number[] {
  return bitValues(mask).filter((bit) => !UNLOCK_BY_BIT.has(bit));
}

function stepLabel(milestoneIndex: number): string {
  return milestoneIndex === 0 ? "Founding" : `Milestone ${milestoneIndex}`;
}

function stepPopulation(milestoneIndex: number): number {
  return milestoneIndex === 0 ? 0 : (MILESTONE_POPULATIONS[milestoneIndex - 1] as number);
}

export function summarizeProgression(): readonly ProgressionStep[] {
  const steps: ProgressionStep[] = [];
  let previousMask = 0;
  for (let milestoneIndex = 0; milestoneIndex <= MILESTONE_POPULATIONS.length; milestoneIndex++) {
    const cumulativeMask = unlockedMask(milestoneIndex);
    const newlyUnlockedMask = cumulativeMask & ~previousMask;
    steps.push({
      milestoneIndex,
      label: stepLabel(milestoneIndex),
      population: stepPopulation(milestoneIndex),
      nextPopulation: nextMilestonePopulation(milestoneIndex),
      cumulativeMask,
      cumulativeUnlocks: metadataForMask(cumulativeMask),
      newlyUnlocked: metadataForMask(newlyUnlockedMask),
    });
    previousMask = cumulativeMask;
  }
  return steps;
}

export function scoreProgression(
  steps: readonly ProgressionStep[],
  optionOverrides: Partial<ProgressionReportOptions> = {},
): readonly ProgressionWarning[] {
  const options = optionsWith(optionOverrides);
  const warnings: ProgressionWarning[] = [];
  for (const step of steps) {
    if (step.newlyUnlocked.length === 0) {
      warnings.push({
        code: "no-new-unlock",
        milestoneIndex: step.milestoneIndex,
        severity: "watch",
        message: `${step.label} grants no newly visible mechanic.`,
      });
    }
    for (const unlock of step.newlyUnlocked) {
      if (unlock.status === "reserved") {
        warnings.push({
          code: "reserved-unlock",
          milestoneIndex: step.milestoneIndex,
          severity: "watch",
          message: `${step.label} grants ${unlock.label}, but that mechanic is still reserved.`,
        });
      }
      if (unlock.status === "stub") {
        warnings.push({
          code: "stub-unlock",
          milestoneIndex: step.milestoneIndex,
          severity: "watch",
          message: `${step.label} grants ${unlock.label}, but that mechanic is still stubbed.`,
        });
      }
    }
    for (const bit of unknownBits(step.cumulativeMask)) {
      warnings.push({
        code: "unknown-unlock-bit",
        milestoneIndex: step.milestoneIndex,
        severity: "fail",
        message: `${step.label} exposes unknown unlock bit ${bit}.`,
      });
    }
  }
  for (let i = 2; i < steps.length; i++) {
    const previousPopulation = steps[i - 1]?.population ?? 0;
    const population = steps[i]?.population ?? 0;
    if (previousPopulation === 0) {
      continue;
    }
    const ratioPermille = Math.floor((population * 1000) / previousPopulation);
    if (ratioPermille > options.maxGapPermille) {
      warnings.push({
        code: "large-population-gap",
        milestoneIndex: steps[i]?.milestoneIndex ?? i,
        severity: "watch",
        message: `${steps[i]?.label ?? `Milestone ${i}`} is ${ratioPermille} permille of the previous population gate.`,
      });
    }
  }
  return warnings.sort(
    (a, b) => a.milestoneIndex - b.milestoneIndex || a.code.localeCompare(b.code),
  );
}

export function buildProgressionReport(
  optionOverrides: Partial<ProgressionReportOptions> = {},
): ProgressionReport {
  const steps = summarizeProgression();
  return {
    steps,
    warnings: scoreProgression(steps, optionOverrides),
  };
}

function formatUnlocks(unlocks: readonly UnlockMetadata[]): string {
  return unlocks.length === 0
    ? "none"
    : unlocks.map((unlock) => `${unlock.label} (${unlock.status})`).join(", ");
}

export function renderProgressionReport(report: ProgressionReport): string {
  const lines = [
    "# Progression Report",
    "",
    "| milestone | population | next | newly unlocked | cumulative active |",
    "|---|---:|---:|---|---|",
  ];
  for (const step of report.steps) {
    const active = step.cumulativeUnlocks.filter((unlock) => unlock.status === "active");
    lines.push(
      `| ${step.label} | ${step.population} | ${step.nextPopulation} | ${formatUnlocks(
        step.newlyUnlocked,
      )} | ${formatUnlocks(active)} |`,
    );
  }
  lines.push("", "## Warnings", "");
  if (report.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of report.warnings) {
      lines.push(
        `- ${warning.severity} ${warning.code} at milestone ${warning.milestoneIndex}: ${warning.message}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
