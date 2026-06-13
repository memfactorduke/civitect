/**
 * The .civ save view over the section container (TDD §10, ADR-010) —
 * container layout/integrity lives in container.ts; this module owns which
 * sections a SAVE carries and their codecs.
 *
 * Section ids are append-only. Ids 1–10 are reserved in TDD §10's listed
 * order (terrain…commandTail); Phase 0 ships WORLDCORE (11) carrying the
 * whole empty-world state — system sections take over from it as their
 * systems land, each takeover being a formatVersion bump with a migration
 * (ADR-010 [binding]).
 *
 * The protocol package owns this layout but knows no sim types: WorldCore
 * is the *serialized* shape; sim/app map their live state onto it.
 */
import { ByteReader } from "../bytes/reader";
import { ByteWriter } from "../bytes/writer";
import { type Command, decodeCommandBody, encodeCommandBody } from "../commands";
import { DecodeError, EncodeError } from "../errors";
import type { RoadSegment } from "../snapshot";
import {
  type ContainerHeader,
  decodeContainer,
  encodeContainer,
  SAVE_FORMAT_VERSION,
  SAVE_MAGIC,
} from "./container";
import { migrateSectionsV1toV2 } from "./migrations/v1_v2";
import { migrateSectionsV2toV3 } from "./migrations/v2_v3";
import { migrateSectionsV3toV4 } from "./migrations/v3_v4";
import { migrateSectionsV4toV5 } from "./migrations/v4_v5";
import { migrateSectionsV5toV6 } from "./migrations/v5_v6";
import { migrateSectionsV6toV7 } from "./migrations/v6_v7";
import { migrateSectionsV7toV8 } from "./migrations/v7_v8";
import { decodeTerrainSection, encodeTerrainSection, type TerrainGrid } from "./terrain";

export { SAVE_FORMAT_VERSION, SAVE_MAGIC };

export const SectionId = {
  terrain: 1,
  roads: 2,
  buildings: 3,
  cohorts: 4,
  networks: 5,
  economy: 6,
  policies: 7,
  agentPins: 8,
  settings: 9,
  commandTail: 10,
  worldCore: 11,
  /** v5 (Phase 3 tranche 2): MSA volumes + sliced-solver job (TDD §6.3/§10). */
  traffic: 12,
  /** v7 (Phase 4): service budgets + persistent ground pollution (GDD §7/§10). */
  services: 13,
} as const;
// NOTE: economy uses the RESERVED id 6 from TDD §10's original section list.
export type SectionId = (typeof SectionId)[keyof typeof SectionId];

export type SaveHeader = ContainerHeader;

export interface RngStreamState {
  readonly name: string;
  readonly stateHi: number;
  readonly stateLo: number;
  readonly incHi: number;
  readonly incLo: number;
}

/** Serialized form of the Phase 0 world (minus what the header carries). */
export interface WorldCore {
  readonly speed: number;
  readonly selectedTileIdx: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly fundsCents: number;
  readonly population: number;
  readonly rngStreams: readonly RngStreamState[];
}

/** One persisted building row; cohorts ride a parallel section. */
export interface BuildingRow {
  readonly tileIdx: number;
  readonly kind: number;
  readonly level: number;
  readonly status: number;
  readonly failDays: number;
  readonly thriveDays: number;
  /**
   * v7 service fields (Phase 4). `stock` is kind-contextual: garbage held
   * for occupied buildings, fill level for landfills/cemeteries.
   */
  readonly stock: number;
  readonly sick: number;
  readonly corpses: number;
  /** 0 = not burning; otherwise burn progress in fire-slice steps. */
  readonly fireTicks: number;
}

/**
 * Persistent service state (v7, GDD §7/§10): budget sliders in fixed
 * ServiceId order (1–9) and the ground-pollution field. A zero-length
 * pollution array means "all clean" (the migration's dimension-free
 * injection); otherwise length must equal the map's tile count — the
 * loader validates against the terrain dims.
 */
export interface ServicesSave {
  /** Permille of base, one per ServiceId in id order — always 9 entries. */
  readonly budgetsPermille: Uint16Array;
  readonly groundPollution: Uint8Array;
}

