/**
 * @civitect/replay-theater — bug-report replay JSON to deterministic timeline.
 * It stays tool-local: protocol supplies command/map contracts, sim supplies the
 * authoritative tick loop, and this package adds sampling plus a static scrubber.
 */
import {
  BuildingKind,
  type BuildingKind as BuildingKindType,
  type Command,
  type CommandRejection,
  CommandType,
  flatTerrain,
  LOAN_TIERS,
  MAX_DISTRICTS,
  POLICY_BITS,
  RoadClassWire,
  type RoadClassWire as RoadClassWireType,
  SERVICE_BUDGET_MAX_PERMILLE,
  SERVICE_BUDGET_MIN_PERMILLE,
  ServiceId,
  type ServiceId as ServiceIdType,
  TAX_MAX_PERMILLE,
  TAX_MIN_PERMILLE,
  type TerrainGrid,
  type TerrainLayerName,
  ZoneKind,
  type ZoneKind as ZoneKindType,
} from "@civitect/protocol";
import { createWorld, runTick, stateHash, type World } from "@civitect/sim";

const MAX_MAP_SIZE = 512;
const U16_MAX = 0xffff;
const DEFAULT_SAMPLE_EVERY_TICKS = 1440;
const DEFAULT_MAX_FRAMES = 5000;
const DEFAULT_YIELD_EVERY_TICKS = 25_000;

const COMMAND_NAMES = [
  "selectTile",
  "setSpeed",
  "buildRoad",
  "bulldozeRoad",
  "upgradeRoad",
  "undo",
  "redo",
  "zoneRect",
  "dezoneRect",
  "placeBuilding",
  "pinCim",
  "unpinCim",
  "setServiceBudget",
  "setTaxRate",
  "takeLoan",
  "repayLoan",
  "paintDistrict",
  "nameDistrict",
  "setPolicy",
  "setOrdinance",
] as const;

type CommandName = (typeof COMMAND_NAMES)[number];
type JsonObject = Record<string, unknown>;

const COMMAND_NAME_SET: ReadonlySet<string> = new Set(COMMAND_NAMES);
const COMMAND_NAME_BY_ID: ReadonlyMap<number, CommandName> = new Map(
  COMMAND_NAMES.map((name) => [CommandType[name], name] as const),
);
const ROAD_CLASSES: ReadonlySet<number> = new Set([
  RoadClassWire.street,
  RoadClassWire.avenue,
  RoadClassWire.highway,
  RoadClassWire.path,
  RoadClassWire.bridgeStreet,
  RoadClassWire.bridgeAvenue,
  RoadClassWire.bridgeHighway,
  RoadClassWire.bridgePath,
]);
const ZONE_KINDS: ReadonlySet<number> = new Set([
  ZoneKind.residentialLow,
  ZoneKind.residentialHigh,
  ZoneKind.commercialLow,
  ZoneKind.commercialHigh,
  ZoneKind.industrial,
  ZoneKind.office,
]);
const BUILDING_KINDS: ReadonlySet<number> = new Set(
  Array.from({ length: BuildingKind.sewageTreatment }, (_, i) => i + 1),
);
const SERVICE_IDS: ReadonlySet<number> = new Set([
  ServiceId.fire,
  ServiceId.police,
  ServiceId.health,
  ServiceId.deathcare,
  ServiceId.education,
  ServiceId.parks,
  ServiceId.telecom,
  ServiceId.garbage,
  ServiceId.sewage,
]);
const TERRAIN_RECT_LAYERS: ReadonlySet<string> = new Set(["elevation", "water", "resource"]);

export interface TerrainRect {
  readonly layer: "elevation" | "water" | "resource";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly value: number;
}

export interface ReplayDocument {
  readonly name: string;
  readonly seed: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly untilTick: number;
  readonly startingFundsCents?: number;
  readonly terrainRects: readonly TerrainRect[];
  readonly commands: readonly Command[];
}

export interface ReplayTimelineOptions {
  readonly sampleEveryTicks?: number;
  readonly maxFrames?: number;
  readonly yieldEveryTicks?: number;
}

