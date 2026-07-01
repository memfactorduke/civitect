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
const V7_PATH = join(FIXTURES_DIR, "v7", "empty-world-y1.civ");
const V8_PATH = join(FIXTURES_DIR, "v8", "empty-world-y1.civ");
const V9_PATH = join(FIXTURES_DIR, "v9", "empty-world-y1.civ");
const V10_PATH = join(FIXTURES_DIR, "v10", "empty-world-y1.civ");
const V11_PATH = join(FIXTURES_DIR, "v11", "empty-world-y1.civ");
const V12_PATH = join(FIXTURES_DIR, "v12", "empty-world-y1.civ");

/** What every pre-v9 save migrates to: no roles, empty shelves, no freight. */
function defaultChain(): CivSave["chain"] {
  return {
    shipments: [],
    produced: new Uint32Array(6),
    consumed: new Uint32Array(6),
    imported: new Uint32Array(6),
    exported: new Uint32Array(6),
    lost: new Uint32Array(6),
  };
}

/** What every pre-v10 save migrates to: no districts, no ordinances. */
function defaultDistricts(): CivSave["districts"] {
  return { districts: [], ordinanceMask: 0 };
}

/** What every pre-v11 save migrates to: no transit lines, ids from 1. */
function defaultTransit(): CivSave["transit"] {
  return { lines: [], nextLineId: 1 };
}

/** What every pre-v8 save migrates to: default taxes, no loans, Mayor. */
function defaultEconomy(): CivSave["economy"] {
  return {
    taxRatesPermille: new Uint16Array(6).fill(90),
    loans: [],
    monthAccumCents: new Array(14).fill(0),
    lastMonthCents: new Array(14).fill(0),
    milestoneIndex: 0,
    achievements: new Uint8Array(8),
    uniquesMask: 0,
    difficulty: 1,
    receivership: 0,
    bailoutUsed: 0,
  };
}

/** What every pre-v7 save migrates to: default sliders, clean ground. */
function defaultServices(): CivSave["services"] {
  return {
    budgetsPermille: new Uint16Array(9).fill(1000),
    groundPollution: new Uint8Array(0),
  };
}

/**
 * Canonical v1 fixture content: an empty 64×64 world one game-year in,
 * with a short command tail. Values are fixed by hand here — the fixture
 * is a format contract, not a sim artifact (sim-produced saves are PR 9's
 * e2e territory).
 */
const V1_SAVE: Omit<
  CivSave,
  | "terrain"
  | "roads"
  | "buildings"
  | "cohorts"
  | "traffic"
  | "pins"
  | "services"
  | "economy"
  | "chain"
  | "districts"
  | "transit"