/** One loan (GDD §8: 3 tiers, monthly interest). All money integer cents. */
export interface LoanSave {
  readonly principalCents: number;
  readonly monthlyPaymentCents: number;
  readonly monthsLeft: number;
}

/**
 * Persistent economy state (v8, GDD §8/§13): tax rates per zone, active
 * loans, monthly report accumulators (current month + last month's lines
 * for MoM deltas), and progression (milestone/achievements/uniques/
 * difficulty/receivership). Fixed 13 report-line kinds (ReportLineKind).
 */
export interface EconomySave {
  /** Permille per ZoneKind 1–6, in zone order — always 6 entries. */
  readonly taxRatesPermille: Uint16Array;
  readonly loans: readonly LoanSave[];
  /** Current month's accumulating cents per ReportLineKind (13 entries). */
  readonly monthAccumCents: readonly number[];
  /** Last closed month's lines (13 entries) — the MoM delta base. */
  readonly lastMonthCents: readonly number[];
  readonly milestoneIndex: number;
  /** 64-bit achievement bitset as 8 bytes. */
  readonly achievements: Uint8Array;
  readonly uniquesMask: number;
  /** 0 relaxed, 1 mayor, 2 ironclad. */
  readonly difficulty: number;
  readonly receivership: number;
}

/** A pinned cim persona ref: building TILE (stable across saves) + slot. */
export interface CimPinSave {
  readonly tileIdx: number;
  readonly slot: number;
}

/**
 * An in-flight sliced solver job (TDD §6.3). The solver freezes nothing —
 * OD and costs re-derive from live state — so a resumable job is just its
 * progress: pass/cursor, the pass's accumulated all-or-nothing volumes (in
 * CANONICAL edge order, the roads section's order), and the pass ledger.
 */
export interface TrafficJobSave {
  /** 1 = incremental MSA step, 2 = full equilibrium solve. */
  readonly kind: number;
  readonly passIndex: number;
  readonly cursor: number;
  /** Pass-so-far conservation ledger. */
  readonly generated: number;
  readonly assigned: number;
  readonly walked: number;
  readonly unroutable: number;
  readonly aon: Uint32Array;
}

/** Persistent traffic state (TDD §6.3): MSA volumes + last-solve ledger. */
export interface TrafficSave {
  /** MSA step counter since the last full solve (capped sim-side). */
  readonly msaK: number;
  readonly generated: number;
  readonly assigned: number;
  readonly walked: number;
  readonly unroutable: number;
  /** Per canonical road edge — length must equal the roads section's. */
  readonly volumes: Uint32Array;
  readonly job: TrafficJobSave | null;
}

export interface CivSave {
  /**
   * formatVersion records PROVENANCE: a migrated v1 save keeps 1 here so
   * tooling can tell; the in-memory shape is always current-version
   * (terrain present). encodeCiv writes SAVE_FORMAT_VERSION regardless.
   */
  readonly header: SaveHeader;
  readonly terrain: TerrainGrid;
  /** Canonical road segments (endpoint-normalized, sorted — sim's form). */
  readonly roads: readonly RoadSegment[];
  /** Buildings sorted by tileIdx; cohorts[i] is row i's 20-u16 block. */
  readonly buildings: readonly BuildingRow[];
  readonly cohorts: Uint16Array;
  readonly worldCore: WorldCore;
  readonly traffic: TrafficSave;
  /** Service budgets + ground pollution (v7, GDD §7/§10). */
  readonly services: ServicesSave;
  /** Tax/loan/report/progression state (v8, GDD §8/§13). */
  readonly economy: EconomySave;
  /** Pinned cims (GDD §17.5), sorted by (tileIdx, slot). */
  readonly pins: readonly CimPinSave[];
  /** Commands since the snapshot, in applied (tick, seq) order. */
  readonly commandTail: readonly Command[];
}

function encodeWorldCore(core: WorldCore): Uint8Array {
  const w = new ByteWriter();
  w.u8(core.speed)
    .i64(core.selectedTileIdx)
    .u16(core.mapWidth)
    .u16(core.mapHeight)
    .i64(core.fundsCents)
    .u32(core.population)
    .u8(core.rngStreams.length);
  for (const s of core.rngStreams) {
    w.str(s.name).u32(s.stateHi).u32(s.stateLo).u32(s.incHi).u32(s.incLo);
  }
  return w.finish();
}

