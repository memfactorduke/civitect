import { Achievement } from "@civitect/sim";

export type AchievementCategory =
  | "growth"
  | "economy"
  | "services"
  | "mastery"
  | "tourism"
  | "survival"
  | "absurd";

export interface AchievementMetadata {
  readonly bit: number;
  readonly key: string;
  readonly label: string;
  readonly category: AchievementCategory;
  readonly trigger: string;
  readonly reviewNote: string;
}

export interface CategorySummary {
  readonly category: AchievementCategory;
  readonly count: number;
  readonly bits: readonly number[];
}

export interface AchievementReportWarning {
  readonly code:
    | "catalog-shortfall"
    | "category-gap"
    | "duplicate-bit"
    | "metadata-drift"
    | "slot-pressure"
    | "unmapped-public-achievement";
  readonly severity: "watch" | "fail";
  readonly message: string;
}

export interface AchievementReportOptions {
  readonly targetCount: number;
  readonly totalSlots: number;
  readonly requiredCategories: readonly AchievementCategory[];
}

export interface AchievementReport {
  readonly implementedCount: number;
  readonly targetCount: number;
  readonly totalSlots: number;
  readonly remainingToTarget: number;
  readonly freeSlots: number;
  readonly achievements: readonly AchievementMetadata[];
  readonly categorySummary: readonly CategorySummary[];
  readonly warnings: readonly AchievementReportWarning[];
}

export const DEFAULT_OPTIONS: AchievementReportOptions = {
  targetCount: 60,
  totalSlots: 64,
  requiredCategories: ["growth", "economy", "services", "mastery", "tourism", "survival", "absurd"],
};

export const ACHIEVEMENT_METADATA: readonly AchievementMetadata[] = [
  {
    bit: Achievement.firstHundred,
    key: "firstHundred",
    label: "First Hundred",
    category: "growth",
    trigger: "Reach population 100.",
    reviewNote: "Early growth acknowledgement.",
  },
  {
    bit: Achievement.firstThousand,
    key: "firstThousand",
    label: "First Thousand",
    category: "growth",
    trigger: "Reach population 1,000.",
    reviewNote: "Confirms the first village-to-town ramp.",
  },
  {
    bit: Achievement.tenThousand,
    key: "tenThousand",
    label: "Ten Thousand",
    category: "growth",
    trigger: "Reach population 10,000.",
    reviewNote: "Mid-game scale marker.",
  },
  {
    bit: Achievement.hundredThousand,
    key: "hundredThousand",
    label: "Hundred Thousand",
    category: "growth",
    trigger: "Reach population 100,000.",
    reviewNote: "Large-city scale marker.",
  },
  {
    bit: Achievement.firstLoan,
    key: "firstLoan",
    label: "First Loan",
    category: "economy",
    trigger: "Take any loan.",
    reviewNote: "Introduces debt as a recoverable pressure tool.",
  },
  {
    bit: Achievement.debtFree,
    key: "debtFree",
    label: "Debt Free",
    category: "economy",
    trigger: "After taking a loan, repay all loans while funds are non-negative.",
    reviewNote: "Rewards clean budget recovery.",
  },
  {
    bit: Achievement.greenCity,
    key: "greenCity",
    label: "Green City",
    category: "services",
    trigger: "Build at least five parks.",
    reviewNote: "Tracks leisure/service investment.",
  },
  {
    bit: Achievement.industrialist,
    key: "industrialist",
    label: "Industrialist",
    category: "mastery",
    trigger: "Grow at least 20 industrial buildings.",
    reviewNote: "Tracks an industry-heavy playstyle.",
  },
  {
    bit: Achievement.tourismMagnet,
    key: "tourismMagnet",
    label: "Tourism Magnet",
    category: "tourism",
    trigger: "Reach 500 tourism arrivals.",
    reviewNote: "Tracks city attractiveness and visitor flow.",
  },
  {
    bit: Achievement.survivedBankruptcy,
    key: "survivedBankruptcy",
    label: "Survived Bankruptcy",
    category: "survival",
    trigger: "Use bailout/receivership and recover funds to non-negative.",
    reviewNote: "Turns failure recovery into an explicit goal.",
  },
];

function optionsWith(overrides: Partial<AchievementReportOptions> = {}): AchievementReportOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function publicAchievementBits(): readonly number[] {
  return Object.values(Achievement).sort((a, b) => a - b);
}

