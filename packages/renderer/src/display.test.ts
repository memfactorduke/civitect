import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { applySnapshot, initialDisplayState } from "./display";

function snapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    kind: SnapshotKind.delta,
    tick: 0,
    speed: 1,
    selectedTile: null,
    dirtyChunkIds: new Uint32Array(0),
    hud: { population: 0, fundsCents: 0 },
    advisorEvents: [],
    roadVersion: 0,
    roads: null,
    ...partial,
  };
}

describe("snapshot → display-state (board PR 5 verification)", () => {
  it("initial state has no highlight and tick -1 (pre-first-snapshot)", () => {
    const s = initialDisplayState();
    expect(s.highlight).toBeNull();
    expect(s.tick).toBe(-1);
  });

  it("selected tile becomes the highlight", () => {
    const s = applySnapshot(
      initialDisplayState(),
      snapshot({ tick: 7, selectedTile: { x: 3, y: 9 } }),
    );
    expect(s.highlight).toEqual({ x: 3, y: 9 });
    expect(s.tick).toBe(7);
  });

  it("null selection clears the highlight", () => {
    const selected = applySnapshot(
      initialDisplayState(),
      snapshot({ tick: 1, selectedTile: { x: 1, y: 1 } }),
    );
    const cleared = applySnapshot(selected, snapshot({ tick: 2, selectedTile: null }));
    expect(cleared.highlight).toBeNull();
  });

  it("HUD scalars project through untouched (sim formats nothing for display)", () => {
    const s = applySnapshot(
      initialDisplayState(),
      snapshot({ tick: 3, hud: { population: 1234, fundsCents: 5_000_00 } }),
    );
    expect(s.hud).toEqual({ population: 1234, fundsCents: 5_000_00 });
  });

  it("stale DELTAS (older tick) are ignored — last-tick-wins", () => {
    const fresh = applySnapshot(
      initialDisplayState(),
      snapshot({ tick: 10, selectedTile: { x: 5, y: 5 } }),
    );
    const afterStale = applySnapshot(fresh, snapshot({ tick: 4, selectedTile: null }));
    expect(afterStale).toBe(fresh);
  });

  it("KEYFRAMES rewind to older ticks (save-load / scene jump, TDD §7)", () => {
    const fresh = applySnapshot(initialDisplayState(), snapshot({ tick: 100, selectedTile: null }));
    const rewound = applySnapshot(
      fresh,
      snapshot({ kind: SnapshotKind.keyframe, tick: 7, selectedTile: { x: 1, y: 2 } }),
    );
    expect(rewound.tick).toBe(7);
    expect(rewound.highlight).toEqual({ x: 1, y: 2 });
  });

  it("same-tick snapshots re-apply (keyframe after scene jump)", () => {
    const a = applySnapshot(initialDisplayState(), snapshot({ tick: 5, selectedTile: null }));
    const b = applySnapshot(
      a,
      snapshot({ kind: SnapshotKind.keyframe, tick: 5, selectedTile: { x: 2, y: 2 } }),
    );
    expect(b.highlight).toEqual({ x: 2, y: 2 });
  });
});
