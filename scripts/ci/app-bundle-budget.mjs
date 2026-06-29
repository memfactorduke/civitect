#!/usr/bin/env node
/**
 * TDD section 2: performance is a feature. This gate keeps the shipped app bundle
 * visible as features accumulate, so browser startup does not drift quietly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

const ASSET_DIR = new URL("../../packages/app/dist/assets/", import.meta.url);
const DEFAULT_BUDGETS = {
  entryRawBytes: 560_000,
  entryGzipBytes: 180_000,
  workerRawBytes: 180_000,
  workerGzipBytes: 60_000,
  totalJsRawBytes: 950_000,
  totalJsGzipBytes: 320_000,
};

function budget(name) {
  const envName = `CIVITECT_${name.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`;
  const value = process.env[envName];
  if (value === undefined) {
    return DEFAULT_BUDGETS[name];
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer byte count`);
  }
  return parsed;
}

const BUDGETS = Object.fromEntries(
  Object.keys(DEFAULT_BUDGETS).map((name) => [name, budget(name)]),
);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function readChunks() {
  try {
    statSync(ASSET_DIR);
  } catch {
    throw new Error("packages/app/dist/assets is missing; run pnpm --filter @civitect/app build");
  }
  return readdirSync(ASSET_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const path = new URL(name, ASSET_DIR);
      const bytes = readFileSync(path);
      return {
        name,
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
      };
    });
}

function findSingle(chunks, prefix) {
  const matches = chunks.filter((chunk) => chunk.name.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${prefix}*.js chunk, found ${matches.length}`);
  }
  return matches[0];
}

function buildReport(chunks) {
  const entry = findSingle(chunks, "index-");
  const worker = findSingle(chunks, "worker-");
  const total = chunks.reduce(
    (sum, chunk) => ({
      rawBytes: sum.rawBytes + chunk.rawBytes,
      gzipBytes: sum.gzipBytes + chunk.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );
  return { chunks, entry, worker, total };
}

function failuresFor(report) {
  const checks = [
    ["entry raw", report.entry.rawBytes, BUDGETS.entryRawBytes],
    ["entry gzip", report.entry.gzipBytes, BUDGETS.entryGzipBytes],
    ["worker raw", report.worker.rawBytes, BUDGETS.workerRawBytes],
    ["worker gzip", report.worker.gzipBytes, BUDGETS.workerGzipBytes],
    ["total JS raw", report.total.rawBytes, BUDGETS.totalJsRawBytes],
    ["total JS gzip", report.total.gzipBytes, BUDGETS.totalJsGzipBytes],
  ];
  return checks
    .filter(([, actual, limit]) => actual > limit)
    .map(
      ([label, actual, limit]) =>
        `${label} ${formatBytes(actual)} exceeds budget ${formatBytes(limit)}`,
    );
}

function renderMarkdown(report) {
  const lines = [
    "# App Bundle Budget",
    "",
    "| target | actual raw | raw budget | actual gzip | gzip budget |",
    "|---|---:|---:|---:|---:|",
    `| entry (${report.entry.name}) | ${formatBytes(report.entry.rawBytes)} | ${formatBytes(
      BUDGETS.entryRawBytes,
    )} | ${formatBytes(report.entry.gzipBytes)} | ${formatBytes(BUDGETS.entryGzipBytes)} |`,
    `| worker (${report.worker.name}) | ${formatBytes(report.worker.rawBytes)} | ${formatBytes(
      BUDGETS.workerRawBytes,
    )} | ${formatBytes(report.worker.gzipBytes)} | ${formatBytes(BUDGETS.workerGzipBytes)} |`,
    `| total JS (${report.chunks.length} chunks) | ${formatBytes(
      report.total.rawBytes,
    )} | ${formatBytes(BUDGETS.totalJsRawBytes)} | ${formatBytes(
      report.total.gzipBytes,
    )} | ${formatBytes(BUDGETS.totalJsGzipBytes)} |`,
    "",
  ];
  const failures = failuresFor(report);
  if (failures.length === 0) {
    lines.push("Status: PASS");
  } else {
    lines.push("Status: FAIL", "", ...failures.map((failure) => `- ${failure}`));
  }
  lines.push("");
  return lines.join("\n");
}

const report = buildReport(readChunks());
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ budgets: BUDGETS, ...report }, null, 2));
} else {
  console.log(renderMarkdown(report));
}

const failures = failuresFor(report);
if (failures.length > 0) {
  process.exitCode = 1;
}