function decodeWorldCore(bytes: Uint8Array): WorldCore {
  const r = new ByteReader(bytes);
  const speed = r.u8();
  const selectedTileIdx = r.i64();
  const mapWidth = r.u16();
  const mapHeight = r.u16();
  const fundsCents = r.i64();
  const population = r.u32();
  const streamCount = r.u8();
  const rngStreams: RngStreamState[] = [];
  for (let i = 0; i < streamCount; i++) {
    rngStreams.push({
      name: r.str(),
      stateHi: r.u32(),
      stateLo: r.u32(),
      incHi: r.u32(),
      incLo: r.u32(),
    });
  }
  r.expectEnd();
  return { speed, selectedTileIdx, mapWidth, mapHeight, fundsCents, population, rngStreams };
}

function encodeRoads(roads: readonly RoadSegment[]): Uint8Array {
  const w = new ByteWriter();
  w.u32(roads.length);
  for (const seg of roads) {
    w.u16(seg.ax).u16(seg.ay).u16(seg.bx).u16(seg.by).u8(seg.roadClass);
  }
  return w.finish();
}

function decodeRoads(bytes: Uint8Array): RoadSegment[] {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const roads: RoadSegment[] = [];
  for (let i = 0; i < count; i++) {
    roads.push({ ax: r.u16(), ay: r.u16(), bx: r.u16(), by: r.u16(), roadClass: r.u8() });
  }
  r.expectEnd();
  return roads;
}

const COHORT_BLOCK = 20;

function encodeBuildings(rows: readonly BuildingRow[]): Uint8Array {
  const w = new ByteWriter();
  w.u32(rows.length);
  for (const row of rows) {
    w.u32(row.tileIdx)
      .u16(row.kind)
      .u8(row.level)
      .u8(row.status)
      .u8(row.failDays)
      .u8(row.thriveDays)
      .u32(row.stock)
      .u16(row.sick)
      .u16(row.corpses)
      .u8(row.fireTicks);
  }
  return w.finish();
}

function decodeBuildings(bytes: Uint8Array): BuildingRow[] {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const rows: BuildingRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      tileIdx: r.u32(),
      kind: r.u16(),
      level: r.u8(),
      status: r.u8(),
      failDays: r.u8(),
      thriveDays: r.u8(),
      stock: r.u32(),
      sick: r.u16(),
      corpses: r.u16(),
      fireTicks: r.u8(),
    });
  }
  r.expectEnd();
  return rows;
}

const SERVICE_COUNT = 9;
const ZONE_COUNT = 6;
const REPORT_KINDS = 13;
const MAX_LOANS = 3;

/** Layout shared with migrateSectionsV7toV8's injected section — keep in sync. */
function encodeEconomy(economy: EconomySave): Uint8Array {
  const w = new ByteWriter();
  for (let z = 0; z < ZONE_COUNT; z++) {
    w.u16(economy.taxRatesPermille[z] as number);
  }
  w.u8(economy.loans.length);
  for (const loan of economy.loans) {
    w.i64(loan.principalCents).i64(loan.monthlyPaymentCents).u16(loan.monthsLeft);
  }
  for (let k = 0; k < REPORT_KINDS; k++) {
    w.i64(economy.monthAccumCents[k] as number);
  }
  for (let k = 0; k < REPORT_KINDS; k++) {
    w.i64(economy.lastMonthCents[k] as number);
  }
  w.u8(economy.milestoneIndex);
  for (let b = 0; b < 8; b++) {
    w.u8(economy.achievements[b] as number);
  }
  w.u32(economy.uniquesMask).u8(economy.difficulty).u8(economy.receivership);
  return w.finish();
}

