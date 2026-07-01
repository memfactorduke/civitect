import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  parseSpriteSidecar,
  SPRITE_SOURCE_SCALE,
  SPRITE_TILE_3X,
  SpriteCategory,
  type SpriteSidecar,
  SpriteState,
} from "@civitect/protocol";
import { loadMasterPalette, type Rgb } from "./palette";
import { type SpriteIssue, validateParsedSprite } from "./validate";

export type AuditStatus =
  | "runtime-pass"
  | "runtime-fail"
  | "normalized-pass"
  | "normalized-fail"
  | "blocked";

export interface AuditIssue {
  readonly rule: SpriteIssue["rule"] | "mapping";
  readonly message: string;
}

export interface SpriteAudit {
  readonly path: string;
  readonly id: string;
  readonly rawCategory: string;
  readonly projectedCategory?: SpriteCategory;
  readonly status: AuditStatus;
  readonly notes: readonly string[];
  readonly issues: readonly AuditIssue[];
}

export interface SpriteAuditSummary {
  readonly roots: readonly string[];
  readonly jsonFiles: number;
  readonly skippedJsonFiles: number;
  readonly sidecars: readonly SpriteAudit[];
  readonly counts: Readonly<Record<AuditStatus, number>>;
  readonly rawCategories: Readonly<Record<string, number>>;
  readonly projectedCategories: Readonly<Record<string, number>>;
}

interface Projection {
  readonly sidecar?: SpriteSidecar;
  readonly projectedCategory?: SpriteCategory;
  readonly notes: readonly string[];
  readonly blockers: readonly string[];
}

interface SidecarLike extends Record<string, unknown> {
  readonly id: string;
  readonly category: string;
  readonly states: Record<string, unknown>;
}

const STATUS_ORDER: readonly AuditStatus[] = [
  "runtime-pass",
  "runtime-fail",
  "normalized-pass",
  "normalized-fail",
  "blocked",
];

const STATE_NAMES: ReadonlySet<string> = new Set(Object.values(SpriteState));

function inc(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function findJsonFiles(path: string): string[] {
  if (!existsSync(path)) {
    throw new Error(`${path}: path does not exist`);
  }

  const stat = statSync(path);
  if (stat.isFile()) {
    return path.endsWith(".json") ? [resolve(path)] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const out: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      out.push(...findJsonFiles(child));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(child);
    }
  }
  return out.sort();
}

function looksLikeSidecar(doc: unknown): doc is SidecarLike {
  return (
    isRecord(doc) &&
    typeof doc.id === "string" &&
    typeof doc.category === "string" &&
    isRecord(doc.states)
  );
}

function mapExplorationCategory(rawCategory: string): SpriteCategory | undefined {
  if (rawCategory.startsWith("roads/") || rawCategory.startsWith("terrain/")) {
    return SpriteCategory.terrainRoads;
  }
  if (rawCategory.startsWith("icons/")) {
    return SpriteCategory.uiIcons;
  }
  if (rawCategory.startsWith("buildings/growable/residential")) {
    return SpriteCategory.residential;
  }
  if (rawCategory.startsWith("buildings/growable/commercial")) {
    return SpriteCategory.commercial;
  }
  if (rawCategory.startsWith("buildings/growable/industrial")) {
    return SpriteCategory.industrial;
  }
  if (
    rawCategory.startsWith("building-office") ||
    rawCategory.startsWith("buildings/growable/office")
  ) {
    return SpriteCategory.office;
  }
  if (rawCategory.startsWith("hero/r-")) {
    return SpriteCategory.residential;
  }
  if (rawCategory.startsWith("hero/c-")) {
    return SpriteCategory.commercial;
  }
  return undefined;
}

