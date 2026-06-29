/**
 * Phase 3 exit criterion 1 — the follow test (GDD §17.5), v1 commute bar:
 * grow a city with separated homes and jobs, watch it (the camera IS the
 * sampler input), pick one live citizen and FOLLOW them: the same agent id
 * must move continuously (no teleports), keep a coherent identity, and
 * complete its journey. The full one-day home→work→shop→home bar gains its
 * remaining teeth (shop leg + panel consistency) with the inspector
 * tranche; the board tracks that.
 */
import { expect, type Page, test } from "@playwright/test";

type CommandIntent = { readonly type: number; readonly [key: string]: number };
type AgentSample = {
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
};
type AgentJourneySample = AgentSample & { readonly tick: number };
type CivitectDebug = {
  readonly displayState: () => { readonly tick: number };
  readonly dispatchIntent: (intent: CommandIntent) => void;
  readonly agents: () => readonly AgentSample[];
};
type AgentJourney =
  | { readonly error: string }
  | {
      readonly id: number;
      readonly kind: number;
      readonly samples: readonly AgentJourneySample[];
      readonly completed: boolean;
    };

declare global {
  interface Window {
    __civitect?: CivitectDebug;
  }
}

const readDisplayTick = (): number => window.__civitect?.displayState().tick ?? -1;

const bootstrapCommuteCity = (): void => {
  const c = window.__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 }); // the corridor
  c.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 }); // power
  c.dispatchIntent({ type: 10, x: 12, y: 21, building: 2 }); // water
  c.dispatchIntent({ type: 8, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 }); // homes west
  c.dispatchIntent({ type: 8, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 }); // jobs east
  c.dispatchIntent({ type: 2, speed: 9 }); // fast-forward
};

const agentCount = (): number => window.__civitect?.agents().length ?? 0;

async function followNewestAgent(): Promise<AgentJourney> {
  const c = window.__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  const pickNewest = (): AgentSample | null => {
    const live = c.agents();
    return live.length === 0 ? null : (live[live.length - 1] ?? null);
  };

  let target: AgentSample | null = null;
  for (let tries = 0; tries < 50 && target === null; tries++) {
    target = pickNewest();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (target === null) {
    return { error: "no agent to follow" };
  }

  const samples: AgentJourneySample[] = [
    { id: target.id, kind: target.kind, x: target.x, y: target.y, tick: c.displayState().tick },
  ];
  for (let sample = 0; sample < 600; sample++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const live = c.agents().find((agent) => agent.id === target.id);
    if (live === undefined) {
      return {
        id: target.id,
        kind: target.kind,
        samples,
        completed: true,
      };
    }
    samples.push({
      id: live.id,
      kind: live.kind,
      x: live.x,
      y: live.y,
      tick: c.displayState().tick,
    });
  }

  return {
    id: target.id,
    kind: target.kind,
    samples,
    completed: false,
  };
}

async function runFollow(page: Page): Promise<AgentJourney> {
  return page.evaluate(followNewestAgent);
}

test("a sampled citizen can be followed through a coherent commute", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(readDisplayTick), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(bootstrapCommuteCity);

  // The city grows, traffic assigns, the sampler (fed by the real camera
  // viewport) materializes citizens.
  await expect.poll(async () => page.evaluate(agentCount), { timeout: 180_000 }).toBeGreaterThan(0);

  // FOLLOW: track one id across samples. Identity is stable, motion is
  // continuous (bounded step — 9× speed, ~0.4 tiles/tick max for cars),
  // and the journey eventually completes (the id leaves the live set).
  const journey = await runFollow(page);
  if ("error" in journey) {
    throw new Error(journey.error);
  }

  const { id, kind, samples, completed } = journey;
  expect(completed).toBe(true);
  expect(samples.length).toBeGreaterThan(2);

  let traveled = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] as AgentJourneySample;
    expect(sample.id).toBe(id);
    expect(sample.kind).toBe(kind);
    if (i === 0) {
      continue;
    }

    const a = samples[i - 1] as AgentJourneySample;
    const b = sample;
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    traveled += step;
    expect(b.tick).toBeGreaterThanOrEqual(a.tick);
    // Continuous motion, not teleports: at 9× a sample gap spans ~18 ticks
    // locally and up to ~4 scheduler rounds (36 ticks ≈ 18 tiles) on a
    // loaded CI runner — a teleport across this corridor is 30+. [TUNE]
    expect(step).toBeLessThan(25);
    // The corridor city keeps every journey on the corridor.
    expect(b.y).toBeGreaterThan(16);
    expect(b.y).toBeLessThan(26);
    expect(b.x).toBeGreaterThanOrEqual(7);
    expect(b.x).toBeLessThanOrEqual(57);
  }
  expect(traveled).toBeGreaterThan(1); // it actually went somewhere
});
