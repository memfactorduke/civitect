/**
 * THE asset gate (ADR-013, unstubbed by board task 11): every sidecar under
 * packages/assets/sprites must pass the ADR-012 validators. Sprites only
 * enter the game through this gate (CLAUDE.md hard rule).
 *
 * An empty asset tree passes — that's a real scan of a really-empty set,
 * not a stub (the first Codex batch makes it non-vacuous; exit criterion 3
 * needs 12 sprites through here). The seeded-fixture rejection proof lives
 * in validate.test.ts under the unit gate.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMasterPalette } from "./palette";
import { validateSprite } from "./validate";

const ASSET_SPRITES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "packages",
  "assets",
  "sprites",
);

function findSidecars(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSidecars(path));
    } else if (entry.name.endsWith(".json")) {
      out.push(path);
    }
  }
  return out.sort();
}

describe("asset gate (ADR-012/013)", () => {
  it("every sprite in packages/assets/sprites passes the intake gates", async () => {
    const sidecars = findSidecars(ASSET_SPRITES_DIR);
    console.log(`[gate:assets] scanning ${sidecars.length} sprite sidecar(s)`);
    if (sidecars.length === 0) {
      return; // really-empty set, really scanned
    }
    const palette = loadMasterPalette();
    const failures: string[] = [];
    const seenIds = new Set<string>();
    for (const sidecar of sidecars) {
      const report = await validateSprite(sidecar, palette);
      if (seenIds.has(report.id)) {
        failures.push(`${report.id}: duplicate sprite id`);
      }
      seenIds.add(report.id);
      for (const issue of report.issues) {
        failures.push(`${report.id}: [${issue.rule}] ${issue.message}`);
      }
    }
    expect(failures, `\n${failures.join("\n")}`).toEqual([]);
  });
});