> = {
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
      services: defaultServices(),
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(1);
  });

  const V2_SAVE: Omit<
    CivSave,
    | "roads"
    | "buildings"
    | "cohorts"
    | "traffic"
    | "pins"
    | "services"
    | "economy"
    | "chain"
    | "districts"
    | "transit"
  > = {
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
      services: defaultServices(),
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(2);
  });

  const V3_SAVE: Omit<
    CivSave,
    | "buildings"
    | "cohorts"
    | "traffic"
    | "pins"
    | "services"
    | "economy"
    | "chain"
    | "districts"
    | "transit"
  > = {
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
      services: defaultServices(),
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(3);
  });

  // Building rows carry the v7 zero-fill the migration injects — the
  // archived v4 bytes hold the old 10-byte rows.
  const V4_SAVE: Omit<
    CivSave,
    "traffic" | "pins" | "services" | "economy" | "chain" | "districts" | "transit"
  > = {
    ...V3_SAVE,
    header: { ...V3_SAVE.header, formatVersion: 4 },
    buildings: [
      {
        tileIdx: 200,
        kind: 1,
        level: 2,
        status: 0,
        failDays: 0,
        thriveDays: 1,
        stock: 0,
        sick: 0,
        corpses: 0,
        fireTicks: 0,
        chainRole: 0,
        stockIn: 0,
        stockOut: 0,
      },
    ],
    cohorts: Uint16Array.from({ length: 20 }, (_, k) => (k === 8 ? 2 : 0)),
  };

  it("v4 fixture loads forever — migrated to zeroed traffic, provenance preserved", async () => {
    if (!existsSync(V4_PATH)) {
      throw new Error(`fixture missing: ${V4_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V4_PATH)));
    // One road edge -> migration injects one zeroed volume (a fresh
    // incremental solve at the next boundary, exactly v4-era behavior).
    expect(decoded).toEqual({
      ...V4_SAVE,
      traffic: emptyTraffic(1),
      pins: [],
      services: defaultServices(),
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(4);
  });

  // The v5 fixture carries a NON-trivial traffic state including an
  // in-flight solver job — the archived contract covers the job codec.
  const V5_SAVE: Omit<
    CivSave,
    "pins" | "services" | "economy" | "chain" | "districts" | "transit"
  > = {
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
    expect(decoded).toEqual({
      ...V5_SAVE,
      pins: [],
      services: defaultServices(),
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(5);
  });

  const V6_SAVE: Omit<CivSave, "services" | "economy" | "chain" | "districts" | "transit"> = {
    ...V5_SAVE,
    header: { ...V5_SAVE.header, formatVersion: 6 },
    pins: [{ tileIdx: 200, slot: 8 }],
  };

  it("v6 fixture loads forever — migrated to default services, provenance preserved", async () => {
    if (!existsSync(V6_PATH)) {
      throw new Error(`fixture missing: ${V6_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V6_PATH)));
    expect(decoded).toEqual({
      ...V6_SAVE,
      services: defaultServices(),
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(6);
  });

  // The v7 fixture carries NON-default services — sliders off 1000 and a
  // dimension-matched sparse pollution field — so the archived contract
  // covers the codec, not just the migration's defaults.
  const V7_SAVE: Omit<CivSave, "economy" | "chain" | "districts" | "transit"> = {
    ...V6_SAVE,
    header: { ...V6_SAVE.header, formatVersion: 7 },
    services: {
      budgetsPermille: Uint16Array.from([1000, 1200, 800, 1000, 1500, 500, 1000, 900, 1100]),
      groundPollution: (() => {
        const field = new Uint8Array(64 * 64);
        field[200] = 180;
        field[201] = 90;
        field[4000] = 12;
        return field;
      })(),
    },
  };

  it("v7 fixture loads forever — migrated to default economy, provenance preserved", async () => {
    if (!existsSync(V7_PATH)) {
      throw new Error(`fixture missing: ${V7_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V7_PATH)));
    expect(decoded).toEqual({
      ...V7_SAVE,
      economy: defaultEconomy(),
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(7);
  });

  // The v8 fixture carries NON-default economy — off-default taxes, an
  // active loan, mid-month accumulators, progression state — so the codec
  // itself is the archived contract, not just the migration default.
  const V8_SAVE: Omit<CivSave, "chain" | "districts" | "transit"> = {
    ...V7_SAVE,
    header: { ...V7_SAVE.header, formatVersion: 8 },
    economy: {
      taxRatesPermille: Uint16Array.from([90, 110, 120, 95, 140, 80]),
      loans: [{ principalCents: 50_000_00, monthlyPaymentCents: 1_250_00, monthsLeft: 44 }],
      monthAccumCents: [100, -200, 300, 0, -50, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      lastMonthCents: [90, -180, 250, 0, -40, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      milestoneIndex: 3,
      achievements: Uint8Array.from([0b101, 0, 0, 0, 0, 0, 0, 0b1000_0000]),
      uniquesMask: 0b1010,
      difficulty: 2,
      receivership: 0,
      bailoutUsed: 1,
    },
  };

  it("v8 fixture loads forever — migrated to empty chain, provenance preserved", async () => {
    if (!existsSync(V8_PATH)) {
      throw new Error(`fixture missing: ${V8_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V8_PATH)));
    expect(decoded).toEqual({
      ...V8_SAVE,
      chain: defaultChain(),
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(8);
  });

  // The v9 fixture carries NON-default chain state — roles and stocks on
  // the building row, in-flight shipments to both endpoint kinds, nonzero
  // ledgers — so the codec itself is the archived contract.
  const V9_SAVE: Omit<CivSave, "districts" | "transit"> = {
    ...V8_SAVE,
    header: { ...V8_SAVE.header, formatVersion: 9 },
    buildings: [
      {
        tileIdx: 200,
        kind: 1,
        level: 2,
        status: 0,
        failDays: 0,
        thriveDays: 1,
        stock: 0,
        sick: 0,
        corpses: 0,
        fireTicks: 0,
        chainRole: 5, // processed
        stockIn: 12,
        stockOut: 30,
      },
    ],
    chain: {
      shipments: [
        {
          fromKind: 0, // building
          fromTile: 200,
          toKind: 0,
          toTile: 451,
          commodity: 5, // processed
          units: 24,
          dispatchTick: 525_000,
          arriveTick: 525_180,
        },
        {
          fromKind: 1, // map-edge anchor: an import
          fromTile: 63,
          toKind: 0,
          toTile: 200,
          commodity: 1, // rawOre
          units: 40,
          dispatchTick: 525_100,
          arriveTick: 525_400,
        },
      ],
      produced: Uint32Array.from([100, 0, 0, 0, 60, 30]),
      consumed: Uint32Array.from([58, 0, 0, 0, 24, 18]),
      imported: Uint32Array.from([40, 0, 0, 0, 0, 0]),
      exported: Uint32Array.from([0, 0, 0, 0, 6, 2]),
      lost: Uint32Array.from([2, 0, 0, 0, 0, 0]),
    },
  };

  if (process.env.SEED_FIXTURES === "1" && !existsSync(V9_PATH)) {
    it("seeds the v9 fixture (first time only)", async () => {
      mkdirSync(dirname(V9_PATH), { recursive: true });
      writeFileSync(
        V9_PATH,
        await encodeCiv({ ...V9_SAVE, districts: defaultDistricts(), transit: defaultTransit() }),
      );
      expect(existsSync(V9_PATH)).toBe(true);
    });
  }

  it("v9 fixture loads forever — migrated to empty districts, provenance preserved", async () => {
    if (!existsSync(V9_PATH)) {
      throw new Error(`fixture missing: ${V9_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V9_PATH)));
    expect(decoded).toEqual({
      ...V9_SAVE,
      districts: defaultDistricts(),
      transit: defaultTransit(),
    });
    expect(decoded.header.formatVersion).toBe(9);
  });

  // The v10 fixture carries NON-default districts — named districts with
  // policy masks + tax overrides and a city ordinance — so the codec is the
  // archived contract, not just the migration default.
  const V10_SAVE: Omit<CivSave, "transit"> = {
    ...V9_SAVE,
    header: { ...V9_SAVE.header, formatVersion: 10 },
    districts: {
      ordinanceMask: 0b1010,
      districts: [
        {
          name: "Old Town",
          policyMask: 0b101,
          taxOverridePermille: Uint16Array.from([120, 120, 80, 80, 100, 90]),
        },
        {
          name: "Downtown",
          policyMask: 0b10,
          taxOverridePermille: Uint16Array.from([0, 0, 0, 0, 0, 0]),
        },
      ],
    },
  };

  if (process.env.SEED_FIXTURES === "1" && !existsSync(V10_PATH)) {
    it("seeds the v10 fixture (first time only)", async () => {
      mkdirSync(dirname(V10_PATH), { recursive: true });
      writeFileSync(V10_PATH, await encodeCiv({ ...V10_SAVE, transit: defaultTransit() }));
      expect(existsSync(V10_PATH)).toBe(true);
    });
  }

  it("v10 fixture loads forever — migrated to empty transit, provenance preserved", async () => {
    if (!existsSync(V10_PATH)) {
      throw new Error(`fixture missing: ${V10_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V10_PATH)));
    expect(decoded).toEqual({ ...V10_SAVE, transit: defaultTransit() });
    expect(decoded.header.formatVersion).toBe(10);
  });

  // The v11 fixture carries NON-default transit — named lines with ordered
  // stops, vehicle/headway config and nonzero rider/cost/fare ledgers — so
  // the codec itself is the archived contract, not just the migration default.
  const V11_SAVE: CivSave = {
    ...V10_SAVE,
    header: { ...V10_SAVE.header, formatVersion: 11 },
    transit: {
      nextLineId: 3,
      lines: [
        {
          id: 1,
          mode: 1, // bus
          color: 0xe5533a,
          name: "Crosstown",
          stops: Uint32Array.from([200, 264, 328, 392]),
          vehicles: 6,
          headwayTicks: 40,
          riders: 1234,
          costCents: 250_000,
          fareCents: 370_200,
        },
        {
          id: 2,
          mode: 3, // metro
          color: 0x2e86de,
          name: "Blue Line",
          stops: Uint32Array.from([100, 612]),
          vehicles: 4,
          headwayTicks: 90,
          riders: 5678,
          costCents: 900_000,
          fareCents: 1_703_400,
        },
      ],
    },
  };

  it("v11 fixture loads forever — economy grows to 14 report kinds (transitFare), provenance preserved", async () => {
    if (!existsSync(V11_PATH)) {
      throw new Error(`fixture missing: ${V11_PATH}`);
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V11_PATH)));
    // The v11 economy carried 13 report arrays; v12 injects a trailing 0
    // (transitFare), which V11_SAVE's economy now also shows.
    expect(decoded).toEqual(V11_SAVE);
    expect(decoded.header.formatVersion).toBe(11);
  });

  // The v12 fixture carries a NON-DEFAULT economy with a nonzero transitFare
  // (report kind 14) — so the codec's new report slot is the archived contract.
  const V12_SAVE: CivSave = {
    ...V11_SAVE,
    header: { ...V11_SAVE.header, formatVersion: 12 },
    economy: {
      ...V11_SAVE.economy,
      monthAccumCents: [100, -200, 300, 0, -50, 0, 0, 0, 0, 0, 0, 0, 0, 4_200],
      lastMonthCents: [90, -180, 250, 0, -40, 0, 0, 0, 0, 0, 0, 0, 0, 3_900],
    },
  };

  if (process.env.SEED_FIXTURES === "1" && !existsSync(V12_PATH)) {
    it("seeds the v12 fixture (first time only)", async () => {
      mkdirSync(dirname(V12_PATH), { recursive: true });
      writeFileSync(V12_PATH, await encodeCiv(V12_SAVE));
      expect(existsSync(V12_PATH)).toBe(true);
    });
  }

  it(`v${SAVE_FORMAT_VERSION} fixture decodes to its archived world, bit-faithfully`, async () => {
    if (!existsSync(V12_PATH)) {
      throw new Error(
        `fixture missing: ${V12_PATH} — run SEED_FIXTURES=1 pnpm test and commit the file`,
      );
    }
    const decoded = await decodeCiv(new Uint8Array(readFileSync(V12_PATH)));
    expect(decoded).toEqual(V12_SAVE);
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