function bitCounts(achievements: readonly AchievementMetadata[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const achievement of achievements) {
    counts.set(achievement.bit, (counts.get(achievement.bit) ?? 0) + 1);
  }
  return counts;
}

function categorySummaries(
  achievements: readonly AchievementMetadata[],
  requiredCategories: readonly AchievementCategory[],
): readonly CategorySummary[] {
  return [...requiredCategories]
    .sort((a, b) => a.localeCompare(b))
    .map((category) => {
      const bits = achievements
        .filter((achievement) => achievement.category === category)
        .map((achievement) => achievement.bit)
        .sort((a, b) => a - b);
      return { category, count: bits.length, bits };
    });
}

function scoreReport(
  achievements: readonly AchievementMetadata[],
  options: AchievementReportOptions,
): readonly AchievementReportWarning[] {
  const warnings: AchievementReportWarning[] = [];
  const publicBits = publicAchievementBits();
  const publicBitSet = new Set(publicBits);
  const metadataBitSet = new Set(achievements.map((achievement) => achievement.bit));
  const counts = bitCounts(achievements);
  const remainingToTarget = Math.max(0, options.targetCount - achievements.length);
  const freeSlots = Math.max(0, options.totalSlots - achievements.length);

  if (achievements.length < options.targetCount) {
    warnings.push({
      code: "catalog-shortfall",
      severity: "watch",
      message: `Implemented ${achievements.length} achievements; GDD target is about ${options.targetCount}.`,
    });
  }
  if (remainingToTarget > freeSlots) {
    warnings.push({
      code: "slot-pressure",
      severity: "fail",
      message: `${remainingToTarget} achievements remain to target, but only ${freeSlots} bit slots are free.`,
    });
  }
  for (const bit of publicBits) {
    if (!metadataBitSet.has(bit)) {
      warnings.push({
        code: "unmapped-public-achievement",
        severity: "fail",
        message: `Public achievement bit ${bit} has no report metadata.`,
      });
    }
  }
  for (const [bit, count] of counts) {
    if (count > 1) {
      warnings.push({
        code: "duplicate-bit",
        severity: "fail",
        message: `Achievement bit ${bit} appears ${count} times in report metadata.`,
      });
    }
    if (!publicBitSet.has(bit)) {
      warnings.push({
        code: "metadata-drift",
        severity: "fail",
        message: `Report metadata references bit ${bit}, which is not exported by the sim.`,
      });
    }
  }
  for (const category of options.requiredCategories) {
    if (!achievements.some((achievement) => achievement.category === category)) {
      warnings.push({
        code: "category-gap",
        severity: "watch",
        message: `No implemented achievement currently covers the ${category} category.`,
      });
    }
  }
  return warnings.sort(
    (a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message),
  );
}

export function buildAchievementReport(
  optionOverrides: Partial<AchievementReportOptions> = {},
): AchievementReport {
  const options = optionsWith(optionOverrides);
  const achievements = [...ACHIEVEMENT_METADATA].sort((a, b) => a.bit - b.bit);
  const remainingToTarget = Math.max(0, options.targetCount - achievements.length);
  const freeSlots = Math.max(0, options.totalSlots - achievements.length);
  return {
    implementedCount: achievements.length,
    targetCount: options.targetCount,
    totalSlots: options.totalSlots,
    remainingToTarget,
    freeSlots,
    achievements,
    categorySummary: categorySummaries(achievements, options.requiredCategories),
    warnings: scoreReport(achievements, options),
  };
}

export function renderAchievementReport(report: AchievementReport): string {
  const lines = [
    "# Achievement Report",
    "",
    `Implemented: ${report.implementedCount}/${report.targetCount}; free bit slots: ${report.freeSlots}/${report.totalSlots}.`,
    "",
    "| bit | key | category | trigger |",
    "|---:|---|---|---|",
  ];
  for (const achievement of report.achievements) {
    lines.push(
      `| ${achievement.bit} | ${achievement.key} | ${achievement.category} | ${achievement.trigger} |`,
    );
  }
  lines.push("", "## Category Mix", "", "| category | count | bits |", "|---|---:|---|");
  for (const summary of report.categorySummary) {
    lines.push(
      `| ${summary.category} | ${summary.count} | ${
        summary.bits.length === 0 ? "none" : summary.bits.join(", ")
      } |`,
    );
  }
  lines.push("", "## Warnings", "");
  if (report.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of report.warnings) {
      lines.push(`- ${warning.severity} ${warning.code}: ${warning.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
