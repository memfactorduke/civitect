/**
 * Golden-city scenario format (TDD §12.1, ADR-013 §1).
 *
 * A scenario is the *input* half of a golden master: seed + map + command log
 * + replay horizon, stored as readable JSON in `e2e/goldens/`. The *expected
 * output* half (state hash + HUD baseline) lives in `e2e/goldens/hashes.json`
 * and changes only via `pnpm bless`.
 *
 * This module is environment-pure (no Node APIs) so the determinism
 * cross-check (board PR 12) can ship scenarios into Chromium/WebKit pages
 * unchanged.
 */
import {
  BuildingKind,
  type Command,
  CommandType,
  flatTerrain,
  LOAN_TIERS,
  MAX_DISTRICTS,
  POLICY_BITS,
  RoadClassWire,
  SERVICE_BUDGET_MAX_PERMILLE,
  SERVICE_BUDGET_MIN_PERMILLE,
  SERVICE_ID_LIST,
  TAX_MAX_PERMILLE,
  TAX_MIN_PERMILLE,
  type TerrainGrid,
  ZoneKind,
} from "@civitect/protocol";

export interface TerrainRect {
  readonly layer: "elevation" | "water" | "resource";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly value: number;
}

export interface GoldenScenario {
  readonly name: string;
  readonly seed: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly untilTick: number;
  /** Treasury at tick 0 (compressed-script harness money); default 50k$. */
  readonly startingFundsCents?: number;
  readonly commands: readonly Command[];
  /** Optional terrain, painted as rects over a flat world (12e goldens). */
  readonly terrainRects: readonly TerrainRect[];
}

/** Materialize a scenario's terrain (flat + painted rects). */
export function scenarioTerrain(scenario: GoldenScenario): TerrainGrid {
  const terrain = flatTerrain(scenario.mapWidth, scenario.mapHeight);
  for (const rect of scenario.terrainRects) {
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        terrain.layers[rect.layer][y * scenario.mapWidth + x] = rect.value;
      }
    }
  }
  return terrain;
}

/** JSON wire shape: commands carry their type by NAME for human review. */
interface ScenarioJsonCommand {
  readonly seq: number;
  readonly tick: number;
  readonly type: string;
  readonly [field: string]: unknown;
}

function isNonNegativeSafeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function readNonNegativeSafeInt(
  raw: ScenarioJsonCommand,
  field: string,
  at: string,
  label: string,
): number {
  const value = raw[field];
  if (!isNonNegativeSafeInt(value)) {
    throw new Error(`${at}: ${label} needs non-negative integer ${field}`);
  }
  return value;
}

