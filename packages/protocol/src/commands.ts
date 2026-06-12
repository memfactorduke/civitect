/**
 * Commands, UI → sim (TDD §7): tick-stamped, sequence-numbered binary structs.
 * Sim is authoritative — invalid commands come back as CommandRejection with a
 * reason code; the UI's optimistic ghosts are cosmetic until confirmed.
 *
 * v1 carries only what the Phase 0 empty-world round trip needs (selectTile
 * drives the tap→highlight exit criterion; setSpeed drives the tick loop).
 * Build/zone/budget commands arrive with their systems — each addition bumps
 * PROTOCOL_VERSION. Wire ids are append-only.
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { DecodeError } from "./errors";

export const CommandType = {
  selectTile: 1,
  setSpeed: 2,
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

export type Command = SelectTileCommand | SetSpeedCommand;

export const RejectionReason = {
  outOfBounds: 1,
  unknownCommand: 2,
  invalidTarget: 3,
  /** Reserved now, used from Phase 2 economy onward. */
  insufficientFunds: 4,
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
  }
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
