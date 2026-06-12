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
import { flatTerrain } from "./terrain";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "saves");
const V1_PATH = join(FIXTURES_DIR, "v1", "empty-world-y1.civ");
const V2_PATH = join(FIXTURES_DIR, "v2", "empty-world-y1.civ");
const V3_PATH = join(FIXTURES_DIR, "v3", "empty-world-y1.civ");
const V4_PATH = join(FIXTURES_DIR, "v4", "empty-world-y1.civ");
const V5_PATH = join(FIXTURES_DIR, "v5", "empty-world-y1.civ");
const V6_PATH = join(FIXTURES_DIR, "v6", "empty-world-y1.civ");

/**
 * Canonical v1 fixture content: an empty 64×64 world one game-year in,
 * with a short command tail. Values are fixed by hand here — the fixture
 * is a format contract, not a sim artifact (sim-produced saves are PR 9's
 * e2e territory).
 */
const V1_SAVE: Omit<CivSave, "terrain" | "roads" | "buildings" | "cohorts" | "traffic" | "pins"> = {
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
  // The v1 fixture can never be re-seeded: this build only WRITES v2.
  // Its committed bytes are the archived contract — that's the point.

  it("v1 fixture loads forever — migrated to flat terrain, provenance preserved", async () => {
    if (!existsSync(V1_PATH)) {
      throw new Error(
        `fixture missing: ${V1_PATH} — run SEED_FIXTURES=1 pnpm test and commit the file`,
      );
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V1_PATH)));
    // Migration injects flat terrain at the world's dims; header keeps the
    // original formatVersion so tooling can see provenance (ADR-010).
    expect(decoded).toEqual({
      ...V1_SAVE,
      terrain: flatTerrain(64, 64),
      roads: [],
      buildings: [],
      cohorts: new Uint16Array(0),
      traffic: emptyTraffic(0),
      pins: [],
    });
    expect(decoded.header.formatVersion).toBe(1);
  });

  const V2_SAVE: Omit<CivSave, "roads" | "buildings" | "cohorts" | "traffic" | "pins"> = {
    ...V1_SAVE,
    header: { ...V1_SAVE.header, formatVersion: 2 },
    terrain: flatTerrain(64, 64),
  };

  it("v2 fixture loads forever — migrated to empty roads, provenance preserved", async () => {
    if (!existsSync(V2_PATH)) {
      throw new Error(`fixture missing: ${V2_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V2_PATH)));
    expect(decoded).toEqual({
      ...V2_SAVE,
      roads: [],
      buildings: [],
      cohorts: new Uint16Array(0),
      traffic: emptyTraffic(0),
      pins: [],
    });
    expect(decoded.header.formatVersion).toBe(2);
  });

  const V3_SAVE: Omit<CivSave, "buildings" | "cohorts" | "traffic" | "pins"> = {
    ...V2_SAVE,
    header: { ...V2_SAVE.header, formatVersion: 3 },
    roads: [{ ax: 3, ay: 3, bx: 7, by: 3, roadClass: 1 }],
  };

  it("v3 fixture loads forever — migrated to empty buildings, provenance preserved", async () => {
    if (!existsSync(V3_PATH)) {
      throw new Error(`fixture missing: ${V3_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V3_PATH)));
    expect(decoded).toEqual({
      ...V3_SAVE,
      buildings: [],
      cohorts: new Uint16Array(0),
      traffic: emptyTraffic(1),
      pins: [],
    });
    expect(decoded.header.formatVersion).toBe(3);
  });

  const V4_SAVE: Omit<CivSave, "traffic" | "pins"> = {
    ...V3_SAVE,
    header: { ...V3_SAVE.header, formatVersion: 4 },
    buildings: [{ tileIdx: 200, kind: 1, level: 2, status: 0, failDays: 0, thriveDays: 1 }],
    cohorts: Uint16Array.from({ length: 20 }, (_, k) => (k === 8 ? 2 : 0)),
  };

  it("v4 fixture loads forever — migrated to zeroed traffic, provenance preserved", async () => {
    if (!existsSync(V4_PATH)) {
      throw new Error(`fixture missing: ${V4_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V4_PATH)));
    // One road edge -> migration injects one zeroed volume (a fresh
    // incremental solve at the next boundary, exactly v4-era behavior).
    expect(decoded).toEqual({ ...V4_SAVE, traffic: emptyTraffic(1), pins: [] });
    expect(decoded.header.formatVersion).toBe(4);
  });

  // The v5 fixture carries a NON-trivial traffic state including an
  // in-flight solver job — the archived contract covers the job codec.
  const V5_SAVE: Omit<CivSave, "pins"> = {
    ...V4_SAVE,
    header: { ...V4_SAVE.header, formatVersion: 5 },
    traffic: {
      msaK: 3,
      generated: 120,
      assigned: 90,
      walked: 20,
      unroutable: 10,
      volumes: Uint32Array.from([41]),
      job: {
        kind: 1,
        passIndex: 0,
        cursor: 33,
        generated: 80,
        assigned: 60,
        walked: 15,
        unroutable: 5,
        aon: Uint32Array.from([37]),
      },
    },
  };

  it("v5 fixture loads forever — migrated to empty pins, provenance preserved", async () => {
    if (!existsSync(V5_PATH)) {
      throw new Error(`fixture missing: ${V5_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V5_PATH)));
    expect(decoded).toEqual({ ...V5_SAVE, pins: [] });
    expect(decoded.header.formatVersion).toBe(5);
  });

  const V6_SAVE: CivSave = {
    ...V5_SAVE,
    header: { ...V5_SAVE.header, formatVersion: 6 },
    pins: [{ tileIdx: 200, slot: 8 }],
  };

  if (process.env.SEED_FIXTURES === "1" && !existsSync(V6_PATH)) {
    it("seeds the v6 fixture (first time only)", async () => {
      mkdirSync(dirname(V6_PATH), { recursive: true });
      writeFileSync(V6_PATH, await encodeCiv(V6_SAVE));
      expect(existsSync(V6_PATH)).toBe(true);
    });
  }

  it(`v${SAVE_FORMAT_VERSION} fixture decodes to its archived world, bit-faithfully`, async () => {
    if (!existsSync(V6_PATH)) {
      throw new Error(
        `fixture missing: ${V6_PATH} — run SEED_FIXTURES=1 pnpm test and commit the file`,
      );
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V6_PATH)));
    expect(decoded).toEqual(V6_SAVE);
  });
});

/** What every pre-v5 save migrates to: zeroed volumes, no memory, no job. */
function emptyTraffic(edgeCount: number): CivSave["traffic"] {
  return {
    msaK: 0,
    generated: 0,
    assigned: 0,
    walked: 0,
    unroutable: 0,
    volumes: new Uint32Array(edgeCount),
    job: null,
  };
}
