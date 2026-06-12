/**
 * Phase 3 exit criterion 1 — the follow test (GDD §17.5), v1 commute bar:
 * grow a city with separated homes and jobs, watch it (the camera IS the
 * sampler input), pick one live citizen and FOLLOW them: the same agent id
 * must move continuously (no teleports), keep a coherent identity, and
 * complete its journey. The full one-day home→work→shop→home bar gains its
 * remaining teeth (shop leg + panel consistency) with the inspector
 * tranche; the board tracks that.
 */
import { expect, test } from "@playwright/test";

test("a sampled citizen can be followed through a coherent commute", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => (window as any).__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(() => {
    const c = (window as any).__civitect;
    c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 }); // the corridor
    c.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 }); // power
    c.dispatchIntent({ type: 10, x: 12, y: 21, building: 2 }); // water
    c.dispatchIntent({ type: 8, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 }); // homes west
    c.dispatchIntent({ type: 8, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 }); // jobs east
    c.dispatchIntent({ type: 2, speed: 9 }); // fast-forward
  });

  // The city grows, traffic assigns, the sampler (fed by the real camera
  // viewport) materializes citizens.
  await expect
    .poll(async () => page.evaluate(() => (window as any).__civitect.agents().length), {
      timeout: 180_000,
    })
    .toBeGreaterThan(0);

  // FOLLOW: track one id across samples. Identity is stable, motion is
  // continuous (bounded step — 9× speed, ~0.4 tiles/tick max for cars),
  // and the journey eventually completes (the id leaves the live set).
  const journey = await page.evaluate(async () => {
    const c = (window as any).__civitect;
    type A = { id: number; kind: number; x: number; y: number };
    const pickNewest = (): A | null => {
      const live = c.agents() as A[];
      return live.length === 0 ? null : (live[live.length - 1] as A);
    };
    let target: A | null = null;
    for (let tries = 0; tries < 50 && target === null; tries++) {
      target = pickNewest();
      await new Promise((r) => setTimeout(r, 100));
    }
    if (target === null) {
      return { error: "no agent to follow" };
    }
    const positions: { x: number; y: number }[] = [{ x: target.x, y: target.y }];
    let completed = false;
    for (let sample = 0; sample < 600; sample++) {
      await new Promise((r) => setTimeout(r, 100));
      const live = (c.agents() as A[]).find((a) => a.id === target?.id);
      if (live === undefined) {
        completed = true; // journey ended; the slot recycled
        break;
      }
      positions.push({ x: live.x, y: live.y });
    }
    return { id: target.id, positions, completed };
  });

  expect((journey as { error?: string }).error).toBeUndefined();
  const { positions, completed } = journey as {
    positions: { x: number; y: number }[];
    completed: boolean;
  };
  expect(completed).toBe(true);
  expect(positions.length).toBeGreaterThan(2);
  let traveled = 0;
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1] as { x: number; y: number };
    const b = positions[i] as { x: number; y: number };
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    traveled += step;
    // Continuous motion, not teleports: at 9× a sample gap can span ~18
    // ticks (timer beats), ~9 tiles of street driving — a teleport across
    // this corridor would be 30+. [TUNE]
    expect(step).toBeLessThan(15);
    // The corridor city keeps every journey on the corridor.
    expect(b.y).toBeGreaterThan(16);
    expect(b.y).toBeLessThan(26);
    expect(b.x).toBeGreaterThanOrEqual(7);
    expect(b.x).toBeLessThanOrEqual(57);
  }
  expect(traveled).toBeGreaterThan(1); // it actually went somewhere
});