export interface ReplayFrame {
  readonly tick: number;
  readonly hash: string;
  readonly population: number;
  readonly fundsCents: number;
  readonly speed: number;
  readonly roads: {
    readonly nodes: number;
    readonly edges: number;
  };
  readonly buildingCount: number;
  readonly demand: {
    readonly r: number;
    readonly c: number;
    readonly i: number;
    readonly o: number;
  };
  readonly advisorEvents: number;
  readonly commandsRun: number;
  readonly rejections: number;
  readonly rejectedAtTick: readonly CommandRejection[];
}

export interface ReplayTimelineReport {
  readonly name: string;
  readonly seed: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly untilTick: number;
  readonly commandCount: number;
  readonly sampleEveryTicks: number;
  readonly frameCount: number;
  readonly frames: readonly ReplayFrame[];
  readonly final: ReplayFrame;
}

function asObject(value: unknown, at: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected a JSON object`);
  }
  return value as JsonObject;
}

function readString(obj: JsonObject, key: string, at: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${at}: ${key} must be a non-empty string`);
  }
  return value;
}

function readInt(
  obj: JsonObject,
  key: string,
  at: string,
  min: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${at}: ${key} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function readOptionalInt(
  obj: JsonObject,
  key: string,
  at: string,
  min: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${at}: ${key} must be an integer in [${min}, ${max}] when present`);
  }
  return value;
}

function readDomainInt(
  obj: JsonObject,
  key: string,
  at: string,
  domain: ReadonlySet<number>,
  label: string,
): number {
  const value = readInt(obj, key, at, 0, U16_MAX);
  if (!domain.has(value)) {
    throw new Error(`${at}: ${key} must be a known ${label}, got ${value}`);
  }
  return value;
}

function commandName(rawType: unknown, at: string): CommandName {
  if (typeof rawType === "string") {
    if (!COMMAND_NAME_SET.has(rawType)) {
      throw new Error(`${at}: unknown command type "${rawType}"`);
    }
    return rawType as CommandName;
  }
  if (typeof rawType === "number" && Number.isSafeInteger(rawType)) {
    const name = COMMAND_NAME_BY_ID.get(rawType);
    if (name !== undefined) {
      return name;
    }
    throw new Error(`${at}: unknown command id ${rawType}`);
  }
  throw new Error(`${at}: type must be a command name or numeric command id`);
}

function parseCommand(raw: unknown, at: string, untilTick: number): Command {
  const obj = asObject(raw, at);
  const seq = readInt(obj, "seq", at, 0, 0xffffffff);
  const tick = readInt(obj, "tick", at, 0);
  if (tick >= untilTick) {
    throw new Error(`${at}: tick ${tick} will not run before untilTick ${untilTick}`);
  }

  const name = commandName(obj.type, at);
  switch (name) {
    case "selectTile":
      return {
        seq,
        tick,
        type: CommandType.selectTile,
        x: readInt(obj, "x", at, 0, U16_MAX),
        y: readInt(obj, "y", at, 0, U16_MAX),
      };
    case "setSpeed":
      return {
        seq,
        tick,
        type: CommandType.setSpeed,
        speed: readInt(obj, "speed", at, 0, 0xff),
      };
    case "buildRoad":
      return {
        seq,
        tick,
        type: CommandType.buildRoad,
        ax: readInt(obj, "ax", at, 0, U16_MAX),
        ay: readInt(obj, "ay", at, 0, U16_MAX),
        bx: readInt(obj, "bx", at, 0, U16_MAX),
        by: readInt(obj, "by", at, 0, U16_MAX),
        roadClass: readDomainInt(
          obj,
          "roadClass",
          at,
          ROAD_CLASSES,
          "road class",
        ) as RoadClassWireType,
      };
    case "bulldozeRoad":
      return {
        seq,
        tick,
        type: CommandType.bulldozeRoad,
        ax: readInt(obj, "ax", at, 0, U16_MAX),
        ay: readInt(obj, "ay", at, 0, U16_MAX),
        bx: readInt(obj, "bx", at, 0, U16_MAX),
        by: readInt(obj, "by", at, 0, U16_MAX),
      };
    case "upgradeRoad":
      return {
        seq,
        tick,
        type: CommandType.upgradeRoad,
        ax: readInt(obj, "ax", at, 0, U16_MAX),
        ay: readInt(obj, "ay", at, 0, U16_MAX),
        bx: readInt(obj, "bx", at, 0, U16_MAX),
        by: readInt(obj, "by", at, 0, U16_MAX),
        roadClass: readDomainInt(
          obj,
          "roadClass",
          at,
          ROAD_CLASSES,
          "road class",
        ) as RoadClassWireType,
      };
    case "undo":
      return { seq, tick, type: CommandType.undo };
    case "redo":
      return { seq, tick, type: CommandType.redo };
    case "zoneRect":
      return {
        seq,
        tick,
        type: CommandType.zoneRect,
        x0: readInt(obj, "x0", at, 0, U16_MAX),
        y0: readInt(obj, "y0", at, 0, U16_MAX),
        x1: readInt(obj, "x1", at, 0, U16_MAX),
        y1: readInt(obj, "y1", at, 0, U16_MAX),
        zone: readDomainInt(obj, "zone", at, ZONE_KINDS, "zone kind") as ZoneKindType,
      };
    case "dezoneRect":
      return {
        seq,
        tick,
        type: CommandType.dezoneRect,
        x0: readInt(obj, "x0", at, 0, U16_MAX),
        y0: readInt(obj, "y0", at, 0, U16_MAX),
        x1: readInt(obj, "x1", at, 0, U16_MAX),
        y1: readInt(obj, "y1", at, 0, U16_MAX),
      };
    case "placeBuilding":
      return {
        seq,
        tick,
        type: CommandType.placeBuilding,
        x: readInt(obj, "x", at, 0, U16_MAX),
        y: readInt(obj, "y", at, 0, U16_MAX),
        building: readDomainInt(
          obj,
          "building",
          at,
          BUILDING_KINDS,
          "building kind",
        ) as BuildingKindType,
      };
    case "pinCim":
      return {
        seq,
        tick,
        type: CommandType.pinCim,
        tileIdx: readInt(obj, "tileIdx", at, 0, 0xffffffff),
        slot: readInt(obj, "slot", at, 0, 0xff),
      };
    case "unpinCim":
      return {
        seq,
        tick,
        type: CommandType.unpinCim,
        tileIdx: readInt(obj, "tileIdx", at, 0, 0xffffffff),
        slot: readInt(obj, "slot", at, 0, 0xff),
      };
    case "setServiceBudget":
      return {
        seq,
        tick,
        type: CommandType.setServiceBudget,
        service: readDomainInt(obj, "service", at, SERVICE_IDS, "service id") as ServiceIdType,
        permille: readInt(
          obj,
          "permille",
          at,
          SERVICE_BUDGET_MIN_PERMILLE,
          SERVICE_BUDGET_MAX_PERMILLE,
        ),
      };
    case "setTaxRate":
      return {
        seq,
        tick,
        type: CommandType.setTaxRate,
        zone: readDomainInt(obj, "zone", at, ZONE_KINDS, "zone kind") as ZoneKindType,
        permille: readInt(obj, "permille", at, TAX_MIN_PERMILLE, TAX_MAX_PERMILLE),
      };
    case "takeLoan":
      return {
        seq,
        tick,
        type: CommandType.takeLoan,
        tier: readInt(obj, "tier", at, 1, LOAN_TIERS),
      };
    case "repayLoan":
      return {
        seq,
        tick,
        type: CommandType.repayLoan,
        tier: readInt(obj, "tier", at, 1, LOAN_TIERS),
      };
    case "paintDistrict":
      return {
        seq,
        tick,
        type: CommandType.paintDistrict,
        x0: readInt(obj, "x0", at, 0, U16_MAX),
        y0: readInt(obj, "y0", at, 0, U16_MAX),
        x1: readInt(obj, "x1", at, 0, U16_MAX),
        y1: readInt(obj, "y1", at, 0, U16_MAX),
        districtId: readInt(obj, "districtId", at, 0, MAX_DISTRICTS),
      };
    case "nameDistrict":
      return {
        seq,
        tick,
        type: CommandType.nameDistrict,
        districtId: readInt(obj, "districtId", at, 1, MAX_DISTRICTS),
        name: readString(obj, "name", at),
      };
    case "setPolicy":
      return {
        seq,
        tick,
        type: CommandType.setPolicy,
        districtId: readInt(obj, "districtId", at, 1, MAX_DISTRICTS),
        policy: readInt(obj, "policy", at, 0, POLICY_BITS - 1),
        on: readInt(obj, "on", at, 0, 1),
      };
    case "setOrdinance":
      return {
        seq,
        tick,
        type: CommandType.setOrdinance,
        ordinance: readInt(obj, "ordinance", at, 0, POLICY_BITS - 1),
        on: readInt(obj, "on", at, 0, 1),
      };
  }
}

function parseTerrainRect(
  raw: unknown,
  at: string,
  mapWidth: number,
  mapHeight: number,
): TerrainRect {
  const obj = asObject(raw, at);
  const layer = readString(obj, "layer", at);
  if (!TERRAIN_RECT_LAYERS.has(layer)) {
    throw new Error(`${at}: layer must be elevation, water, or resource`);
  }
  const x0 = readInt(obj, "x0", at, 0, mapWidth - 1);
  const y0 = readInt(obj, "y0", at, 0, mapHeight - 1);
  const x1 = readInt(obj, "x1", at, 0, mapWidth - 1);
  const y1 = readInt(obj, "y1", at, 0, mapHeight - 1);
  if (x1 < x0 || y1 < y0) {
    throw new Error(`${at}: rect end must be greater than or equal to rect start`);
  }
  return {
    layer: layer as "elevation" | "water" | "resource",
    x0,
    y0,
    x1,
    y1,
    value: readInt(obj, "value", at, 0, U16_MAX),
  };
}

export function parseReplayDocument(doc: unknown, source: string): ReplayDocument {
  const obj = asObject(doc, source);
  const name = readString(obj, "name", source);
  const seed = readInt(obj, "seed", source, 0);
  const mapWidth = readInt(obj, "mapWidth", source, 1, MAX_MAP_SIZE);
  const mapHeight = readInt(obj, "mapHeight", source, 1, MAX_MAP_SIZE);
  const untilTick = readInt(obj, "untilTick", source, 0);
  const startingFundsCents = readOptionalInt(obj, "startingFundsCents", source, 0);

  const rawTerrainRects = obj.terrainRects ?? [];
  if (!Array.isArray(rawTerrainRects)) {
    throw new Error(`${source}: terrainRects must be an array when present`);
  }
  const terrainRects = rawTerrainRects.map((rect, index) =>
    parseTerrainRect(rect, `${source} terrainRects[${index}]`, mapWidth, mapHeight),
  );

  const rawCommands = obj.commands;
  if (!Array.isArray(rawCommands)) {
    throw new Error(`${source}: commands must be an array`);
  }
  const commands = rawCommands.map((command, index) =>
    parseCommand(command, `${source} commands[${index}]`, untilTick),
  );

  return {
    name,
    seed,
    mapWidth,
    mapHeight,
    untilTick,
    startingFundsCents,
    terrainRects,
    commands,
  };
}

export function replayTerrain(replay: ReplayDocument): TerrainGrid {
  const terrain = flatTerrain(replay.mapWidth, replay.mapHeight);
  for (const rect of replay.terrainRects) {
    const layer = terrain.layers[rect.layer as TerrainLayerName];
    for (let y = rect.y0; y <= rect.y1; y++) {
      const row = y * replay.mapWidth;
      for (let x = rect.x0; x <= rect.x1; x++) {
        layer[row + x] = rect.value;
      }
    }
  }
  return terrain;
}

function captureFrame(
  world: World,
  commandsRun: number,
  rejections: number,
  rejectedAtTick: readonly CommandRejection[],
): ReplayFrame {
  return {
    tick: world.tick,
    hash: stateHash(world),
    population: world.population,
    fundsCents: world.fundsCents,
    speed: world.speed,
    roads: {
      nodes: world.roads.nodeCount,
      edges: world.roads.edgeCount,
    },
    buildingCount: world.buildings.count,
    demand: {
      r: world.lastDemand.r,
      c: world.lastDemand.c,
      i: world.lastDemand.i,
      o: world.lastDemand.o,
    },
    advisorEvents: world.advisorQueue.length,
    commandsRun,
    rejections,
    rejectedAtTick,
  };
}

function sortedCommands(commands: readonly Command[]): Command[] {
  return [...commands].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
}

function frameOptions(options: ReplayTimelineOptions): {
  sampleEveryTicks: number;
  maxFrames: number;
  yieldEveryTicks: number;
} {
  const sampleEveryTicks = options.sampleEveryTicks ?? DEFAULT_SAMPLE_EVERY_TICKS;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const yieldEveryTicks = options.yieldEveryTicks ?? DEFAULT_YIELD_EVERY_TICKS;
  if (!Number.isSafeInteger(sampleEveryTicks) || sampleEveryTicks < 1) {
    throw new Error(`sampleEveryTicks must be a positive safe integer, got ${sampleEveryTicks}`);
  }
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 2) {
    throw new Error(`maxFrames must be at least 2, got ${maxFrames}`);
  }
  if (!Number.isSafeInteger(yieldEveryTicks) || yieldEveryTicks < 1) {
    throw new Error(`yieldEveryTicks must be a positive safe integer, got ${yieldEveryTicks}`);
  }
  return { sampleEveryTicks, maxFrames, yieldEveryTicks };
}

function enforceFrameBudget(
  frames: readonly ReplayFrame[],
  maxFrames: number,
  replayName: string,
): void {
  if (frames.length > maxFrames) {
    throw new Error(
      `${replayName}: generated ${frames.length} frames; raise --max-frames or sample less often`,
    );
  }
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function replayToTimeline(
  replay: ReplayDocument,
  options: ReplayTimelineOptions = {},
): Promise<ReplayTimelineReport> {
  const { sampleEveryTicks, maxFrames, yieldEveryTicks } = frameOptions(options);
  const world = createWorld(replay.seed, replay.mapWidth, replay.mapHeight, replayTerrain(replay));
  if (replay.startingFundsCents !== undefined) {
    world.fundsCents = replay.startingFundsCents;
  }

  const commands = sortedCommands(replay.commands);
  const frames: ReplayFrame[] = [captureFrame(world, 0, 0, [])];
  const batch: Command[] = [];
  let cursor = 0;
  let commandsRun = 0;
  let rejectionCount = 0;

  while (world.tick < replay.untilTick) {
    batch.length = 0;
    while (cursor < commands.length && (commands[cursor] as Command).tick === world.tick) {
      batch.push(commands[cursor] as Command);
      cursor++;
    }

    const rejected = runTick(world, batch);
    commandsRun += batch.length;
    rejectionCount += rejected.length;

    if (
      world.tick === replay.untilTick ||
      batch.length > 0 ||
      rejected.length > 0 ||
      world.tick % sampleEveryTicks === 0
    ) {
      frames.push(captureFrame(world, commandsRun, rejectionCount, rejected));
      enforceFrameBudget(frames, maxFrames, replay.name);
    }

    if (world.tick % yieldEveryTicks === 0 && world.tick < replay.untilTick) {
      await yieldToEventLoop();
    }
  }

  const final = frames[frames.length - 1];
  if (final === undefined) {
    throw new Error(`${replay.name}: replay generated no frames`);
  }

  return {
    name: replay.name,
    seed: replay.seed,
    mapWidth: replay.mapWidth,
    mapHeight: replay.mapHeight,
    untilTick: replay.untilTick,
    commandCount: replay.commands.length,
    sampleEveryTicks,
    frameCount: frames.length,
    frames,
    final,
  };
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function replayTimelineHtml(report: ReplayTimelineReport): string {
  const data = escapeJsonForScript(report);
  const title = escapeHtml(`${report.name} replay`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f2;
      color: #1f2420;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f7f7f2;
      color: #1f2420;
    }
    main {
      box-sizing: border-box;
      width: min(1120px, 100%);
      margin: 0 auto;
      padding: 28px 20px 36px;
    }
    header {
      display: grid;
      gap: 8px;
      margin-bottom: 22px;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.6rem, 3vw, 2.4rem);
      line-height: 1.05;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: #47524a;
      font-size: 0.95rem;
    }
    .toolbar {
      display: grid;
      gap: 10px;
      margin: 20px 0;
      padding: 16px;
      border: 1px solid #c9d0c5;
      border-radius: 8px;
      background: #ffffff;
    }
    input[type="range"] {
      width: 100%;
      accent-color: #25735b;
    }
    .readout {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .metric {
      min-height: 72px;
      padding: 12px;
      border: 1px solid #d8ded4;
      border-radius: 8px;
      background: #ffffff;
    }
    .label {
      margin-bottom: 6px;
      color: #5e675f;
      font-size: 0.78rem;
      text-transform: uppercase;
    }
    .value {
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 1rem;
    }
    .wide {
      grid-column: 1 / -1;
    }
    @media (prefers-color-scheme: dark) {
      :root,
      body {
        background: #161a17;
        color: #f1f4ef;
      }
      .summary {
        color: #b8c1b7;
      }
      .toolbar,
      .metric {
        border-color: #39443c;
        background: #202721;
      }
      .label {
        color: #aab4aa;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(report.name)}</h1>
      <div class="summary">
        <span>Seed ${report.seed}</span>
        <span>${report.mapWidth}x${report.mapHeight}</span>
        <span>${report.commandCount} commands</span>
        <span>${report.frameCount} frames</span>
      </div>
    </header>
    <section class="toolbar" aria-label="Replay frame controls">
      <input id="scrubber" type="range" min="0" max="${Math.max(0, report.frameCount - 1)}" value="${Math.max(0, report.frameCount - 1)}">
    </section>
    <section id="readout" class="readout" aria-live="polite"></section>
  </main>
  <script id="replay-data" type="application/json">${data}</script>
  <script>
    const report = JSON.parse(document.getElementById("replay-data").textContent);
    const scrubber = document.getElementById("scrubber");
    const readout = document.getElementById("readout");
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

    function metric(label, value, wide = false) {
      const el = document.createElement("article");
      el.className = wide ? "metric wide" : "metric";
      const labelEl = document.createElement("div");
      labelEl.className = "label";
      labelEl.textContent = label;
      const valueEl = document.createElement("div");
      valueEl.className = "value";
      valueEl.textContent = value;
      el.append(labelEl, valueEl);
      return el;
    }

    function render(index) {
      const frame = report.frames[index];
      readout.replaceChildren(
        metric("Frame", String(index + 1) + " / " + String(report.frameCount)),
        metric("Tick", String(frame.tick)),
        metric("Hash", frame.hash, true),
        metric("Population", String(frame.population)),
        metric("Funds", money.format(frame.fundsCents / 100)),
        metric("Speed", String(frame.speed) + "x"),
        metric("Roads", String(frame.roads.nodes) + " nodes, " + String(frame.roads.edges) + " edges"),
        metric("Buildings", String(frame.buildingCount)),
        metric("Demand", "R " + frame.demand.r + " / C " + frame.demand.c + " / I " + frame.demand.i + " / O " + frame.demand.o),
        metric("Advisor Events", String(frame.advisorEvents)),
        metric("Commands Run", String(frame.commandsRun)),
        metric("Rejections", String(frame.rejections))
      );
    }

    scrubber.addEventListener("input", () => render(Number(scrubber.value)));
    render(Number(scrubber.value));
  </script>
</body>
</html>
`;
}
