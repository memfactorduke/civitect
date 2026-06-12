/**
 * Archived fixture-save corpus (ADR-010 [binding]): every formatVersion
 * that ever shipped keeps a committed .civ here, and CI proves they load
 * forever. When formatVersion bumps, the OLD fixtures stay and route
 * through migrations — deleting one is deleting the promise.
 *
 * Seeding (SEED_FIXTURES=1) writes the current version's fixture once;
 * after that the committed bytes are the contract. Mirrors the golden
 * bless convention (e2e): agents seed new fixtures, never rewrite old ones.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CommandType } from "../commands";
import { type CivSave, decodeCiv, encodeCiv, SAVE_FORMAT_VERSION } from "./civ";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "saves");
const V1_PATH = join(FIXTURES_DIR, "v1", "empty-world-y1.civ");

/**
 * Canonical v1 fixture content: an empty 64×64 world one game-year in,
 * with a short command tail. Values are fixed by hand here — the fixture
 * is a format contract, not a sim artifact (sim-produced saves are PR 9's
 * e2e territory).
 */
const V1_SAVE: CivSave = {
  header: {
    formatVersion: 1,
    simVersion: 1,
    seed: 1234,
    tick: 525_600,
    mapId: 0,
    flags: 0,
  },
  worldCore: {
    speed: 1,
    selectedTileIdx: 195, // tile (3, 3) on a 64-wide map
    mapWidth: 64,
    mapHeight: 64,
    fundsCents: 0,
    population: 0,
    rngStreams: [
      { name: "traffic", stateHi: 0x1111, stateLo: 0x2222, incHi: 0x3333, incLo: 0x4445 },
      { name: "growth", stateHi: 0x5555, stateLo: 0x6666, incHi: 0x7777, incLo: 0x8889 },
      { name: "agents", stateHi: 0x9999, stateLo: 0xaaaa, incHi: 0xbbbb, incLo: 0xcccd },
      { name: "services", stateHi: 0xdddd, stateLo: 0xeeee, incHi: 0xffff, incLo: 0x0001 },
      { name: "events", stateHi: 0x1234, stateLo: 0x5678, incHi: 0x9abc, incLo: 0xdef1 },
    ],
  },
  commandTail: [
    { seq: 0, tick: 525_590, type: CommandType.selectTile, x: 3, y: 3 },
    { seq: 1, tick: 525_595, type: CommandType.setSpeed, speed: 1 },
  ],
};

describe("fixture-save archive (ADR-010: old saves load forever)", () => {
  if (process.env.SEED_FIXTURES === "1" && !existsSync(V1_PATH)) {
    it("seeds the v1 fixture (first time only — committed bytes become the contract)", async () => {
      mkdirSync(dirname(V1_PATH), { recursive: true });
      writeFileSync(V1_PATH, await encodeCiv(V1_SAVE));
      expect(existsSync(V1_PATH)).toBe(true);
    });
  }

  it(`v${SAVE_FORMAT_VERSION} fixture decodes to its archived world, bit-faithfully`, async () => {
    if (!existsSync(V1_PATH)) {
      throw new Error(
        `fixture missing: ${V1_PATH} — run SEED_FIXTURES=1 pnpm test and commit the file`,
      );
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V1_PATH)));
    expect(decoded).toEqual(V1_SAVE);
  });
});
