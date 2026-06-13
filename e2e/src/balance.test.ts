/**
 * Balance simulations (ADR-013 §3) — REAL gate, replacing the Phase 2 stub:
 * parameterized scenarios replay headlessly and CITY-SCALE OUTCOMES must
 * land inside assertion bands. Catches the "economy explodes / city
 * flatlines" bug classes that unit tests can't see.
 *
 * Phase 2 exit criterion 1 (automatable half): the balance city grows
 * 0 → ≥5000 population UNATTENDED within a game-year. Bands [TUNE].
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregates, createWorld, runTick } from "@civitect/sim";
import { describe, expect, it } from "vitest";
import { parseScenario, scenarioTerrain } from "./scenario";

const BALANCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "balance");

describe("balance bands (ADR-013 §3)", () => {
  it("balance-city-01 grows 0 → ≥5k unattended within bands (exit criterion 1)", async () => {
    const scenario = parseScenario(
      JSON.parse(readFileSync(join(BALANCE_DIR, "balance-city-01.json"), "utf8")),
      "balance-city-01.json",
    );
    // Manual replay loop, yielding to the event loop every chunk — a
    // single synchronous hour-long block starves the vitest worker RPC
    // heartbeat (observed as onTaskUpdate timeouts in the full ladder).
    const world = createWorld(
      scenario.seed,
      scenario.mapWidth,
      scenario.mapHeight,
      scenarioTerrain(scenario),
    );
    if (scenario.startingFundsCents !== undefined) {
      world.fundsCents = scenario.startingFundsCents;
    }
    const log = [...scenario.commands].sort((a, b) =>
      a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick,
    );
    let cursor = 0;
    while (world.tick < scenario.untilTick) {
      const batch = [];
      while (cursor < log.length && log[cursor]!.tick === world.tick) {
        batch.push(log[cursor]!);
        cursor++;
      }
      runTick(world, batch);
      if (world.tick % 25_000 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    const agg = aggregates(world.buildings);
    const unemploymentPermille =
      agg.adults === 0 ? 0 : Math.floor(((agg.adults - agg.employed) * 1000) / agg.adults);
    let abandoned = 0;
    let alive = 0;
    for (let i = 0; i < world.buildings.count; i++) {
      if (world.buildings.alive[i] === 1) {
        alive++;
        if ((world.buildings.status[i] as number) === 3) {
          abandoned++;
        }
      }
    }
    console.log(
      `[balance] balance-city-01 @1y: pop=${world.population} buildings=${alive} ` +
        `abandoned=${abandoned} unemployment=${unemploymentPermille}‰ ` +
        `housingCap=${agg.housingCapacity} jobs=${agg.jobsC + agg.jobsI + agg.jobsO}`,
    );
    // ── Bands [TUNE] ──────────────────────────────────────────────────────
    expect(world.population).toBeGreaterThanOrEqual(5000); // exit criterion 1
    expect(world.population).toBeLessThanOrEqual(60000); // runaway guard [TUNE: re-sized when workplace leveling unfroze job capacity]
    expect(unemploymentPermille).toBeLessThanOrEqual(600); // labor market sane
    expect(abandoned * 10).toBeLessThanOrEqual(alive); // ≤10% abandonment
    expect(agg.housingCapacity).toBeGreaterThanOrEqual(world.population); // no phantom housing
  });
});
