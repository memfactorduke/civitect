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

/** Road classes on the wire (sim consumes these values — protocol is the contract). */
export const RoadClassWire = {
  street: 1,
  avenue: 2,
  highway: 3,
} as const;
export type RoadClassWire = (typeof RoadClassWire)[keyof typeof RoadClassWire];

const ROAD_CLASSES: ReadonlySet<number> = new Set([1, 2, 3]);

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

export type Command =
  | SelectTileCommand
  | SetSpeedCommand
  | BuildRoadCommand
  | BulldozeRoadCommand
  | UpgradeRoadCommand
  | UndoCommand
  | RedoCommand;

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
