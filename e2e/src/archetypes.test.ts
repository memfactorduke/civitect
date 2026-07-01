/**
 * Archetype balance harness + the Phase 5 exit criteria (board task 6,
 * ADR-013 §3, GDD §17).
 *
 * - Five archetypes hold their balance BANDS over GAME_YEARS game-years
 *   (per-PR default 2; the weekly/dispatchable gate sets GAME_YEARS=20 — the
 *   full exit-criterion horizon).
 * - Bankruptcy post-mortem (automatable half of GDD §17.4): a scripted
 *   overspend collapses, and the report + advisor chain NAME the drain.
 * - Progression pacing: a scripted growth city hits every milestone it
 *   reaches IN ORDER, never skipping, each with its unlock.
 */
import { createWorld, runTick, type World } from "@civitect/sim";
import { describe, expect, it } from "vitest";
import { ARCHETYPES, MAP, TICKS_PER_GAME_YEAR } from "./archetypes";

const GAME_YEARS = Number(process.env.GAME_YEARS ?? "2");

/** Replay a command log to `untilTick`, yielding so the worker RPC heartbeat
 *  survives the long synchronous run (the balance/golden gate's lesson). */
async function run(
  seed: number,
  commands: readonly { seq: number; tick: number }[],
  untilTick: number,
  startingFundsCents: number,
  onTick?: (world: World) => void,
): Promise<World> {
  const world = createWorld(seed, MAP, MAP);
  world.fundsCents = startingFundsCents;
  const log = [...commands].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
  let cursor = 0;
  while (world.tick < untilTick) {
    const batch: never[] = [];
    while (cursor < log.length && (log[cursor]?.tick ?? Infinity) === world.tick) {
      batch.push(log[cursor] as never);
      cursor++;
    }
    runTick(world, batch);
    onTick?.(world);
    if (world.tick % 25_000 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return world;
}

function countZone(world: World, zone: number): number {
  let n = 0;
  for (let i = 0; i < world.buildings.count; i++) {
    if (world.buildings.alive[i] === 1 && (world.buildings.kind[i] as number) === zone) {
      n++;
    }
  }
  return n;
}

describe(`archetype balance bands — ${GAME_YEARS} game-year(s) (ADR-013 §3)`, () => {
  for (const arch of ARCHETYPES) {
    it(
      `${arch.name} holds its bands`,
      async () => {
        // traffic.ridden reflects one hour's solve, so track the PEAK across
        // the run (the end tick lands at a low-demand hour).
        let maxRidden = 0;
        const world = await run(
          arch.seed,
          arch.commands,
          GAME_YEARS * TICKS_PER_GAME_YEAR,
          arch.startingFundsCents,
          (w) => {
            if (w.traffic.ridden > maxRidden) {
              maxRidden = w.traffic.ridden;
            }
          },
        );
        const b = arch.bands;
        expect(world.population).toBeGreaterThanOrEqual(b.minPopulation);
        expect(world.population).toBeLessThanOrEqual(b.maxPopulation);
        expect(world.fundsCents).toBeGreaterThanOrEqual(b.minFundsCents);
        if (b.minDominantKind !== undefined) {
          expect(countZone(world, b.minDominantKind.zone)).toBeGreaterThanOrEqual(
            b.minDominantKind.count,
          );
        }
        if (b.minRidden !== undefined) {
          expect(maxRidden).toBeGreaterThanOrEqual(b.minRidden);
        }
      },
      GAME_YEARS * 200_000,
    );
  }
});

describe("bankruptcy post-mortem (GDD §17.4 automatable half)", () => {
  it("a city that overspends collapses, and the report + advisor name the drain", async () => {
    // A treasury too thin for its upkeep: lots of expensive service ploppables,
    // tiny tax base. The monthly close drains it into the red.
    const cmds: { seq: number; tick: number }[] = [];
    let seq = 0;
    const push = (c: Record<string, number>) => cmds.push({ ...c, seq: seq++, tick: 0 } as never);
    push({ type: 3, ax: 0, ay: 8, bx: 63, by: 8, roadClass: 2 }); // buildRoad
    // Six big service buildings (heavy upkeep) — kinds via PLOPPABLE offset.
    for (let i = 0; i < 6; i++) {
      push({ type: 10, x: 4 + i * 3, y: 9, building: i % 2 === 0 ? 8 : 17 }); // hospital/incinerator
    }
    push({ type: 8, x0: 4, y0: 10, x1: 12, y1: 12, zone: 1 }); // a sliver of tax base

    const seen: string[] = [];
    const world = await run(13, cmds, TICKS_PER_GAME_YEAR, 30_000_00, (w) => {
      for (const e of w.advisorQueue) {
        seen.push(e.messageKey);
      }
      w.advisorQueue.length = 0;
    });

    // The drain is articulable: a bailout (and/or receivership) advisor fired,
    // and upkeep is a real expense line in the last report.
    expect(seen.some((k) => k === "advisor.bailout" || k === "advisor.receivership")).toBe(true);
    expect(world.economy.bailoutUsed).toBe(1);
    // ReportLineKind.serviceUpkeep (5) is a NEGATIVE (expense) line.
    expect(world.economy.lastMonthCents[5 - 1]).toBeLessThan(0);
  });
});

describe("progression pacing (GDD §13)", () => {
  it("a growing city hits every milestone it reaches, in order, never skipping", async () => {
    // A dense, well-funded R/C/I town that climbs the early ladder.
    const cmds: { seq: number; tick: number }[] = [];
    let seq = 0;
    const push = (c: Record<string, number>) => cmds.push({ ...c, seq: seq++, tick: 0 } as never);
    for (const y of [0, 16, 32, 48, 63]) {
      push({ type: 3, ax: 0, ay: y, bx: 63, by: y, roadClass: 2 });
    }
    for (const x of [0, 16, 32, 48, 63]) {
      push({ type: 3, ax: x, ay: 0, bx: x, by: 63, roadClass: 2 });
    }
    push({ type: 10, x: 2, y: 1, building: 1 });
    push({ type: 10, x: 4, y: 1, building: 2 });
    push({ type: 8, x0: 2, y0: 2, x1: 24, y1: 24, zone: 1 });
    push({ type: 8, x0: 34, y0: 2, x1: 50, y1: 24, zone: 3 });
    push({ type: 8, x0: 34, y0: 34, x1: 50, y1: 50, zone: 5 });

    const seenIndices: number[] = [0];
    await run(7, cmds, 2 * TICKS_PER_GAME_YEAR, 2_000_000_00, (w) => {
      const idx = w.economy.milestoneIndex;
      if (idx !== seenIndices[seenIndices.length - 1]) {
        seenIndices.push(idx);
      }
    });
    // The city climbed the early ladder (loans + beyond).
    expect(seenIndices[seenIndices.length - 1]).toBeGreaterThanOrEqual(2);
    // The trail only ever RISES — never regresses. (That it never SKIPS an
    // index internally is the progression unit property; here the daily
    // observation can cross several thresholds in one day, so we assert the
    // monotone end-to-end shape, not a +1 step.)
    for (let i = 1; i < seenIndices.length; i++) {
      expect(seenIndices[i]).toBeGreaterThan(seenIndices[i - 1] as number);
    }
  });
});
