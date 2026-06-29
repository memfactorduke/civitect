#!/usr/bin/env node
/**
 * ADR-013 layer 4 (render half): weekly device-profile render traces.
 *
 * This is intentionally not part of per-PR CI. It runs the real browser render
 * perf smoke with the CI skip disabled, captures the measured frame budget
 * line, and writes compact artifacts for the weekly workflow/device farm.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const HELP = `Usage: node scripts/ci/device-perf-traces.mjs [--dry-run]

Runs the real Chromium render-frame budget smoke and writes:
  - device-perf-traces.json
  - device-perf-traces.md

Environment:
  DEVICE_PERF_REPORT_DIR   Output directory (default: e2e/reports)
`;

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log(HELP.trim());
  process.exit(0);
}

const dryRun = args.has("--dry-run");
const reportDir = process.env.DEVICE_PERF_REPORT_DIR ?? "e2e/reports";
const profile = {
  id: "chromium-desktop",
  command: "pnpm",
  args: [
    "--filter",
    "@civitect/e2e",
    "exec",
    "playwright",
    "test",
    "smoke/render-perf.spec.ts",
    "--reporter=line",
  ],
};

function childEnv() {
  const env = { ...process.env, CIVITECT_DEVICE_PERF_PROFILE: profile.id };
  // The render-perf spec skips under CI because per-PR runners are not the
  // device floor. This weekly job is the device-floor lane, so run it live.
  delete env.CI;
  return env;
}

function commandLine() {
  return [profile.command, ...profile.args].join(" ");
}

function parseRenderPerf(output) {
  const match = output.match(
    /\[render-perf\].*?,\s+(\d+)\s+panned frames:\s+p95=([\d.]+)ms\s+max=([\d.]+)ms\s+over33ms=(\d+)/,
  );
  if (match === null) {
    throw new Error("render-perf run did not print a metrics line");
  }
  return {
    frames: Number(match[1]),
    p95Ms: Number(match[2]),
    maxMs: Number(match[3]),
    over33Ms: Number(match[4]),
  };
}

function runProfile() {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const child = spawn(profile.command, profile.args, {
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      const durationMs = Math.round(performance.now() - started);
      output += `${error.message}\n`;
      resolve({ code: 1, durationMs, output });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const durationMs = Math.round(performance.now() - started);
      resolve({ code: code ?? 1, durationMs, output });
    });
  });
}

function markdownReport(report) {
  const rows = report.profiles
    .map(
      (result) =>
        `| ${result.id} | ${result.status} | ${result.frames ?? "-"} | ${result.p95Ms?.toFixed(2) ?? "-"} | ${
          result.maxMs?.toFixed(2) ?? "-"
        } | ${result.over33Ms ?? "-"} | ${result.durationMs} |`,
    )
    .join("\n");
  return `# Device perf traces

Generated: ${report.generatedAt}

| Profile | Status | Frames | p95 ms | max ms | over 33 ms | duration ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${rows}
`;
}

async function main() {
  if (dryRun) {
    console.log(`[device-perf] dry run: ${commandLine()}`);
    console.log(`[device-perf] reports: ${reportDir}`);
    return;
  }

  console.log(`[device-perf] running ${profile.id}: ${commandLine()}`);
  const run = await runProfile();
  const result = {
    id: profile.id,
    command: commandLine(),
    exitCode: run.code,
    durationMs: run.durationMs,
    status: run.code === 0 ? "passed" : "failed",
  };
  if (run.code === 0) {
    Object.assign(result, parseRenderPerf(run.output));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    profiles: [result],
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "device-perf-traces.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(reportDir, "device-perf-traces.md"), markdownReport(report));

  if (run.code !== 0) {
    throw new Error(`device perf profile ${profile.id} failed with exit code ${run.code}`);
  }
}

main().catch((error) => {
  console.error(`[device-perf] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
