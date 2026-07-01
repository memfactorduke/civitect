/**
 * Commands, UI → sim (TDD §7): tick-stamped, sequence-numbered binary structs.
 * Sim is authoritative — invalid commands come back as CommandRejection with a
 * reason code; the UI's optimistic ghosts are cosmetic until confirmed.
 *
 * v1: selectTile/setSpeed (Phase 0 round trip). v3: road tools —
 * build/bulldoze/upgrade address segments by TILE PAIR (the UI speaks
 * tiles; edge slot ids are sim-internal), and undo/redo are SIM commands
 * so they live in the replay log like everything else (ROADMAP Phase 1
 * exit: build∘undo ≡ identity on state hash — only sim-side undo can
 * make that claim). Wire ids are append-only.
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { DecodeError } from "./errors";

export const CommandType = {
  selectTile: 1,
  setSpeed: 2,
  buildRoad: 3,
  bulldozeRoad: 4,
  upgradeRoad: 5,
  undo: 6,
  redo: 7,
  zoneRect: 8,
  dezoneRect: 9,
  placeBuilding: 10,
  /** Pin a cim persona (building tile + cohort slot, GDD §17.5) — canonical. */
  pinCim: 11,
  unpinCim: 12,
  /** Service budget slider (GDD §7, Phase 4) — scales capacity + coverage. */
  setServiceBudget: 13,
  /** Phase 5 economy (GDD §8): per-zone tax rate, loans (3 tiers). */
  setTaxRate: 14,
  takeLoan: 15,
  repayLoan: 16,
  /** Phase 6 districts (GDD §11): paint a district id over a rect, name it,
   *  toggle a per-district policy bit, toggle a city-wide ordinance bit. */
  paintDistrict: 17,
  nameDistrict: 18,
  setPolicy: 19,
  setOrdinance: 20,
  /** Phase 6 transit (GDD §9): create/delete a line, add/remove a stop, set
   *  the per-line vehicle count + headway. The line id is UI-chosen (like a
   *  district id) and the sim validates it. */
  createLine: 21,
  deleteLine: 22,
  addStop: 23,
  removeStop: 24,
  setLineVehicles: 25,
  /** Phase 6 districts task 2 (GDD §11): per-district per-zone tax override,
   *  0 = clear/inherit the city rate. The first real district policy hook. */
  setDistrictTax: 26,
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

export interface CommandBase {
  /** u32, monotonically increasing per session — pairs rejections with ghosts. */
  readonly seq: number;
  /** Tick the command applies on (u64). The tick counter is time (ADR-005). */
  readonly tick: number;
}

export interface SelectTileCommand extends CommandBase {
  readonly type: typeof CommandType.selectTile;
  /** Tile coordinates, u16 each (L map is 512², TDD §5). */
  readonly x: number;
  readonly y: number;
}

export interface SetSpeedCommand extends CommandBase {
  readonly type: typeof CommandType.setSpeed;
  /** Speed multiplier index, u8; 0 = paused. Multipliers run more ticks, never bigger ones. */
  readonly speed: number;
}

/**
 * Road classes on the wire (sim consumes these values — protocol is the
 * contract). 4 = ped/bike path. 11–14 = the bridge variant of 1–4
 * (BRIDGE_CLASS_OFFSET): bridges may cross water, are grade-separated
 * (never auto-split with crossings), and may not be built on dry land.
 * Ids are append-only.
 */
export const RoadClassWire = {
  street: 1,
  avenue: 2,
  highway: 3,
  path: 4,
  bridgeStreet: 11,
  bridgeAvenue: 12,
  bridgeHighway: 13,
  bridgePath: 14,
} as const;
export type RoadClassWire = (typeof RoadClassWire)[keyof typeof RoadClassWire];

export const BRIDGE_CLASS_OFFSET = 10;

