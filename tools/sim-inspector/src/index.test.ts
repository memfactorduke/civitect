import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectArtifact } from "./index";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("sim-inspector artifacts (TDD §13)", () => {
  it("summarizes a .civmap catalog artifact", async () => {
    const file = join(ROOT, "tools", "map-generator", "maps", "terraced-island.civmap");
    const summary = await inspectArtifact(new Uint8Array(await readFile(file)), file);

    expect(summary.kind).toBe("map");
    if (summary.kind !== "map") {
      throw new Error("expected map summary");
    }
    expect(summary.mapId).toBe(1);
    expect(summary.generatorSeed).toBe(101);
    expect(summary.terrain.width).toBe(256);
    expect(summary.terrain.waterTiles).toBeGreaterThan(0);
    expect(summary.terrain.resourceCounts.ore).toBeGreaterThan(0);
  });

  it("summarizes a migrated .civ save fixture without executing sim code", async () => {
    const file = join(
      ROOT,
      "packages",
      "protocol",
      "fixtures",
      "saves",
      "v10",
      "empty-world-y1.civ",
    );
    const summary = await inspectArtifact(new Uint8Array(await readFile(file)), file);

    expect(summary.kind).toBe("save");
    if (summary.kind !== "save") {
      throw new Error("expected save summary");
    }
    expect(summary.header.formatVersion).toBe(10);
    expect(summary.world.population).toBe(0);
    expect(summary.terrain.tileCount).toBe(64 * 64);
    expect(summary.roads.count).toBe(1);
    expect(summary.buildings.count).toBe(1);
    expect(summary.cohorts.rows).toBe(1);
    expect(summary.traffic.activeJob).toBe(true);
    expect(summary.services.budgetsPermille).toHaveLength(9);
    expect(summary.economy.taxRatesPermille).toHaveLength(6);
    expect(summary.districts.named).toEqual(["Old Town", "Downtown"]);
  });

  it("rejects bytes that are neither a map nor a save", async () => {
    await expect(inspectArtifact(new Uint8Array([1, 2, 3]), "bad.bin")).rejects.toThrow(
      /could not decode artifact/,
    );
  });
});