function decodeEconomy(bytes: Uint8Array): EconomySave {
  const r = new ByteReader(bytes);
  const taxRatesPermille = new Uint16Array(ZONE_COUNT);
  for (let z = 0; z < ZONE_COUNT; z++) {
    taxRatesPermille[z] = r.u16();
  }
  const loanCount = r.u8();
  if (loanCount > MAX_LOANS) {
    throw new DecodeError(`economy carries ${loanCount} loans, max ${MAX_LOANS}`);
  }
  const loans: LoanSave[] = [];
  for (let l = 0; l < loanCount; l++) {
    loans.push({ principalCents: r.i64(), monthlyPaymentCents: r.i64(), monthsLeft: r.u16() });
  }
  const monthAccumCents: number[] = [];
  for (let k = 0; k < REPORT_KINDS; k++) {
    monthAccumCents.push(r.i64());
  }
  const lastMonthCents: number[] = [];
  for (let k = 0; k < REPORT_KINDS; k++) {
    lastMonthCents.push(r.i64());
  }
  const milestoneIndex = r.u8();
  const achievements = new Uint8Array(8);
  for (let b = 0; b < 8; b++) {
    achievements[b] = r.u8();
  }
  const uniquesMask = r.u32();
  const difficulty = r.u8();
  const receivership = r.u8();
  r.expectEnd();
  return {
    taxRatesPermille,
    loans,
    monthAccumCents,
    lastMonthCents,
    milestoneIndex,
    achievements,
    uniquesMask,
    difficulty,
    receivership,
  };
}

/** Layout shared with migrateSectionsV6toV7's injected section — keep in sync. */
function encodeServices(services: ServicesSave): Uint8Array {
  const w = new ByteWriter();
  for (let s = 0; s < SERVICE_COUNT; s++) {
    w.u16(services.budgetsPermille[s] as number);
  }
  w.u32(services.groundPollution.length);
  for (const v of services.groundPollution) {
    w.u8(v);
  }
  return w.finish();
}

function decodeServices(bytes: Uint8Array): ServicesSave {
  const r = new ByteReader(bytes);
  const budgetsPermille = new Uint16Array(SERVICE_COUNT);
  for (let s = 0; s < SERVICE_COUNT; s++) {
    budgetsPermille[s] = r.u16();
  }
  const tiles = r.u32();
  const groundPollution = new Uint8Array(tiles);
  for (let i = 0; i < tiles; i++) {
    groundPollution[i] = r.u8();
  }
  r.expectEnd();
  return { budgetsPermille, groundPollution };
}

function encodeCohorts(cohorts: Uint16Array): Uint8Array {
  const w = new ByteWriter();
  w.u32(cohorts.length);
  for (const v of cohorts) {
    w.u16(v);
  }
  return w.finish();
}

function decodeCohorts(bytes: Uint8Array): Uint16Array {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = r.u16();
  }
  r.expectEnd();
  return out;
}

/** Layout shared with migrateSectionsV4toV5's injected section — keep in sync. */
function encodeTraffic(traffic: TrafficSave): Uint8Array {
  const w = new ByteWriter();
  w.u8(traffic.msaK)
    .u32(traffic.generated)
    .u32(traffic.assigned)
    .u32(traffic.walked)
    .u32(traffic.unroutable);
  w.u32(traffic.volumes.length);
  for (const v of traffic.volumes) {
    w.u32(v);
  }
  const job = traffic.job;
  if (job === null) {
    w.u8(0);
    return w.finish();
  }
  w.u8(job.kind)
    .u8(job.passIndex)
    .u32(job.cursor)
    .u32(job.generated)
    .u32(job.assigned)
    .u32(job.walked)
    .u32(job.unroutable);
  // aon shares volumes' length — validated at encode/decode.
  for (const v of job.aon) {
    w.u32(v);
  }
  return w.finish();
}

function decodeTraffic(bytes: Uint8Array): TrafficSave {
  const r = new ByteReader(bytes);
  const msaK = r.u8();
  const generated = r.u32();
  const assigned = r.u32();
  const walked = r.u32();
  const unroutable = r.u32();
  const edgeCount = r.u32();
  const volumes = new Uint32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    volumes[e] = r.u32();
  }
  const jobKind = r.u8();
  if (jobKind === 0) {
    r.expectEnd();
    return { msaK, generated, assigned, walked, unroutable, volumes, job: null };
  }
  const passIndex = r.u8();
  const cursor = r.u32();
  const jobLedger = { generated: r.u32(), assigned: r.u32(), walked: r.u32(), unroutable: r.u32() };
  const aon = new Uint32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    aon[e] = r.u32();
  }
  r.expectEnd();
  return {
    msaK,
    generated,
    assigned,
    walked,
    unroutable,
    volumes,
    job: { kind: jobKind, passIndex, cursor, ...jobLedger, aon },
  };
}