/** Zone kinds painted into the terrain zone layer (GDD §6). Append-only. */
export const ZoneKind = {
  none: 0,
  residentialLow: 1,
  residentialHigh: 2,
  commercialLow: 3,
  commercialHigh: 4,
  industrial: 5,
  office: 6,
} as const;
export type ZoneKind = (typeof ZoneKind)[keyof typeof ZoneKind];

const ZONE_KINDS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6]);

/**
 * Player-placed (ploppable) building kinds. 1–2 are the Phase 2 utility
 * set; 3+ are the Phase 4 service set (GDD §7 table, v1 buildings —
 * late-game helipad/stadium join with their phases). Append-only.
 */
export const BuildingKind = {
  powerPlant: 1,
  waterPump: 2,
  fireStation: 3,
  fireStationLarge: 4,
  policeStation: 5,
  policeHQ: 6,
  clinic: 7,
  hospital: 8,
  cemetery: 9,
  crematorium: 10,
  schoolElementary: 11,
  schoolHigh: 12,
  university: 13,
  library: 14,
  parkSmall: 15,
  plaza: 16,
  telecomTower: 17,
  landfill: 18,
  incinerator: 19,
  recyclingCenter: 20,
  sewageOutlet: 21,
  sewageTreatment: 22,
} as const;
export type BuildingKind = (typeof BuildingKind)[keyof typeof BuildingKind];

const BUILDING_KINDS: ReadonlySet<number> = new Set(Array.from({ length: 22 }, (_, i) => i + 1));

/**
 * Service domains (GDD §7) — the key for budget sliders, coverage overlays
 * and the sim's service registry. Power/water stay utilities (Phase 2
 * networks), not services. Ids are append-only.
 */
export const ServiceId = {
  fire: 1,
  police: 2,
  health: 3,
  deathcare: 4,
  education: 5,
  parks: 6,
  telecom: 7,
  garbage: 8,
  sewage: 9,
} as const;
export type ServiceId = (typeof ServiceId)[keyof typeof ServiceId];

/** Fixed iteration order (ADR-005 §4 — never Object.keys over wire enums). */
export const SERVICE_ID_LIST: readonly ServiceId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const SERVICE_COUNT = SERVICE_ID_LIST.length;

const SERVICE_IDS: ReadonlySet<number> = new Set(SERVICE_ID_LIST);

/** Budget slider domain, permille of base (GDD §7: 50–150%). */
export const SERVICE_BUDGET_MIN_PERMILLE = 500;
export const SERVICE_BUDGET_MAX_PERMILLE = 1500;

/** Tax rate domain, permille (GDD §8: 1–29%, default 9%). */
export const TAX_MIN_PERMILLE = 10;
export const TAX_MAX_PERMILLE = 290;
export const TAX_DEFAULT_PERMILLE = 90;
/** Loan tiers (GDD §8: 3 tiers; terms are sim policy, task 2). */
export const LOAN_TIERS = 3;

const ROAD_CLASSES: ReadonlySet<number> = new Set([1, 2, 3, 4, 11, 12, 13, 14]);

export interface BuildRoadCommand extends CommandBase {
  readonly type: typeof CommandType.buildRoad;
  /** Segment endpoints, tile coords (u16 each). */
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly roadClass: RoadClassWire;
}

