/**
 * Node-side corpus plumbing for the golden gate: load scenarios + committed
 * hashes from `e2e/goldens/`, and — under `pnpm bless` only — rewrite the
 * hash file and emit the balance-diff report that IS the review artifact
 * (TDD §12.1: "the balance diff is the code review artifact").
 *
 * Everything filesystem-flavored lives here, NOT in runner.ts, so the runner
 * stays portable into browser pages (board PR 12).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoldenResult, HudBaseline } from "./runner";
import { type GoldenScenario, parseScenario } from "./scenario";

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "goldens");
const HASHES_PATH = join(GOLDENS_DIR, "hashes.json");
const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "reports",
  "balance-diff.md",
);

export interface GoldenExpectation {
  readonly hash: string;
  readonly hud: HudBaseline;
}

export type GoldenExpectations = Readonly<Record<string, GoldenExpectation>>;

const GOLDEN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/u;
const HASH_RE = /^[0-9a-f]{16}$/u;
const EXPECTATION_KEYS = new Set(["hash", "hud"]);
const HUD_KEYS = new Set(["tick", "population", "fundsCents"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${at}: unknown field "${key}"`);
    }
  }
}

function parseHud(raw: unknown, at: string): HudBaseline {
  if (!isRecord(raw)) {
    throw new Error(`${at}: hud must be an object`);
  }
  rejectUnknownFields(raw, HUD_KEYS, at);
  if (!isNonNegativeSafeInt(raw.tick)) {
    throw new Error(`${at}: tick must be a non-negative safe integer`);
  }
  if (!isNonNegativeSafeInt(raw.population)) {
    throw new Error(`${at}: population must be a non-negative safe integer`);
  }
  if (!isSafeInt(raw.fundsCents)) {
    throw new Error(`${at}: fundsCents must be a safe integer`);
  }
  return { tick: raw.tick, population: raw.population, fundsCents: raw.fundsCents };
}

export function parseExpectations(raw: unknown, source = HASHES_PATH): GoldenExpectations {
  if (!isRecord(raw)) {
    throw new Error(`${source}: golden expectations must be a JSON object`);
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new Error(`${source}: golden expectations must not be empty`);
  }
  const expectations: Record<string, GoldenExpectation> = {};
  for (const [name, value] of entries) {
    const at = `${source} "${name}"`;
    if (!GOLDEN_NAME_RE.test(name)) {
      throw new Error(`${source}: invalid golden name "${name}"`);
    }
    if (!isRecord(value)) {
      throw new Error(`${at}: expectation must be an object`);
    }
    rejectUnknownFields(value, EXPECTATION_KEYS, at);
    if (typeof value.hash !== "string" || !HASH_RE.test(value.hash)) {
      throw new Error(`${at}: hash must be 16 lowercase hex characters`);
    }
    expectations[name] = {
      hash: value.hash,
      hud: parseHud(value.hud, `${at}.hud`),
    };
  }
  return expectations;
}

export function loadScenarios(): GoldenScenario[] {
  const files = readdirSync(GOLDENS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "hashes.json")
    .sort();
  if (files.length === 0) {
    // An empty corpus passing silently would be the stub gate reborn.
    throw new Error(`no golden scenarios found in ${GOLDENS_DIR}`);
  }
  return files.map((f) => {
    const scenario = parseScenario(JSON.parse(readFileSync(join(GOLDENS_DIR, f), "utf8")), f);
    const expectedName = f.replace(/\.json$/, "");
    if (scenario.name !== expectedName) {
      throw new Error(`${f}: scenario name "${scenario.name}" must match its filename`);
    }
    return scenario;
  });
}

export function loadExpectations(): GoldenExpectations {
  return parseExpectations(JSON.parse(readFileSync(HASHES_PATH, "utf8")));
}

export function isBlessRun(): boolean {
  return process.env.BLESS === "1";
}

/**
 * Bless: pin the observed results and write the balance-diff report.
 * Old expectations (if any) become the "before" column — that report is what
 * Mem reads before approving a re-bless (AI-WORKFLOW §2 bless beat).
 */
export function bless(
  results: ReadonlyMap<string, GoldenResult>,
  previous: GoldenExpectations | null,
): void {
  const next: Record<string, GoldenExpectation> = {};
  for (const [name, result] of [...results.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    next[name] = { hash: result.hash, hud: result.hud };
  }
  writeFileSync(HASHES_PATH, `${JSON.stringify(next, null, 2)}\n`);

  const lines: string[] = [
    "# Golden balance diff (generated by `pnpm bless` — do not hand-edit)",
    "",
    "HUD-scalar movement per golden city, old → new. Phase 0 worlds only carry",
    "tick/population/fundsCents; richer scalars join this table as systems land",
    "(TDD §12.1, ADR-013).",
    "",
    "| golden | field | old | new |",
    "|---|---|---|---|",
  ];
  for (const [name, exp] of Object.entries(next)) {
    const before = previous?.[name];
    lines.push(`| ${name} | hash | ${before ? before.hash : "(new)"} | ${exp.hash} |`);
    for (const field of ["tick", "population", "fundsCents"] as const) {
      lines.push(
        `| ${name} | ${field} | ${before ? before.hud[field] : "(new)"} | ${exp.hud[field]} |`,
      );
    }
  }
  lines.push("");
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n"));
}
