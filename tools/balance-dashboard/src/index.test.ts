import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { balanceReportCsv, parseBalanceInput, summarizeBalance } from "./index";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("balance-dashboard reports (TDD §13)", () => {
  it("summarizes sample series and flags out-of-band latest values", async () => {
    const file = join(ROOT, "tools", "balance-dashboard", "fixtures", "balance-samples.json");
    const input = parseBalanceInput(JSON.parse(await readFile(file, "utf8")));
    const report = summarizeBalance(input);

    const population = report.summaries.find(
      (summary) => summary.scenario === "starter-grid" && summary.metric === "population",
    );
    expect(population).toMatchObject({
      samples: 3,
      first: 0,
      last: 920,
      min: 0,
      max: 920,
      delta: 920,
      status: "pass",
    });
    expect(report.failures).toEqual([]);
  });

  it("flags latest values outside configured bands", () => {
    const report = summarizeBalance(
      parseBalanceInput({
        samples: [
          { scenario: "overspend", tick: 0, metrics: { monthlyNetCents: -150_000 } },
          { scenario: "overspend", tick: 2880, metrics: { monthlyNetCents: -4_500_000 } },
        ],
        bands: [{ scenario: "overspend", metric: "monthlyNetCents", min: -1_000_000 }],
      }),
    );

    expect(report.failures[0]).toMatchObject({
      last: -4_500_000,
      status: "fail",
    });
  });

  it("emits deterministic CSV columns for branch comparison artifacts", () => {
    const report = summarizeBalance(
      parseBalanceInput({
        samples: [
          { scenario: "a,quoted", tick: 0, metrics: { population: 1 } },
          { scenario: "a,quoted", tick: 10, metrics: { population: 3 } },
        ],
        bands: [{ scenario: "a,quoted", metric: "population", min: 2, max: 5 }],
      }),
    );

    expect(balanceReportCsv(report)).toBe(
      [
        "scenario,metric,samples,firstTick,lastTick,first,last,min,max,delta,bandMin,bandMax,status",
        '"a,quoted",population,2,0,10,1,3,1,3,2,2,5,pass',
      ].join("\n"),
    );
  });

  it("rejects malformed samples before summaries are trusted", () => {
    expect(() =>
      parseBalanceInput({
        samples: [{ scenario: "broken", tick: 0, metrics: { population: Number.NaN } }],
      }),
    ).toThrow(/finite number/);
  });
});
