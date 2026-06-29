/**
 * Phase 4 task 6 verification: coverage overlays work through the REAL worker
 * boundary for multiple city services. Place service buildings, select each
 * overlay, and prove the layer rides snapshots into renderer display state:
 * nonzero near the service, zero far off-network, and budget cuts shrink reach.
 */
import { expect, type Page, test } from "@playwright/test";

type CommandIntent = { readonly type: number; readonly [key: string]: number };
type CoverageState = {
  readonly service: number;
  readonly field: Uint8Array | readonly number[] | null;
};
type CivitectDebug = {
  readonly displayState: () => { readonly tick: number };
  readonly dispatchIntent: (intent: CommandIntent) => void;
  readonly selectOverlay: (service: number) => void;
  readonly coverage: () => CoverageState;
};

const MAP_WIDTH = 64;
const FAR_CORNER_TILE = 63 * MAP_WIDTH + 63;

const SERVICES = [
  {
    name: "fire",
    service: 1,
    building: 3,
    x: 10,
    nearTile: 21 * MAP_WIDTH + 11,
    edgeTile: 20 * MAP_WIDTH + 34,
  },
  {
    name: "police",
    service: 2,
    building: 5,
    x: 12,
    nearTile: 21 * MAP_WIDTH + 13,
    edgeTile: 20 * MAP_WIDTH + 38,
  },
  {
    name: "health",
    service: 3,
    building: 7,
    x: 14,
    nearTile: 21 * MAP_WIDTH + 15,
    edgeTile: 20 * MAP_WIDTH + 34,
  },
] as const;

const readDisplayTick = (): number =>
  (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect?.displayState().tick ??
  -1;

const bootstrapCoverageCity = (
  services: readonly { readonly x: number; readonly building: number }[],
): void => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 44, by: 20, roadClass: 1 }); // street
  for (const service of services) {
    c.dispatchIntent({ type: 10, x: service.x, y: 21, building: service.building });
  }
  c.dispatchIntent({ type: 2, speed: 9 });
};

const selectCoverage = (service: number): void => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.selectOverlay(service);
};

const coverageAt = (tileIdx: number): number => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  return c.coverage().field?.[tileIdx] ?? -1;
};

const activeCoverageAt = ({
  service,
  tileIdx,
}: {
  readonly service: number;
  readonly tileIdx: number;
}): number => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  const cov = c.coverage();
  return cov.service === service && cov.field !== null ? cov.field[tileIdx] : -1;
};

const cutBudget = (service: number): void => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.dispatchIntent({ type: 13, service, permille: 500 });
};

async function coverageValue(page: Page, tileIdx: number): Promise<number> {
  return page.evaluate(coverageAt, tileIdx);
}

test("fire, police, and health coverage overlays ride snapshots; budgets reshape reach", async ({
  page,
}) => {
  test.setTimeout(160_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(readDisplayTick), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(
    bootstrapCoverageCity,
    SERVICES.map(({ x, building }) => ({ x, building })),
  );

  for (const service of SERVICES) {
    await page.evaluate(selectCoverage, service.service);

    // The coverage layer arrives with the next snapshots: hot beside the
    // service, zero in the far map corner (network distance, not euclidean).
    await expect
      .poll(
        async () =>
          page.evaluate(activeCoverageAt, {
            service: service.service,
            tileIdx: service.nearTile,
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(128);

    await expect.poll(async () => coverageValue(page, FAR_CORNER_TILE)).toBe(0);
    await expect
      .poll(async () => coverageValue(page, service.edgeTile), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // Starve this service's budget to 50%: the edge sample falls out of reach,
    // proving the worker recomputed and shipped a smaller field for this service.
    // Read via activeCoverageAt (service-checked) and require the post-cut value
    // to be a VALID, strictly-smaller reading (>= 0). A field that vanished
    // entirely — or a wrong-service overlay — reports the -1 sentinel, which must
    // NOT satisfy `< edgeBefore`; otherwise the gate passes without proving the
    // reach SHRANK rather than disappeared (the original trivial-pass bug).
    const edgeBefore = await page.evaluate(activeCoverageAt, {
      service: service.service,
      tileIdx: service.edgeTile,
    });
    expect(edgeBefore).toBeGreaterThan(0);
    await page.evaluate(cutBudget, service.service);
    await expect
      .poll(
        async () => {
          const after = await page.evaluate(activeCoverageAt, {
            service: service.service,
            tileIdx: service.edgeTile,
          });
          return after >= 0 && after < edgeBefore;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  }
});