function projectExplorationSidecar(doc: Record<string, unknown>, source: string): Projection {
  const notes: string[] = [];
  const blockers: string[] = [];
  const id = doc.id;
  const rawCategory = doc.category;
  if (typeof id !== "string" || typeof rawCategory !== "string") {
    return { notes, blockers: ["missing string id/category"] };
  }

  const projectedCategory = mapExplorationCategory(rawCategory);
  if (projectedCategory === undefined) {
    blockers.push(`no runtime SpriteCategory mapping for exploration category "${rawCategory}"`);
  } else if (projectedCategory !== rawCategory) {
    notes.push(`map category "${rawCategory}" to "${projectedCategory}"`);
  }

  if (doc.sourceScale !== undefined && doc.sourceScale !== SPRITE_SOURCE_SCALE) {
    blockers.push(
      `sourceScale must be ${SPRITE_SOURCE_SCALE}, got ${JSON.stringify(doc.sourceScale)}`,
    );
  }

  const tileMetric = doc.tileMetricPxAt3x;
  if (tileMetric !== undefined) {
    if (
      !isRecord(tileMetric) ||
      tileMetric.w !== SPRITE_TILE_3X.w ||
      tileMetric.h !== SPRITE_TILE_3X.h
    ) {
      blockers.push(
        `tileMetricPxAt3x must be ${SPRITE_TILE_3X.w}x${SPRITE_TILE_3X.h}, got ${JSON.stringify(tileMetric)}`,
      );
    }
  }

  const footprint = doc.footprint;
  if (!isRecord(footprint)) {
    blockers.push("missing footprint object");
  } else {
    if (footprint.unit !== undefined && footprint.unit !== "tile") {
      blockers.push(
        `footprint unit "${String(footprint.unit)}" is not runtime-eligible; current schema accepts tile footprints only`,
      );
    }
    if (!isPositiveInt(footprint.w) || !isPositiveInt(footprint.d)) {
      blockers.push(`footprint w/d must be positive integers, got ${JSON.stringify(footprint)}`);
    }
  }

  const canvas = doc.canvas;
  if (!isRecord(canvas) || !isPositiveInt(canvas.w) || !isPositiveInt(canvas.h)) {
    blockers.push(`canvas must have positive integer w/h px, got ${JSON.stringify(doc.canvas)}`);
  }

  const anchor = doc.anchor;
  if (!isRecord(anchor) || !isNonNegativeInt(anchor.x) || !isNonNegativeInt(anchor.y)) {
    blockers.push(
      `anchor must have non-negative integer x/y px, got ${JSON.stringify(doc.anchor)}`,
    );
  }

  const rawStates = doc.states;
  const states: Partial<Record<SpriteState, string>> = {};
  if (!isRecord(rawStates)) {
    blockers.push("states must be an object of state name to PNG filename");
  } else {
    for (const [state, file] of Object.entries(rawStates)) {
      if (!STATE_NAMES.has(state)) {
        blockers.push(`unknown state "${state}"`);
      } else if (typeof file !== "string" || !file.endsWith(".png")) {
        blockers.push(`state "${state}" must name a .png file, got ${JSON.stringify(file)}`);
      } else {
        states[state as SpriteState] = file;
      }
    }
  }

  const emissive = doc.emissive;
  if (isRecord(emissive) && typeof emissive.mask === "string") {
    states[SpriteState.emissiveMask] = emissive.mask;
    notes.push('move emissive.mask into states["emissive-mask"]');
  }

  if (states[SpriteState.normal] === undefined) {
    blockers.push('missing required "normal" state');
  }

  if (blockers.length > 0 || projectedCategory === undefined) {
    return { projectedCategory, notes, blockers };
  }

  const projectedDoc = {
    id,
    category: projectedCategory,
    footprint: {
      w: (footprint as Record<string, unknown>).w,
      d: (footprint as Record<string, unknown>).d,
    },
    canvas: {
      w: (canvas as Record<string, unknown>).w,
      h: (canvas as Record<string, unknown>).h,
    },
    anchor: {
      x: (anchor as Record<string, unknown>).x,
      y: (anchor as Record<string, unknown>).y,
    },
    states,
  };

  try {
    return {
      sidecar: parseSpriteSidecar(projectedDoc, `${source} (normalized projection)`),
      projectedCategory,
      notes,
      blockers,
    };
  } catch (error) {
    return {
      projectedCategory,
      notes,
      blockers: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function auditOne(path: string, palette: readonly Rgb[]): Promise<SpriteAudit | undefined> {
  const doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!looksLikeSidecar(doc)) {
    return undefined;
  }

  const id = doc.id;
  const rawCategory = doc.category;
  try {
    const sidecar = parseSpriteSidecar(doc, path);
    const report = await validateParsedSprite(sidecar, dirname(path), palette);
    return {
      path,
      id,
      rawCategory,
      projectedCategory: sidecar.category,
      status: report.issues.length === 0 ? "runtime-pass" : "runtime-fail",
      notes: [],
      issues: report.issues,
    };
  } catch (strictError) {
    const projection = projectExplorationSidecar(doc, path);
    const strictMessage = strictError instanceof Error ? strictError.message : String(strictError);
    const notes = [`strict schema rejected: ${strictMessage}`, ...projection.notes];
    if (projection.sidecar === undefined) {
      return {
        path,
        id,
        rawCategory,
        projectedCategory: projection.projectedCategory,
        status: "blocked",
        notes,
        issues: projection.blockers.map((message) => ({ rule: "mapping", message })),
      };
    }

    const report = await validateParsedSprite(projection.sidecar, dirname(path), palette);
    return {
      path,
      id,
      rawCategory,
      projectedCategory: projection.projectedCategory,
      status: report.issues.length === 0 ? "normalized-pass" : "normalized-fail",
      notes,
      issues: report.issues,
    };
  }
}

export async function auditSpriteSidecars(
  roots: readonly string[],
  palette: readonly Rgb[] = loadMasterPalette(),
): Promise<SpriteAuditSummary> {
  const resolvedRoots = roots.map((root) => resolve(root));
  const jsonFiles = resolvedRoots.flatMap(findJsonFiles);
  const sidecars: SpriteAudit[] = [];
  let skippedJsonFiles = 0;

  for (const path of jsonFiles) {
    const audit = await auditOne(path, palette);
    if (audit === undefined) {
      skippedJsonFiles += 1;
    } else {
      sidecars.push(audit);
    }
  }

  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<
    AuditStatus,
    number
  >;
  const rawCategories: Record<string, number> = {};
  const projectedCategories: Record<string, number> = {};
  for (const sidecar of sidecars) {
    counts[sidecar.status] += 1;
    inc(rawCategories, sidecar.rawCategory);
    if (sidecar.projectedCategory !== undefined) {
      inc(projectedCategories, sidecar.projectedCategory);
    }
  }

  return {
    roots: resolvedRoots,
    jsonFiles: jsonFiles.length,
    skippedJsonFiles,
    sidecars,
    counts,
    rawCategories,
    projectedCategories,
  };
}

function sortedEntries(map: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatCountLine(label: string, value: number): string {
  return `  ${label.padEnd(16)} ${value}`;
}

export function formatAuditSummary(summary: SpriteAuditSummary): string {
  const lines: string[] = [];
  const root = summary.roots[0] ?? process.cwd();
  lines.push(`[sprite-intake:report] scanned ${summary.sidecars.length} sidecar(s)`);
  lines.push(formatCountLine("runtime-pass", summary.counts["runtime-pass"]));
  lines.push(formatCountLine("runtime-fail", summary.counts["runtime-fail"]));
  lines.push(formatCountLine("normalized-pass", summary.counts["normalized-pass"]));
  lines.push(formatCountLine("normalized-fail", summary.counts["normalized-fail"]));
  lines.push(formatCountLine("blocked", summary.counts.blocked));
  if (summary.skippedJsonFiles > 0) {
    lines.push(formatCountLine("skipped-json", summary.skippedJsonFiles));
  }

  const passingProjectedCategories: Record<string, number> = {};
  for (const sidecar of summary.sidecars) {
    if (
      sidecar.projectedCategory !== undefined &&
      (sidecar.status === "runtime-pass" || sidecar.status === "normalized-pass")
    ) {
      inc(passingProjectedCategories, sidecar.projectedCategory);
    }
  }
  const closest = sortedEntries(passingProjectedCategories)[0];
  if (closest !== undefined) {
    lines.push("");
    lines.push(`Closest runtime category by passing projection: ${closest[0]} (${closest[1]})`);
  }

  const issueCounts: Record<string, number> = {};
  for (const sidecar of summary.sidecars) {
    for (const issue of sidecar.issues) {
      inc(issueCounts, `[${issue.rule}] ${issue.message}`);
    }
  }
  const blockers = sortedEntries(issueCounts).slice(0, 8);
  if (blockers.length > 0) {
    lines.push("");
    lines.push("Top blockers:");
    for (const [message, count] of blockers) {
      lines.push(`  ${count}x ${message}`);
    }
  }

  const examples = summary.sidecars
    .filter((sidecar) => sidecar.status !== "runtime-pass")
    .slice(0, 8);
  if (examples.length > 0) {
    lines.push("");
    lines.push("Examples:");
    for (const sidecar of examples) {
      const path = relative(root, sidecar.path) || sidecar.path;
      const firstIssue = sidecar.issues[0];
      const issue =
        firstIssue === undefined ? "no issue" : `[${firstIssue.rule}] ${firstIssue.message}`;
      lines.push(`  ${sidecar.status} ${path}: ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
