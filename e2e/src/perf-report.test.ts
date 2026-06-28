import { describe, expect, it } from "vitest";
import {
  parsePerfReportFormat,
  renderPerfJson,
  renderPerfMarkdown,
  summarizeTimedResult,
} from "./perf-report.js";
import type { TimedResult } from "./runner.js";

function timedResult(samples: readonly number[]): TimedResult {
  return {
    hash: "abc123",
    hud: { tick: samples.length, population: 1234, fundsCents: 5678 },
    rejectionCount: 2,
    tickDurationsMs: Float64Array.from(samples),
  };
}

describe("perf report", () => {
  it("summarizes timed scenario samples with stable rounded metrics", () => {
    const row = summarizeTimedResult("slow-city", timedResult([1, 2, 4, 8, 16]));

    expect(row).toEqual({
      scenario: "slow-city",
      ticks: 5,
      p95Ms: 16,
      p99Ms: 16,
      maxMs: 16,
      totalMs: 31,
      hash: "abc123",
      population: 1234,
      fundsCents: 5678,
      rejectionCount: 2,
    });
  });

  it("renders markdown slowest-first with pass/fail status", () => {
    const markdown = renderPerfMarkdown(
      [
        summarizeTimedResult("fast-city", timedResult([1, 1, 1])),
        summarizeTimedResult("slow-city", timedResult([5, 21, 25])),
      ],
      20,
    );

    expect(markdown).toContain(
      "| scenario | ticks | p95 ms | p99 ms | max ms | total s | status |",
    );
    expect(markdown.indexOf("| slow-city |")).toBeLessThan(markdown.indexOf("| fast-city |"));
    expect(markdown).toContain("| slow-city | 3 | 25.0000 | 25.0000 | 25.0000 | 0.05 | FAIL |");
    expect(markdown).toContain("| fast-city | 3 | 1.0000 | 1.0000 | 1.0000 | 0.00 | PASS |");
  });

  it("renders machine-readable JSON with the same sorted rows", () => {
    const json = JSON.parse(
      renderPerfJson(
        [
          summarizeTimedResult("fast-city", timedResult([1, 1, 1])),
          summarizeTimedResult("slow-city", timedResult([5, 21, 25])),
        ],
        20,
      ),
    ) as {
      readonly budgetMs: number;
      readonly rows: readonly { readonly scenario: string; readonly status: string }[];
    };

    expect(json.budgetMs).toBe(20);
    expect(json.rows.map((row) => `${row.scenario}:${row.status}`)).toEqual([
      "slow-city:FAIL",
      "fast-city:PASS",
    ]);
  });

  it("parses CLI report format flags", () => {
    expect(parsePerfReportFormat([])).toBe("markdown");
    expect(parsePerfReportFormat(["--markdown"])).toBe("markdown");
    expect(parsePerfReportFormat(["--json"])).toBe("json");
    expect(parsePerfReportFormat(["--", "--json"])).toBe("json");
    expect(() => parsePerfReportFormat(["--csv"])).toThrow(/unsupported perf report flag/);
  });
});
