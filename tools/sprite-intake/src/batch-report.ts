import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSpriteSidecar } from "@civitect/protocol";
import { loadMasterPalette, type Rgb } from "./palette";
import { type SpriteIssue, validateSprite } from "./validate";

export type BatchIssueRule = SpriteIssue["rule"] | "duplicate-id";

export interface SpriteBatchEntry {
  readonly path: string;
  readonly id: string;
  readonly category: string;
  readonly footprint: { readonly w: number; readonly d: number } | null;
  readonly states: readonly string[];
  readonly files: readonly string[];
  readonly issues: readonly SpriteIssue[];
}

export interface SpriteBatchReport {
  readonly entries: readonly SpriteBatchEntry[];
  readonly byCategory: Readonly<Record<string, number>>;
  readonly byState: Readonly<Record<string, number>>;
  readonly issueCounts: Readonly<Partial<Record<BatchIssueRule, number>>>;
  readonly failures: readonly string[];
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sortedRecord(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) {
    out[key] = counts[key] as number;
  }
  return out;
}

function issueFromError(error: unknown): SpriteIssue {
  return {
    rule: "sidecar",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Summarize a batch before handoff: which categories/states are present, which
 * referenced PNGs belong to each sidecar, and which gate failures block intake.
 */
export async function inspectSpriteBatch(
  sidecarPaths: readonly string[],
  palette?: readonly Rgb[],
): Promise<SpriteBatchReport> {
  const entries: SpriteBatchEntry[] = [];
  const byCategory: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const issueCounts: Partial<Record<BatchIssueRule, number>> = {};
  const failures: string[] = [];
  const seenKeys = new Map<string, string>();
  const activePalette = palette ?? loadMasterPalette();

  for (const sidecarPath of [...sidecarPaths].sort()) {
    let entry: SpriteBatchEntry;
    try {
      const sidecar = parseSpriteSidecar(
        JSON.parse(readFileSync(sidecarPath, "utf8")),
        sidecarPath,
      );
      const states = Object.keys(sidecar.states).sort();
      const files = states
        .map((state) => sidecar.states[state as keyof typeof sidecar.states])
        .filter((file): file is string => file !== undefined)
        .map((file) => join(dirname(sidecarPath), file))
        .sort();
      const report = await validateSprite(sidecarPath, activePalette);
      entry = {
        path: sidecarPath,
        id: sidecar.id,
        category: sidecar.category,
        footprint: sidecar.footprint,
        states,
        files,
        issues: report.issues,
      };
    } catch (error) {
      const issue = issueFromError(error);
      entry = {
        path: sidecarPath,
        id: sidecarPath,
        category: "unknown",
        footprint: null,
        states: [],
        files: [],
        issues: [issue],
      };
    }

    entries.push(entry);
    increment(byCategory, entry.category);
    for (const state of entry.states) {
      increment(byState, state);
    }
    for (const issue of entry.issues) {
      issueCounts[issue.rule] = (issueCounts[issue.rule] ?? 0) + 1;
      failures.push(`${entry.id}: [${issue.rule}] ${issue.message}`);
    }

    if (entry.category !== "unknown") {
      const key = `${entry.category}/${entry.id}`;
      const firstPath = seenKeys.get(key);
      if (firstPath === undefined) {
        seenKeys.set(key, entry.path);
      } else {
        issueCounts["duplicate-id"] = (issueCounts["duplicate-id"] ?? 0) + 1;
        failures.push(`${entry.id}: [duplicate-id] also declared by ${firstPath}`);
      }
    }
  }

  return {
    entries,
    byCategory: sortedRecord(byCategory),
    byState: sortedRecord(byState),
    issueCounts,
    failures,
  };
}
