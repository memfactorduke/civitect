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
      roadVersion: 0,
      roads: [], // keyframes state the no-roads truth explicitly
      demand: { r: 0, c: 0, i: 0, o: 0, factors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      buildingVersion: 0,
      buildings: [],
      zoneVersion: 0,
      zones: new Uint16Array(64 * 64),
      agentCount: 0,
      congestionVersion: 3_421_674_724, // empty cost field's content digest
      congestion: new Uint16Array(0),
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

describe("road segments in snapshots (phase-1 task 12b)", () => {
  it("keyframes carry the canonical segment list; idle deltas say unchanged", () => {
    const world = createWorld(42);
    runTick(world, [
      { seq: 0, tick: 0, type: CommandType.buildRoad, ax: 1, ay: 1, bx: 4, by: 1, roadClass: 2 },
    ]);
    const keyframe = toSnapshot(world, SnapshotKind.keyframe);
    expect(keyframe.roads).toEqual([{ ax: 1, ay: 1, bx: 4, by: 1, roadClass: 2 }]);
    expect(keyframe.roadVersion).toBe(world.roads.version);

    const idleDelta = toSnapshot(world, SnapshotKind.delta);
    expect(idleDelta.roads).toBeNull();
    expect(idleDelta.roadVersion).toBe(world.roads.version);

    const forced = toSnapshot(world, SnapshotKind.delta, true);
    expect(forced.roads).toHaveLength(1);
  });
});