function encodePins(pins: readonly CimPinSave[]): Uint8Array {
  const w = new ByteWriter();
  w.u32(pins.length);
  for (const pin of pins) {
    w.u32(pin.tileIdx).u8(pin.slot);
  }
  return w.finish();
}

function decodePins(bytes: Uint8Array): CimPinSave[] {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const pins: CimPinSave[] = [];
  for (let i = 0; i < count; i++) {
    pins.push({ tileIdx: r.u32(), slot: r.u8() });
  }
  r.expectEnd();
  return pins;
}

function encodeCommandTail(commands: readonly Command[]): Uint8Array {
  const w = new ByteWriter();
  w.u32(commands.length);
  for (const command of commands) {
    encodeCommandBody(w, command);
  }
  return w.finish();
}

function decodeCommandTail(bytes: Uint8Array): Command[] {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const commands: Command[] = [];
  for (let i = 0; i < count; i++) {
    commands.push(decodeCommandBody(r));
  }
  r.expectEnd();
  return commands;
}

export async function encodeCiv(save: CivSave): Promise<Uint8Array> {
  if (
    save.terrain.width !== save.worldCore.mapWidth ||
    save.terrain.height !== save.worldCore.mapHeight
  ) {
    throw new EncodeError(
      `terrain is ${save.terrain.width}×${save.terrain.height}, world is ` +
        `${save.worldCore.mapWidth}×${save.worldCore.mapHeight}`,
    );
  }
  const terrainWriter = new ByteWriter();
  encodeTerrainSection(save.terrain, terrainWriter);
  // This build always writes the current format, whatever the save's provenance.
  if (save.cohorts.length !== save.buildings.length * COHORT_BLOCK) {
    throw new EncodeError(
      `cohorts length ${save.cohorts.length} ≠ buildings ${save.buildings.length} × ${COHORT_BLOCK}`,
    );
  }
  if (save.traffic.volumes.length !== save.roads.length) {
    throw new EncodeError(
      `traffic volumes cover ${save.traffic.volumes.length} edges, roads carry ${save.roads.length}`,
    );
  }
  if (save.traffic.job !== null && save.traffic.job.aon.length !== save.roads.length) {
    throw new EncodeError("traffic job per-edge arrays disagree with the roads section");
  }
  if (save.services.budgetsPermille.length !== SERVICE_COUNT) {
    throw new EncodeError(
      `services carries ${save.services.budgetsPermille.length} budgets, expected ${SERVICE_COUNT}`,
    );
  }
  const tiles = save.worldCore.mapWidth * save.worldCore.mapHeight;
  if (
    save.services.groundPollution.length !== 0 &&
    save.services.groundPollution.length !== tiles
  ) {
    throw new EncodeError(
      `ground pollution covers ${save.services.groundPollution.length} tiles, map has ${tiles}`,
    );
  }
  if (
    save.economy.taxRatesPermille.length !== ZONE_COUNT ||
    save.economy.monthAccumCents.length !== REPORT_KINDS ||
    save.economy.lastMonthCents.length !== REPORT_KINDS ||
    save.economy.achievements.length !== 8
  ) {
    throw new EncodeError("economy section arrays have wrong lengths");
  }
  return encodeContainer({ ...save.header, formatVersion: SAVE_FORMAT_VERSION }, [
    { id: SectionId.terrain, raw: terrainWriter.finish() },
    { id: SectionId.roads, raw: encodeRoads(save.roads) },
    { id: SectionId.buildings, raw: encodeBuildings(save.buildings) },
    { id: SectionId.cohorts, raw: encodeCohorts(save.cohorts) },
    { id: SectionId.worldCore, raw: encodeWorldCore(save.worldCore) },
    { id: SectionId.traffic, raw: encodeTraffic(save.traffic) },
    { id: SectionId.services, raw: encodeServices(save.services) },
    { id: SectionId.economy, raw: encodeEconomy(save.economy) },
    { id: SectionId.agentPins, raw: encodePins(save.pins) },
    { id: SectionId.commandTail, raw: encodeCommandTail(save.commandTail) },
  ]);
}

