/**
 * Phase 0 exit criterion 1 (ROADMAP): the empty-city one-game-year golden
 * is hash-stable across Node, Chromium, and WebKit.
 *
 * Anchor logic: `goldens/hashes.json` is produced and verified in NODE by
 * the per-PR golden gate. Each browser project here replays the same
 * scenario through the same runner module and must land on that committed
 * hash — browser === committed === Node, transitively, with no hash ever
 * recomputed twice in the same engine.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

interface Expectation {
  readonly hash: string;
  readonly hud: { readonly tick: number; readonly population: number; readonly fundsCents: number };
}

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "goldens");
const expectations = JSON.parse(readFileSync(join(GOLDENS_DIR, "hashes.json"), "utf8")) as Record<
  string,
  Expectation
>;
const scenarioFiles = readdirSync(GOLDENS_DIR)
  .filter((f) => f.endsWith(".json") && f !== "hashes.json")
  .sort();

const KNOWN_REJECTION_COUNTS: Record<string, number> = {
  // Existing golden contains one legacy rejected command. Keep it explicit so
  // additional silent command drops fail this browser cross-check.
  "bridges-city-01": 1,
};

if (scenarioFiles.length === 0) {
  throw new Error("empty golden corpus — the cross-check would vacuously pass");
}

for (const file of scenarioFiles) {
  const doc = JSON.parse(readFileSync(join(GOLDENS_DIR, file), "utf8")) as { name: string };

  test(`golden ${doc.name}: this engine reproduces the committed Node hash`, async ({
    page,
    browserName,
  }) => {
    const expected = expectations[doc.name];
    expect(expected, `golden "${doc.name}" has no committed hash`).toBeDefined();

    await page.goto("/");
    await page.waitForFunction(() => window.__runGolden !== undefined);
    const result = await page.evaluate(
      (d) => (window as Window & { __runGolden?: (doc: unknown) => unknown }).__runGolden?.(d),
      doc,
    );

    const r = result as { hash: string; hud: Expectation["hud"]; rejectionCount: number };
    console.log(`[cross-check] ${doc.name} on ${browserName}: ${r.hash}`);
    expect(r.rejectionCount, `golden "${doc.name}" rejected commands on ${browserName}`).toBe(
      KNOWN_REJECTION_COUNTS[doc.name] ?? 0,
    );
    expect(r.hud).toEqual((expected as Expectation).hud);
    expect(r.hash).toBe((expected as Expectation).hash);
  });
}
