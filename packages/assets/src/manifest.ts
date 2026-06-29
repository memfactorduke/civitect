export const RuntimeAssetCategory = {
  terrainRoads: "terrain-roads",
  residential: "residential",
  commercial: "commercial",
  industrial: "industrial",
  office: "office",
  services: "services",
  agents: "agents",
  effects: "effects",
  uiIcons: "ui-icons",
} as const;
export type RuntimeAssetCategory = (typeof RuntimeAssetCategory)[keyof typeof RuntimeAssetCategory];

export const RuntimeAssetState = {
  normal: "normal",
  construction: "construction",
  abandoned: "abandoned",
  emissiveMask: "emissive-mask",
} as const;
export type RuntimeAssetState = (typeof RuntimeAssetState)[keyof typeof RuntimeAssetState];

export const RuntimeAssetStatus = {
  placeholder: "placeholder",
  candidate: "candidate",
  accepted: "accepted",
} as const;
export type RuntimeAssetStatus = (typeof RuntimeAssetStatus)[keyof typeof RuntimeAssetStatus];

export const DEFAULT_REQUIRED_RUNTIME_CATEGORIES: readonly RuntimeAssetCategory[] = [
  RuntimeAssetCategory.terrainRoads,
  RuntimeAssetCategory.residential,
  RuntimeAssetCategory.commercial,
  RuntimeAssetCategory.industrial,
  RuntimeAssetCategory.office,
  RuntimeAssetCategory.services,
  RuntimeAssetCategory.agents,
  RuntimeAssetCategory.effects,
  RuntimeAssetCategory.uiIcons,
];

export const REQUIRED_ACCEPTED_BUILDING_STATES: readonly RuntimeAssetState[] = [
  RuntimeAssetState.normal,
  RuntimeAssetState.construction,
  RuntimeAssetState.abandoned,
  RuntimeAssetState.emissiveMask,
];

const BUILDING_CATEGORIES: ReadonlySet<RuntimeAssetCategory> = new Set([
  RuntimeAssetCategory.residential,
  RuntimeAssetCategory.commercial,
  RuntimeAssetCategory.industrial,
  RuntimeAssetCategory.office,
  RuntimeAssetCategory.services,
]);

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(Object.values(RuntimeAssetCategory));
const KNOWN_STATES: ReadonlySet<string> = new Set(Object.values(RuntimeAssetState));
const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface RuntimeAssetManifestEntry {
  readonly id: string;
  readonly category: RuntimeAssetCategory;
  readonly status: RuntimeAssetStatus;
  readonly sidecar: string;
  readonly footprint: { readonly w: number; readonly d: number };
  readonly anchor: { readonly x: number; readonly y: number };
  readonly states: Readonly<Partial<Record<RuntimeAssetState, string>>>;
}

export interface RuntimeAssetManifestOptions {
  readonly requiredCategories?: readonly RuntimeAssetCategory[];
  readonly warnOnPlaceholders?: boolean;
}

export interface RuntimeAssetManifestIssue {
  readonly severity: "error" | "warning";
  readonly rule:
    | "anchor"
    | "category-coverage"
    | "category-known"
    | "duplicate-id"
    | "footprint"
    | "id"
    | "placeholder"
    | "sidecar"
    | "state-file"
    | "state-known"
    | "state-missing";
  readonly message: string;
  readonly asset?: string;
  readonly category?: RuntimeAssetCategory;
}

export interface RuntimeAssetSummary {
  readonly total: number;
  readonly accepted: number;
  readonly candidate: number;
  readonly placeholder: number;
  readonly categories: Readonly<Record<RuntimeAssetCategory, number>>;
  readonly states: Readonly<Partial<Record<RuntimeAssetState, number>>>;
}

export interface RuntimeAssetManifestReport {
  readonly readyForRuntime: boolean;
  readonly hasBlockingErrors: boolean;
  readonly summary: RuntimeAssetSummary;
  readonly issues: readonly RuntimeAssetManifestIssue[];
}

function categoryCounts(): Record<RuntimeAssetCategory, number> {
  return {
    [RuntimeAssetCategory.terrainRoads]: 0,
    [RuntimeAssetCategory.residential]: 0,
    [RuntimeAssetCategory.commercial]: 0,
    [RuntimeAssetCategory.industrial]: 0,
    [RuntimeAssetCategory.office]: 0,
    [RuntimeAssetCategory.services]: 0,
    [RuntimeAssetCategory.agents]: 0,
    [RuntimeAssetCategory.effects]: 0,
    [RuntimeAssetCategory.uiIcons]: 0,
  };
}

function stateCounts(): Partial<Record<RuntimeAssetState, number>> {
  return {
    [RuntimeAssetState.normal]: 0,
    [RuntimeAssetState.construction]: 0,
    [RuntimeAssetState.abandoned]: 0,
    [RuntimeAssetState.emissiveMask]: 0,
  };
}