export async function decodeCiv(bytes: Uint8Array): Promise<CivSave> {
  const { header, sections: rawSections } = await decodeContainer(bytes);
  // Migration ladder (ADR-010): each step lifts one version; old fixtures
  // walk the whole ladder forever.
  let sections = rawSections;
  if (header.formatVersion <= 1) {
    sections = migrateSectionsV1toV2(sections, {
      terrain: SectionId.terrain,
      worldCore: SectionId.worldCore,
    });
  }
  if (header.formatVersion <= 2) {
    sections = migrateSectionsV2toV3(sections, { roads: SectionId.roads });
  }
  if (header.formatVersion <= 3) {
    sections = migrateSectionsV3toV4(sections, {
      buildings: SectionId.buildings,
      cohorts: SectionId.cohorts,
    });
  }
  if (header.formatVersion <= 4) {
    sections = migrateSectionsV4toV5(sections, {
      roads: SectionId.roads,
      traffic: SectionId.traffic,
    });
  }
  if (header.formatVersion <= 5) {
    sections = migrateSectionsV5toV6(sections, { agentPins: SectionId.agentPins });
  }
  if (header.formatVersion <= 6) {
    sections = migrateSectionsV6toV7(sections, {
      buildings: SectionId.buildings,
      services: SectionId.services,
    });
  }
  if (header.formatVersion <= 7) {
    sections = migrateSectionsV7toV8(sections, { economy: SectionId.economy });
  }

  const terrainRaw = sections.get(SectionId.terrain);
  const roadsRaw = sections.get(SectionId.roads);
  const buildingsRaw = sections.get(SectionId.buildings);
  const cohortsRaw = sections.get(SectionId.cohorts);
  const worldCoreRaw = sections.get(SectionId.worldCore);
  const trafficRaw = sections.get(SectionId.traffic);
  const servicesRaw = sections.get(SectionId.services);
  const economyRaw = sections.get(SectionId.economy);
  const pinsRaw = sections.get(SectionId.agentPins);
  const commandTailRaw = sections.get(SectionId.commandTail);
  if (
    terrainRaw === undefined ||
    roadsRaw === undefined ||
    buildingsRaw === undefined ||
    cohortsRaw === undefined ||
    worldCoreRaw === undefined ||
    trafficRaw === undefined ||
    servicesRaw === undefined ||
    economyRaw === undefined ||
    pinsRaw === undefined ||
    commandTailRaw === undefined
  ) {
    throw new DecodeError(
      "save must carry TERRAIN, ROADS, BUILDINGS, COHORTS, WORLDCORE, TRAFFIC, SERVICES, ECONOMY, AGENTPINS, COMMANDTAIL",
    );
  }
  const buildings = decodeBuildings(buildingsRaw);
  const cohorts = decodeCohorts(cohortsRaw);
  if (cohorts.length !== buildings.length * COHORT_BLOCK) {
    throw new DecodeError("cohort block count disagrees with building count — corrupt save");
  }
  const terrainReader = new ByteReader(terrainRaw);
  const terrain = decodeTerrainSection(terrainReader);
  terrainReader.expectEnd();
  const worldCore = decodeWorldCore(worldCoreRaw);
  if (terrain.width !== worldCore.mapWidth || terrain.height !== worldCore.mapHeight) {
    throw new DecodeError(
      `terrain is ${terrain.width}×${terrain.height}, world is ` +
        `${worldCore.mapWidth}×${worldCore.mapHeight} — corrupt save`,
    );
  }
  const roads = decodeRoads(roadsRaw);
  const traffic = decodeTraffic(trafficRaw);
  if (traffic.volumes.length !== roads.length) {
    throw new DecodeError(
      `traffic covers ${traffic.volumes.length} edges, roads carry ${roads.length} — corrupt save`,
    );
  }
  const services = decodeServices(servicesRaw);
  const tiles = worldCore.mapWidth * worldCore.mapHeight;
  if (services.groundPollution.length !== 0 && services.groundPollution.length !== tiles) {
    throw new DecodeError(
      `ground pollution covers ${services.groundPollution.length} tiles, map has ${tiles} — corrupt save`,
    );
  }
  return {
    header,
    terrain,
    roads,
    buildings,
    cohorts,
    worldCore,
    traffic,
    services,
    economy: decodeEconomy(economyRaw),
    pins: decodePins(pinsRaw),
    commandTail: decodeCommandTail(commandTailRaw),
  };
}
