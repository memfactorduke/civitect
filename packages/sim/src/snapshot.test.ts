import {
  ByteReader,
  ByteWriter,
  CommandType,
  decodeSnapshotBody,
  encodeSnapshotBody,
  SnapshotKind,
} from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { toSnapshot } from "./snapshot";
import { createWorld, runTick } from "./world";

describe("toSnapshot", () => {
  it("projects an untouched world: no selection, zeroed HUD, no events", () => {
    const world = createWorld(42);
    const snap = toSnapshot(world, SnapshotKind.keyframe);
    expect(snap).toEqual({
      kind: SnapshotKind.keyframe,
      tick: 0,
      speed: 1,
      selectedTile: null,
      dirtyChunkIds: new Uint32Array(0),
      hud: { population: 0, fundsCents: 0 },
      advisorEvents: [],
    });
  });

  it("round-trips the selection through command → world → snapshot coordinates", () => {
    const world = createWorld(42);
    runTick(world, [{ seq: 0, tick: 0, type: CommandType.selectTile, x: 13, y: 37 }]);
    expect(toSnapshot(world).selectedTile).toEqual({ x: 13, y: 37 });
  });

  it("produces snapshots the protocol codec round-trips exactly (the wire works end to end)", () => {
    const world = createWorld(7);
    runTick(world, [{ seq: 0, tick: 0, type: CommandType.selectTile, x: 5, y: 6 }]);
    const snap = toSnapshot(world, SnapshotKind.delta);
    const w = new ByteWriter();
    encodeSnapshotBody(w, snap);
    expect(decodeSnapshotBody(new ByteReader(w.finish()))).toEqual(snap);
  });
});