function assetKey(asset: RuntimeAssetManifestEntry): string {
  return `${asset.category}/${asset.id}`;
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validateAsset(
  asset: RuntimeAssetManifestEntry,
  seen: Set<string>,
): readonly RuntimeAssetManifestIssue[] {
  const issues: RuntimeAssetManifestIssue[] = [];
  const key = assetKey(asset);

  if (!KNOWN_CATEGORIES.has(asset.category)) {
    issues.push({
      severity: "error",
      rule: "category-known",
      message: `unknown runtime asset category "${asset.category}"`,
      asset: key,
    });
  }

  if (!KEBAB_ID.test(asset.id)) {
    issues.push({
      severity: "error",
      rule: "id",
      message: `asset id must be kebab-case, got "${asset.id}"`,
      asset: key,
    });
  }

  if (seen.has(key)) {
    issues.push({
      severity: "error",
      rule: "duplicate-id",
      message: `duplicate runtime asset id "${key}"`,
      asset: key,
    });
  }
  seen.add(key);

  if (!asset.sidecar.endsWith(".json")) {
    issues.push({
      severity: "error",
      rule: "sidecar",
      message: `sidecar must point at a .json file, got "${asset.sidecar}"`,
      asset: key,
    });
  }

  if (
    !isPositiveInt(asset.footprint.w) ||
    !isPositiveInt(asset.footprint.d) ||
    asset.footprint.w > 8 ||
    asset.footprint.d > 8
  ) {
    issues.push({
      severity: "error",
      rule: "footprint",
      message: "footprint must use positive integer tile dimensions in [1, 8]",
      asset: key,
    });
  }

  if (!isNonNegativeInt(asset.anchor.x) || !isNonNegativeInt(asset.anchor.y)) {
    issues.push({
      severity: "error",
      rule: "anchor",
      message: "anchor must use non-negative integer source pixels",
      asset: key,
    });
  }

  for (const [state, file] of Object.entries(asset.states)) {
    if (!KNOWN_STATES.has(state)) {
      issues.push({
        severity: "error",
        rule: "state-known",
        message: `unknown runtime asset state "${state}"`,
        asset: key,
      });
    }
    if (typeof file !== "string" || !file.endsWith(".png")) {
      issues.push({
        severity: "error",
        rule: "state-file",
        message: `state "${state}" must point at a .png file`,
        asset: key,
      });
    }
  }

  if (asset.states[RuntimeAssetState.normal] === undefined) {
    issues.push({
      severity: "error",
      rule: "state-missing",
      message: 'every runtime asset must carry the "normal" sprite state',
      asset: key,
    });
  }

  if (asset.status === RuntimeAssetStatus.accepted && BUILDING_CATEGORIES.has(asset.category)) {
    for (const state of REQUIRED_ACCEPTED_BUILDING_STATES) {
      if (asset.states[state] === undefined) {
        issues.push({
          severity: "error",
          rule: "state-missing",
          message: `accepted building asset "${key}" is missing "${state}"`,
          asset: key,
        });
      }
    }
  }

  return issues;
}

export function analyzeRuntimeAssetManifest(
  entries: readonly RuntimeAssetManifestEntry[],
  options: RuntimeAssetManifestOptions = {},
): RuntimeAssetManifestReport {
  const requiredCategories = options.requiredCategories ?? DEFAULT_REQUIRED_RUNTIME_CATEGORIES;
  const warnOnPlaceholders = options.warnOnPlaceholders ?? true;
  const categories = categoryCounts();
  const states = stateCounts();
  const seen = new Set<string>();
  const issues: RuntimeAssetManifestIssue[] = [];
  let accepted = 0;
  let candidate = 0;
  let placeholder = 0;

  for (const entry of entries) {
    categories[entry.category] += 1;
    if (entry.status === RuntimeAssetStatus.accepted) {
      accepted += 1;
    } else if (entry.status === RuntimeAssetStatus.candidate) {
      candidate += 1;
    } else {
      placeholder += 1;
      if (warnOnPlaceholders) {
        issues.push({
          severity: "warning",
          rule: "placeholder",
          message: `runtime asset "${assetKey(entry)}" is still a placeholder`,
          asset: assetKey(entry),
        });
      }
    }

    for (const state of Object.keys(entry.states)) {
      if (KNOWN_STATES.has(state)) {
        const knownState = state as RuntimeAssetState;
        states[knownState] = (states[knownState] ?? 0) + 1;
      }
    }

    issues.push(...validateAsset(entry, seen));
  }

  for (const category of requiredCategories) {
    if (categories[category] === 0) {
      issues.push({
        severity: "warning",
        rule: "category-coverage",
        message: `runtime asset category "${category}" has no entries`,
        category,
      });
    }
  }

  const hasBlockingErrors = issues.some((issue) => issue.severity === "error");

  return {
    readyForRuntime: issues.length === 0,
    hasBlockingErrors,
    summary: {
      total: entries.length,
      accepted,
      candidate,
      placeholder,
      categories,
      states,
    },
    issues,
  };
}