function readString(raw: ScenarioJsonCommand, field: string, at: string, label: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${at}: ${label} needs non-empty string ${field}`);
  }
  return value;
}

function readEnum<T extends number>(
  raw: ScenarioJsonCommand,
  field: string,
  allowed: readonly T[],
  at: string,
  label: string,
): T {
  const value = readNonNegativeSafeInt(raw, field, at, label);
  if (!allowed.includes(value as T)) {
    throw new Error(`${at}: ${label} has unsupported ${field} ${value}`);
  }
  return value as T;
}

function readRange(
  raw: ScenarioJsonCommand,
  field: string,
  min: number,
  max: number,
  at: string,
  label: string,
): number {
  const value = readNonNegativeSafeInt(raw, field, at, label);
  if (value < min || value > max) {
    throw new Error(`${at}: ${label} ${field} must be in [${min}, ${max}], got ${value}`);
  }
  return value;
}

const ROAD_CLASSES: readonly RoadClassWire[] = [
  RoadClassWire.street,
  RoadClassWire.avenue,
  RoadClassWire.highway,
  RoadClassWire.path,
  RoadClassWire.bridgeStreet,
  RoadClassWire.bridgeAvenue,
  RoadClassWire.bridgeHighway,
  RoadClassWire.bridgePath,
];

const ZONE_KINDS: readonly ZoneKind[] = [
  ZoneKind.residentialLow,
  ZoneKind.residentialHigh,
  ZoneKind.commercialLow,
  ZoneKind.commercialHigh,
  ZoneKind.industrial,
  ZoneKind.office,
];

const BUILDING_KINDS: readonly BuildingKind[] = [
  BuildingKind.powerPlant,
  BuildingKind.waterPump,
  BuildingKind.fireStation,
  BuildingKind.fireStationLarge,
  BuildingKind.policeStation,
  BuildingKind.policeHQ,
  BuildingKind.clinic,
  BuildingKind.hospital,
  BuildingKind.cemetery,
  BuildingKind.crematorium,
  BuildingKind.schoolElementary,
  BuildingKind.schoolHigh,
  BuildingKind.university,
  BuildingKind.library,
  BuildingKind.parkSmall,
  BuildingKind.plaza,
  BuildingKind.telecomTower,
  BuildingKind.landfill,
  BuildingKind.incinerator,
  BuildingKind.recyclingCenter,
  BuildingKind.sewageOutlet,
  BuildingKind.sewageTreatment,
];

function parseCommand(raw: ScenarioJsonCommand, at: string): Command {
  if (!isNonNegativeSafeInt(raw.seq) || !isNonNegativeSafeInt(raw.tick)) {
    throw new Error(`${at}: seq/tick must be non-negative safe integers`);
  }
  switch (raw.type) {
    case "selectTile": {
      const { x, y } = raw;
      if (!isNonNegativeSafeInt(x) || !isNonNegativeSafeInt(y)) {
        throw new Error(`${at}: selectTile needs non-negative integer x/y`);
      }
      return { seq: raw.seq, tick: raw.tick, type: CommandType.selectTile, x, y };
    }
    case "setSpeed": {
      const { speed } = raw;
      if (!isNonNegativeSafeInt(speed)) {
        throw new Error(`${at}: setSpeed needs a non-negative integer speed`);
      }
      return { seq: raw.seq, tick: raw.tick, type: CommandType.setSpeed, speed };
    }
    case "buildRoad":
    case "upgradeRoad": {
      const ax = readNonNegativeSafeInt(raw, "ax", at, raw.type);
      const ay = readNonNegativeSafeInt(raw, "ay", at, raw.type);
      const bx = readNonNegativeSafeInt(raw, "bx", at, raw.type);
      const by = readNonNegativeSafeInt(raw, "by", at, raw.type);
      const roadClass = readEnum(raw, "roadClass", ROAD_CLASSES, at, raw.type);
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: raw.type === "buildRoad" ? CommandType.buildRoad : CommandType.upgradeRoad,
        ax,
        ay,
        bx,
        by,
        roadClass,
      };
    }
    case "bulldozeRoad": {
      const { ax, ay, bx, by } = raw;
      if (
        !isNonNegativeSafeInt(ax) ||
        !isNonNegativeSafeInt(ay) ||
        !isNonNegativeSafeInt(bx) ||
        !isNonNegativeSafeInt(by)
      ) {
        throw new Error(`${at}: bulldozeRoad needs integer ax/ay/bx/by`);
      }
      return { seq: raw.seq, tick: raw.tick, type: CommandType.bulldozeRoad, ax, ay, bx, by };
    }
    case "zoneRect":
    case "dezoneRect": {
      const x0 = readNonNegativeSafeInt(raw, "x0", at, raw.type);
      const y0 = readNonNegativeSafeInt(raw, "y0", at, raw.type);
      const x1 = readNonNegativeSafeInt(raw, "x1", at, raw.type);
      const y1 = readNonNegativeSafeInt(raw, "y1", at, raw.type);
      return raw.type === "zoneRect"
        ? {
            seq: raw.seq,
            tick: raw.tick,
            type: CommandType.zoneRect,
            x0,
            y0,
            x1,
            y1,
            zone: readEnum(raw, "zone", ZONE_KINDS, at, raw.type),
          }
        : { seq: raw.seq, tick: raw.tick, type: CommandType.dezoneRect, x0, y0, x1, y1 };
    }
    case "placeBuilding": {
      const x = readNonNegativeSafeInt(raw, "x", at, raw.type);
      const y = readNonNegativeSafeInt(raw, "y", at, raw.type);
      const building = readEnum(raw, "building", BUILDING_KINDS, at, raw.type);
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.placeBuilding,
        x,
        y,
        building,
      };
    }
    case "pinCim":
    case "unpinCim": {
      const tileIdx = readNonNegativeSafeInt(raw, "tileIdx", at, raw.type);
      const slot = readNonNegativeSafeInt(raw, "slot", at, raw.type);
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: raw.type === "pinCim" ? CommandType.pinCim : CommandType.unpinCim,
        tileIdx,
        slot,
      };
    }
    case "setServiceBudget": {
      const service = readEnum(raw, "service", SERVICE_ID_LIST, at, raw.type);
      const permille = readRange(
        raw,
        "permille",
        SERVICE_BUDGET_MIN_PERMILLE,
        SERVICE_BUDGET_MAX_PERMILLE,
        at,
        raw.type,
      );
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.setServiceBudget,
        service,
        permille,
      };
    }
    case "setTaxRate": {
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.setTaxRate,
        zone: readEnum(raw, "zone", ZONE_KINDS, at, raw.type),
        permille: readRange(raw, "permille", TAX_MIN_PERMILLE, TAX_MAX_PERMILLE, at, raw.type),
      };
    }
    case "takeLoan":
    case "repayLoan": {
      const tier = readRange(raw, "tier", 1, LOAN_TIERS, at, raw.type);
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: raw.type === "takeLoan" ? CommandType.takeLoan : CommandType.repayLoan,
        tier,
      };
    }
    case "paintDistrict": {
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.paintDistrict,
        x0: readNonNegativeSafeInt(raw, "x0", at, raw.type),
        y0: readNonNegativeSafeInt(raw, "y0", at, raw.type),
        x1: readNonNegativeSafeInt(raw, "x1", at, raw.type),
        y1: readNonNegativeSafeInt(raw, "y1", at, raw.type),
        districtId: readRange(raw, "districtId", 0, MAX_DISTRICTS, at, raw.type),
      };
    }
    case "nameDistrict": {
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.nameDistrict,
        districtId: readRange(raw, "districtId", 1, MAX_DISTRICTS, at, raw.type),
        name: readString(raw, "name", at, raw.type),
      };
    }
    case "setPolicy": {
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.setPolicy,
        districtId: readRange(raw, "districtId", 1, MAX_DISTRICTS, at, raw.type),
        policy: readRange(raw, "policy", 0, POLICY_BITS - 1, at, raw.type),
        on: readRange(raw, "on", 0, 1, at, raw.type),
      };
    }
    case "setOrdinance": {
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.setOrdinance,
        ordinance: readRange(raw, "ordinance", 0, POLICY_BITS - 1, at, raw.type),
        on: readRange(raw, "on", 0, 1, at, raw.type),
      };
    }
    case "undo":
      return { seq: raw.seq, tick: raw.tick, type: CommandType.undo };
    case "redo":
      return { seq: raw.seq, tick: raw.tick, type: CommandType.redo };
    default:
      // Unknown names must be loud: a typo that silently dropped a command
      // would still replay "successfully" — to the wrong world.
      throw new Error(`${at}: unknown command type "${raw.type}"`);
  }
}

/** Parse + validate one scenario JSON document (already JSON.parse'd). */
export function parseScenario(doc: unknown, source: string): GoldenScenario {
  if (typeof doc !== "object" || doc === null) {
    throw new Error(`${source}: scenario must be a JSON object`);
  }
  const d = doc as Record<string, unknown>;
  if (typeof d.name !== "string" || d.name.length === 0) {
    throw new Error(`${source}: missing scenario name`);
  }
  if (!isNonNegativeSafeInt(d.seed)) {
    throw new Error(`${source}: seed must be a non-negative safe integer`);
  }
  if (!isNonNegativeSafeInt(d.mapWidth) || !isNonNegativeSafeInt(d.mapHeight)) {
    throw new Error(`${source}: mapWidth/mapHeight must be non-negative safe integers`);
  }
  if (!isNonNegativeSafeInt(d.untilTick)) {
    throw new Error(`${source}: untilTick must be a non-negative safe integer`);
  }
  if (d.startingFundsCents !== undefined && !isNonNegativeSafeInt(d.startingFundsCents)) {
    throw new Error(`${source}: startingFundsCents must be a non-negative safe integer`);
  }
  if (!Array.isArray(d.commands)) {
    throw new Error(`${source}: commands must be an array`);
  }
  const commands = d.commands.map((c, i) =>
    parseCommand(c as ScenarioJsonCommand, `${source} commands[${i}]`),
  );
  const terrainRects: TerrainRect[] = [];
  if (d.terrainRects !== undefined) {
    if (!Array.isArray(d.terrainRects)) {
      throw new Error(`${source}: terrainRects must be an array`);
    }
    for (const raw of d.terrainRects as Record<string, unknown>[]) {
      if (
        (raw.layer !== "elevation" && raw.layer !== "water" && raw.layer !== "resource") ||
        !isNonNegativeSafeInt(raw.x0) ||
        !isNonNegativeSafeInt(raw.y0) ||
        !isNonNegativeSafeInt(raw.x1) ||
        !isNonNegativeSafeInt(raw.y1) ||
        !isNonNegativeSafeInt(raw.value)
      ) {
        throw new Error(`${source}: malformed terrainRect`);
      }
      terrainRects.push(raw as unknown as TerrainRect);
    }
  }
  return {
    name: d.name,
    seed: d.seed,
    mapWidth: d.mapWidth,
    mapHeight: d.mapHeight,
    untilTick: d.untilTick,
    startingFundsCents: d.startingFundsCents as number | undefined,
    commands,
    terrainRects,
  };
}