export interface BulldozeRoadCommand extends CommandBase {
  readonly type: typeof CommandType.bulldozeRoad;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

export interface UpgradeRoadCommand extends CommandBase {
  readonly type: typeof CommandType.upgradeRoad;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly roadClass: RoadClassWire;
}

export interface UndoCommand extends CommandBase {
  readonly type: typeof CommandType.undo;
}

export interface RedoCommand extends CommandBase {
  readonly type: typeof CommandType.redo;
}

export interface ZoneRectCommand extends CommandBase {
  readonly type: typeof CommandType.zoneRect;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly zone: ZoneKind;
}

export interface DezoneRectCommand extends CommandBase {
  readonly type: typeof CommandType.dezoneRect;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PlaceBuildingCommand extends CommandBase {
  readonly type: typeof CommandType.placeBuilding;
  readonly x: number;
  readonly y: number;
  readonly building: BuildingKind;
}

/** Persona ref: the building's TILE (stable across saves) + cohort slot. */
export interface PinCimCommand extends CommandBase {
  readonly type: typeof CommandType.pinCim;
  readonly tileIdx: number;
  readonly slot: number;
}

export interface UnpinCimCommand extends CommandBase {
  readonly type: typeof CommandType.unpinCim;
  readonly tileIdx: number;
  readonly slot: number;
}

/** Budget slider for one service (GDD §7): permille of base, 500–1500. */
export interface SetServiceBudgetCommand extends CommandBase {
  readonly type: typeof CommandType.setServiceBudget;
  readonly service: ServiceId;
  readonly permille: number;
}

/** Per-zone tax rate (GDD §8): permille, 10–290. */
export interface SetTaxRateCommand extends CommandBase {
  readonly type: typeof CommandType.setTaxRate;
  readonly zone: ZoneKind;
  readonly permille: number;
}

export interface TakeLoanCommand extends CommandBase {
  readonly type: typeof CommandType.takeLoan;
  /** 1–3 (GDD §8 three tiers). */
  readonly tier: number;
}

export interface RepayLoanCommand extends CommandBase {
  readonly type: typeof CommandType.repayLoan;
  readonly tier: number;
}

/** Districts are identified by a small id painted into the terrain district
 *  layer (0 = none, 1–63 a district). [LOCKED: max 63 districts at 1.0.] */
export const MAX_DISTRICTS = 63;
/** Policy bits per district + ordinance bits city-wide (GDD §11, ~22 levers). */
export const POLICY_BITS = 32;

/**
 * Which policy bit is which lever (GDD §11, task 3). APPEND-ONLY — the bit
 * index is the save/wire contract (setPolicy/setOrdinance carry it, the mask is
 * hashed+saved). A bit read is a pure integer test, so a city that never sets
 * one is byte-identical to before the lever existed (keeps goldens un-blessed).
 * `perDistrict` bits read a district's policyMask; `ordinance` bits read the
 * city-wide ordinanceMask. Bits 4–31 reserved for the remaining levers.
 */
export const Policy = {
  /** perDistrict: caps building level inside the district (low-rise character). */
  highRiseBan: 0,
  /** ordinance: recycling program — less garbage generated city-wide. */
  recycling: 1,
  /** perDistrict: scrubbers/clean-tech — less industrial ground pollution. */
  cleanIndustry: 2,
  /** ordinance: industry subsidy — lifts industrial demand. */
  industrySubsidy: 3,
  /** ordinance: public health / parks — lowers the base urban sickness rate. */
  publicHealth: 4,
  /** perDistrict: congestion charge — tolls driving through the district
   *  (raises car cost ⇒ shifts commuters to transit). Milestone-gated. */
  congestionCharge: 5,
} as const;
export type Policy = (typeof Policy)[keyof typeof Policy];

export interface PaintDistrictCommand extends CommandBase {
  readonly type: typeof CommandType.paintDistrict;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** 0 clears the district; 1–63 paints that district id. */
  readonly districtId: number;
}

export interface NameDistrictCommand extends CommandBase {
  readonly type: typeof CommandType.nameDistrict;
  readonly districtId: number;
  readonly name: string;
}

export interface SetPolicyCommand extends CommandBase {
  readonly type: typeof CommandType.setPolicy;
  readonly districtId: number;
  /** Policy bit index 0–31 (Policy enum). */
  readonly policy: number;
  readonly on: number;
}

export interface SetOrdinanceCommand extends CommandBase {
  readonly type: typeof CommandType.setOrdinance;
  /** Ordinance bit index 0–31 (the city-wide policy subset). */
  readonly ordinance: number;
  readonly on: number;
}

export interface SetDistrictTaxCommand extends CommandBase {
  readonly type: typeof CommandType.setDistrictTax;
  readonly districtId: number;
  /** Zone 1–6 (ZoneKind). */
  readonly zone: number;
  /** Override rate permille (TAX_MIN..TAX_MAX), or 0 to inherit the city rate. */
  readonly permille: number;
}

/** Transit modes (GDD §9 full set). Append-only. */
export const TransitMode = {
  bus: 1,
  tram: 2,
  metro: 3,
  rail: 4,
  freightRail: 5,
  ferry: 6,
  airport: 7,
} as const;
export type TransitMode = (typeof TransitMode)[keyof typeof TransitMode];
export const MAX_LINES = 1024;
/** Per-line stop cap. `stops.length` is a u16 on both the hash and save wire
 *  (stateHash + encodeTransit); this keeps an accepted addStop stream from ever
 *  driving a line un-hashable/un-saveable. Generous vs any real transit line. */
export const MAX_STOPS = 1024;

export interface CreateLineCommand extends CommandBase {
  readonly type: typeof CommandType.createLine;
  readonly lineId: number;
  readonly mode: number;
  /** 0xRRGGBB line colour. */
  readonly color: number;
  readonly name: string;
}

export interface DeleteLineCommand extends CommandBase {
  readonly type: typeof CommandType.deleteLine;
  readonly lineId: number;
}

export interface AddStopCommand extends CommandBase {
  readonly type: typeof CommandType.addStop;
  readonly lineId: number;
  readonly tileIdx: number;
}

export interface RemoveStopCommand extends CommandBase {
  readonly type: typeof CommandType.removeStop;
  readonly lineId: number;
  /** Index into the line's stop list. */
  readonly stopIndex: number;
}

export interface SetLineVehiclesCommand extends CommandBase {
  readonly type: typeof CommandType.setLineVehicles;
  readonly lineId: number;
  readonly vehicles: number;
  readonly headwayTicks: number;
}

export type Command =
  | SelectTileCommand
  | SetSpeedCommand
  | BuildRoadCommand
  | BulldozeRoadCommand
  | UpgradeRoadCommand
  | UndoCommand
  | RedoCommand
  | ZoneRectCommand
  | DezoneRectCommand
  | PlaceBuildingCommand
  | PinCimCommand
  | UnpinCimCommand
  | SetServiceBudgetCommand
  | SetTaxRateCommand
  | TakeLoanCommand
  | RepayLoanCommand
  | PaintDistrictCommand
  | NameDistrictCommand
  | SetPolicyCommand
  | SetOrdinanceCommand
  | CreateLineCommand
  | DeleteLineCommand
  | AddStopCommand
  | RemoveStopCommand
  | SetLineVehiclesCommand
  | SetDistrictTaxCommand;

export const RejectionReason = {
  outOfBounds: 1,
  unknownCommand: 2,
  invalidTarget: 3,
  /** Reserved now, used from Phase 2 economy onward. */
  insufficientFunds: 4,
  /** Bulldoze/upgrade addressed a tile pair with no road between them. */
  noSuchRoad: 5,
  /** Build rejected: degenerate (a==b) or otherwise unbuildable segment. */
  invalidSegment: 6,
  nothingToUndo: 7,
  nothingToRedo: 8,
  /** Command needs a milestone unlock the city hasn't reached (GDD §13). */
  notUnlocked: 9,
} as const;
export type RejectionReason = (typeof RejectionReason)[keyof typeof RejectionReason];

const REJECTION_REASONS: ReadonlySet<number> = new Set(Object.values(RejectionReason));

export interface CommandRejection {
  /** seq of the rejected command. */
  readonly seq: number;
  /** Tick the rejection was decided on. */
  readonly tick: number;
  readonly reason: RejectionReason;
}

export function encodeCommandBody(w: ByteWriter, cmd: Command): void {
  w.u32(cmd.seq).u64(cmd.tick).u16(cmd.type);
  switch (cmd.type) {
    case CommandType.selectTile:
      w.u16(cmd.x).u16(cmd.y);
      break;
    case CommandType.setSpeed:
      w.u8(cmd.speed);
      break;
    case CommandType.buildRoad:
      w.u16(cmd.ax).u16(cmd.ay).u16(cmd.bx).u16(cmd.by).u8(cmd.roadClass);
      break;
    case CommandType.bulldozeRoad:
      w.u16(cmd.ax).u16(cmd.ay).u16(cmd.bx).u16(cmd.by);
      break;
    case CommandType.upgradeRoad:
      w.u16(cmd.ax).u16(cmd.ay).u16(cmd.bx).u16(cmd.by).u8(cmd.roadClass);
      break;
    case CommandType.undo:
    case CommandType.redo:
      break; // no body beyond the base
    case CommandType.zoneRect:
      w.u16(cmd.x0).u16(cmd.y0).u16(cmd.x1).u16(cmd.y1).u8(cmd.zone);
      break;
    case CommandType.dezoneRect:
      w.u16(cmd.x0).u16(cmd.y0).u16(cmd.x1).u16(cmd.y1);
      break;
    case CommandType.placeBuilding:
      w.u16(cmd.x).u16(cmd.y).u8(cmd.building);
      break;
    case CommandType.pinCim:
    case CommandType.unpinCim:
      w.u32(cmd.tileIdx).u8(cmd.slot);
      break;
    case CommandType.setServiceBudget:
      w.u8(cmd.service).u16(cmd.permille);
      break;
    case CommandType.setTaxRate:
      w.u8(cmd.zone).u16(cmd.permille);
      break;
    case CommandType.takeLoan:
    case CommandType.repayLoan:
      w.u8(cmd.tier);
      break;
    case CommandType.paintDistrict:
      w.u16(cmd.x0).u16(cmd.y0).u16(cmd.x1).u16(cmd.y1).u8(cmd.districtId);
      break;
    case CommandType.nameDistrict:
      w.u8(cmd.districtId).str(cmd.name);
      break;
    case CommandType.setPolicy:
      w.u8(cmd.districtId).u8(cmd.policy).u8(cmd.on);
      break;
    case CommandType.setOrdinance:
      w.u8(cmd.ordinance).u8(cmd.on);
      break;
    case CommandType.createLine:
      w.u16(cmd.lineId).u8(cmd.mode).u32(cmd.color).str(cmd.name);
      break;
    case CommandType.deleteLine:
      w.u16(cmd.lineId);
      break;
    case CommandType.addStop:
      w.u16(cmd.lineId).u32(cmd.tileIdx);
      break;
    case CommandType.removeStop:
      w.u16(cmd.lineId).u16(cmd.stopIndex);
      break;
    case CommandType.setLineVehicles:
      w.u16(cmd.lineId).u16(cmd.vehicles).u16(cmd.headwayTicks);
      break;
    case CommandType.setDistrictTax:
      w.u8(cmd.districtId).u8(cmd.zone).u16(cmd.permille);
      break;
  }
}

function decodeRoadClass(r: ByteReader): RoadClassWire {
  const value = r.u8();
  if (!ROAD_CLASSES.has(value)) {
    throw new DecodeError(`unknown RoadClassWire ${value}`);
  }
  return value as RoadClassWire;
}

export function decodeCommandBody(r: ByteReader): Command {
  const seq = r.u32();
  const tick = r.u64();
  const type = r.u16();
  switch (type) {
    case CommandType.selectTile:
      return { seq, tick, type: CommandType.selectTile, x: r.u16(), y: r.u16() };
    case CommandType.setSpeed:
      return { seq, tick, type: CommandType.setSpeed, speed: r.u8() };
    case CommandType.buildRoad:
      return {
        seq,
        tick,
        type: CommandType.buildRoad,
        ax: r.u16(),
        ay: r.u16(),
        bx: r.u16(),
        by: r.u16(),
        roadClass: decodeRoadClass(r),
      };
    case CommandType.bulldozeRoad:
      return {
        seq,
        tick,
        type: CommandType.bulldozeRoad,
        ax: r.u16(),
        ay: r.u16(),
        bx: r.u16(),
        by: r.u16(),
      };
    case CommandType.upgradeRoad:
      return {
        seq,
        tick,
        type: CommandType.upgradeRoad,
        ax: r.u16(),
        ay: r.u16(),
        bx: r.u16(),
        by: r.u16(),
        roadClass: decodeRoadClass(r),
      };
    case CommandType.undo:
      return { seq, tick, type: CommandType.undo };
    case CommandType.redo:
      return { seq, tick, type: CommandType.redo };
    case CommandType.zoneRect: {
      const x0 = r.u16();
      const y0 = r.u16();
      const x1 = r.u16();
      const y1 = r.u16();
      const zone = r.u8();
      if (!ZONE_KINDS.has(zone)) {
        throw new DecodeError(`unknown ZoneKind ${zone}`);
      }
      return { seq, tick, type: CommandType.zoneRect, x0, y0, x1, y1, zone: zone as ZoneKind };
    }
    case CommandType.dezoneRect:
      return {
        seq,
        tick,
        type: CommandType.dezoneRect,
        x0: r.u16(),
        y0: r.u16(),
        x1: r.u16(),
        y1: r.u16(),
      };
    case CommandType.placeBuilding: {
      const x = r.u16();
      const y = r.u16();
      const building = r.u8();
      if (!BUILDING_KINDS.has(building)) {
        throw new DecodeError(`unknown BuildingKind ${building}`);
      }
      return {
        seq,
        tick,
        type: CommandType.placeBuilding,
        x,
        y,
        building: building as BuildingKind,
      };
    }
    case CommandType.pinCim:
      return { seq, tick, type: CommandType.pinCim, tileIdx: r.u32(), slot: r.u8() };
    case CommandType.unpinCim:
      return { seq, tick, type: CommandType.unpinCim, tileIdx: r.u32(), slot: r.u8() };
    case CommandType.setServiceBudget: {
      const service = r.u8();
      const permille = r.u16();
      if (!SERVICE_IDS.has(service)) {
        throw new DecodeError(`unknown ServiceId ${service}`);
      }
      if (permille < SERVICE_BUDGET_MIN_PERMILLE || permille > SERVICE_BUDGET_MAX_PERMILLE) {
        throw new DecodeError(
          `service budget ${permille}‰ outside ` +
            `[${SERVICE_BUDGET_MIN_PERMILLE}, ${SERVICE_BUDGET_MAX_PERMILLE}]`,
        );
      }
      return {
        seq,
        tick,
        type: CommandType.setServiceBudget,
        service: service as ServiceId,
        permille,
      };
    }
    case CommandType.setTaxRate: {
      const zone = r.u8();
      const permille = r.u16();
      if (!ZONE_KINDS.has(zone)) {
        throw new DecodeError(`unknown ZoneKind ${zone}`);
      }
      if (permille < TAX_MIN_PERMILLE || permille > TAX_MAX_PERMILLE) {
        throw new DecodeError(
          `tax rate ${permille}‰ outside [${TAX_MIN_PERMILLE}, ${TAX_MAX_PERMILLE}]`,
        );
      }
      return { seq, tick, type: CommandType.setTaxRate, zone: zone as ZoneKind, permille };
    }
    case CommandType.takeLoan:
    case CommandType.repayLoan: {
      const tier = r.u8();
      if (tier < 1 || tier > LOAN_TIERS) {
        throw new DecodeError(`loan tier ${tier} outside [1, ${LOAN_TIERS}]`);
      }
      return {
        seq,
        tick,
        type: type === CommandType.takeLoan ? CommandType.takeLoan : CommandType.repayLoan,
        tier,
      };
    }
    case CommandType.paintDistrict: {
      const x0 = r.u16();
      const y0 = r.u16();
      const x1 = r.u16();
      const y1 = r.u16();
      const districtId = r.u8();
      if (districtId > MAX_DISTRICTS) {
        throw new DecodeError(`districtId ${districtId} exceeds ${MAX_DISTRICTS}`);
      }
      return { seq, tick, type: CommandType.paintDistrict, x0, y0, x1, y1, districtId };
    }
    case CommandType.nameDistrict: {
      const districtId = r.u8();
      const name = r.str();
      return { seq, tick, type: CommandType.nameDistrict, districtId, name };
    }
    case CommandType.setPolicy: {
      const districtId = r.u8();
      const policy = r.u8();
      const on = r.u8();
      if (policy >= POLICY_BITS) {
        throw new DecodeError(`policy bit ${policy} exceeds ${POLICY_BITS}`);
      }
      return { seq, tick, type: CommandType.setPolicy, districtId, policy, on };
    }
    case CommandType.setOrdinance: {
      const ordinance = r.u8();
      const on = r.u8();
      if (ordinance >= POLICY_BITS) {
        throw new DecodeError(`ordinance bit ${ordinance} exceeds ${POLICY_BITS}`);
      }
      return { seq, tick, type: CommandType.setOrdinance, ordinance, on };
    }
    case CommandType.createLine: {
      const lineId = r.u16();
      const mode = r.u8();
      const color = r.u32();
      const name = r.str();
      if (mode < TransitMode.bus || mode > TransitMode.airport) {
        throw new DecodeError(`unknown TransitMode ${mode}`);
      }
      return { seq, tick, type: CommandType.createLine, lineId, mode, color, name };
    }
    case CommandType.deleteLine:
      return { seq, tick, type: CommandType.deleteLine, lineId: r.u16() };
    case CommandType.addStop:
      return { seq, tick, type: CommandType.addStop, lineId: r.u16(), tileIdx: r.u32() };
    case CommandType.removeStop:
      return { seq, tick, type: CommandType.removeStop, lineId: r.u16(), stopIndex: r.u16() };
    case CommandType.setLineVehicles:
      return {
        seq,
        tick,
        type: CommandType.setLineVehicles,
        lineId: r.u16(),
        vehicles: r.u16(),
        headwayTicks: r.u16(),
      };
    case CommandType.setDistrictTax: {
      const districtId = r.u8();
      const zone = r.u8();
      const permille = r.u16();
      if (districtId < 1 || districtId > MAX_DISTRICTS) {
        throw new DecodeError(`districtId ${districtId} exceeds ${MAX_DISTRICTS}`);
      }
      if (zone < 1 || zone > 6) {
        throw new DecodeError(`tax zone ${zone} out of range`);
      }
      if (permille !== 0 && (permille < TAX_MIN_PERMILLE || permille > TAX_MAX_PERMILLE)) {
        throw new DecodeError(
          `tax override ${permille} out of [${TAX_MIN_PERMILLE},${TAX_MAX_PERMILLE}]`,
        );
      }
      return { seq, tick, type: CommandType.setDistrictTax, districtId, zone, permille };
    }
    default:
      throw new DecodeError(`unknown CommandType ${type}`);
  }
}

export function encodeRejectionBody(w: ByteWriter, rejection: CommandRejection): void {
  w.u32(rejection.seq).u64(rejection.tick).u16(rejection.reason);
}

export function decodeRejectionBody(r: ByteReader): CommandRejection {
  const seq = r.u32();
  const tick = r.u64();
  const reason = r.u16();
  if (!REJECTION_REASONS.has(reason)) {
    throw new DecodeError(`unknown RejectionReason ${reason}`);
  }
  return { seq, tick, reason: reason as RejectionReason };
}
