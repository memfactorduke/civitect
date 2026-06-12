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
import { type Command, CommandType, flatTerrain, type TerrainGrid } from "@civitect/protocol";

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
      const { ax, ay, bx, by, roadClass } = raw;
      if (
        !isNonNegativeSafeInt(ax) ||
        !isNonNegativeSafeInt(ay) ||
        !isNonNegativeSafeInt(bx) ||
        !isNonNegativeSafeInt(by) ||
        !isNonNegativeSafeInt(roadClass)
      ) {
        throw new Error(`${at}: ${raw.type} needs integer ax/ay/bx/by/roadClass`);
      }
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: raw.type === "buildRoad" ? CommandType.buildRoad : CommandType.upgradeRoad,
        ax,
        ay,
        bx,
        by,
        roadClass: roadClass as 1 | 2 | 3,
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
      const { x0, y0, x1, y1, zone } = raw;
      if (
        !isNonNegativeSafeInt(x0) ||
        !isNonNegativeSafeInt(y0) ||
        !isNonNegativeSafeInt(x1) ||
        !isNonNegativeSafeInt(y1) ||
        (raw.type === "zoneRect" && !isNonNegativeSafeInt(zone))
      ) {
        throw new Error(`${at}: ${raw.type} needs integer rect (and zone)`);
      }
      return raw.type === "zoneRect"
        ? {
            seq: raw.seq,
            tick: raw.tick,
            type: CommandType.zoneRect,
            x0,
            y0,
            x1,
            y1,
            zone: zone as 1 | 2 | 3 | 4 | 5 | 6,
          }
        : { seq: raw.seq, tick: raw.tick, type: CommandType.dezoneRect, x0, y0, x1, y1 };
    }
    case "placeBuilding": {
      const { x, y, building } = raw;
      if (!isNonNegativeSafeInt(x) || !isNonNegativeSafeInt(y) || !isNonNegativeSafeInt(building)) {
        throw new Error(`${at}: placeBuilding needs integer x/y/building`);
      }
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.placeBuilding,
        x,
        y,
        building: building as 1 | 2,
      };
    }
    case "setServiceBudget": {
      const { service, permille } = raw;
      if (!isNonNegativeSafeInt(service) || !isNonNegativeSafeInt(permille)) {
        throw new Error(`${at}: setServiceBudget needs integer service/permille`);
      }
      return {
        seq: raw.seq,
        tick: raw.tick,
        type: CommandType.setServiceBudget,
        service: service as 1,
        permille,
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
    commands,
    terrainRects,
  };
}
