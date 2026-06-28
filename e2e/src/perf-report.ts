import { loadScenarios } from "./goldens.js";
import { percentile, runScenarioTimed, type TimedResult } from "./runner.js";

export const PERF_P95_HARD_GATE_MS = 20;

export type PerfReportFormat = "markdown" | "json";

export interface PerfReportRow {
  readonly scenario: string;
  readonly ticks: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
  readonly hash: string;
  readonly population: number;
  readonly fundsCents: number;
  readonly rejectionCount: number;
}

interface RenderedRow extends PerfReportRow {
  readonly status: "PASS" | "FAIL";
}

function assertTimedSamples(samples: Float64Array): void {
  if (samples.length === 0) {
    throw new Error("cannot summarize a timed scenario with zero ticks");
  }
}

export function summarizeTimedResult(scenario: string, result: TimedResult): PerfReportRow {
  const samples = result.tickDurationsMs;
  assertTimedSamples(samples);

  let maxMs = 0;
  let totalMs = 0;
  for (const durationMs of samples) {
    if (durationMs > maxMs) {
      maxMs = durationMs;
    }
    totalMs += durationMs;
  }

  return {
    scenario,
    ticks: samples.length,
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    maxMs,
    totalMs,
    hash: result.hash,
    population: result.hud.population,
    fundsCents: result.hud.fundsCents,
    rejectionCount: result.rejectionCount,
  };
}

function rowsForRender(rows: readonly PerfReportRow[], budgetMs: number): RenderedRow[] {
  return rows
    .map((row) => ({
      ...row,
      status: row.p95Ms <= budgetMs ? ("PASS" as const) : ("FAIL" as const),
    }))
    .sort((a, b) => {
      if (b.p95Ms !== a.p95Ms) {
        return b.p95Ms - a.p95Ms;
      }
      return a.scenario.localeCompare(b.scenario);
    });
}

function fixedMs(value: number): string {
  return value.toFixed(4);
}

export function renderPerfMarkdown(
  rows: readonly PerfReportRow[],
  budgetMs = PERF_P95_HARD_GATE_MS,
): string {
  const renderedRows = rowsForRender(rows, budgetMs);
  const lines = [
    "# Golden perf report",
    "",
    `p95 budget: ${budgetMs.toFixed(4)} ms`,
    "",
    "| scenario | ticks | p95 ms | p99 ms | max ms | total s | status | hash | pop | rejections |",
    "|---|---:|---:|---:|---:|---:|---|---|---:|---:|",
  ];
  for (const row of renderedRows) {
    lines.push(
      `| ${row.scenario} | ${row.ticks} | ${fixedMs(row.p95Ms)} | ${fixedMs(row.p99Ms)} | ` +
        `${fixedMs(row.maxMs)} | ${(row.totalMs / 1000).toFixed(2)} | ${row.status} | ` +
        `${row.hash} | ${row.population} | ${row.rejectionCount} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderPerfJson(
  rows: readonly PerfReportRow[],
  budgetMs = PERF_P95_HARD_GATE_MS,
): string {
  return `${JSON.stringify({ budgetMs, rows: rowsForRender(rows, budgetMs) }, null, 2)}\n`;
}

export async function collectPerfRows(
  now: () => number = () => performance.now(),
): Promise<PerfReportRow[]> {
  const rows: PerfReportRow[] = [];
  for (const scenario of loadScenarios()) {
    rows.push(summarizeTimedResult(scenario.name, await runScenarioTimed(scenario, now)));
  }
  return rows;
}

export function parsePerfReportFormat(args: readonly string[]): PerfReportFormat {
  let format: PerfReportFormat = "markdown";
  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      format = "json";
    } else if (arg === "--markdown") {
      format = "markdown";
    } else {
      throw new Error(`unsupported perf report flag: ${arg}`);
    }
  }
  return format;
}

function isDirectRun(): boolean {
  return process.argv.some((arg) => /perf-report\.(ts|js)$/.test(arg));
}

function directRunArgs(argv: readonly string[]): readonly string[] {
  const scriptIndex = argv.findIndex((arg) => /perf-report\.(ts|js)$/.test(arg));
  return scriptIndex === -1 ? [] : argv.slice(scriptIndex + 1);
}

if (isDirectRun()) {
  try {
    const format = parsePerfReportFormat(directRunArgs(process.argv));
    const rows = await collectPerfRows();
    process.stdout.write(format === "json" ? renderPerfJson(rows) : renderPerfMarkdown(rows));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
