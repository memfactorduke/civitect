import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ByteWriter } from "./bytes/writer";
import { CommandType, RejectionReason } from "./commands";
import { decodeMessage, encodeMessage, MessageKind } from "./envelope";
import { DecodeError, ProtocolVersionMismatchError } from "./errors";
import { SnapshotKind } from "./snapshot";
import { messageArb } from "./testing/arbitraries";
import { PROTOCOL_VERSION } from "./version";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("message envelope", () => {
  it("encode∘decode is identity for every message kind (property)", () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        expect(decodeMessage(encodeMessage(message))).toEqual(message);
      }),
    );
  });

  it("hard-errors on protocol version mismatch before reading any body byte", () => {
    const bytes = encodeMessage({
      kind: MessageKind.command,
      body: { seq: 1, tick: 0, type: CommandType.setSpeed, speed: 1 },
    });
    bytes[0] = PROTOCOL_VERSION + 1;
    bytes[1] = 0;
    let caught: unknown;
    try {
      decodeMessage(bytes);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProtocolVersionMismatchError);
    const mismatch = caught as ProtocolVersionMismatchError;
    expect(mismatch.expected).toBe(PROTOCOL_VERSION);
    expect(mismatch.actual).toBe(PROTOCOL_VERSION + 1);
  });

  it("rejects unknown message kinds", () => {
    const bytes = encodeMessage({
      kind: MessageKind.commandRejection,
      body: { seq: 1, tick: 0, reason: RejectionReason.outOfBounds },
    });
    bytes[2] = 99;
    expect(() => decodeMessage(bytes)).toThrow(DecodeError);
  });

  it("rejects body-length disagreements and trailing bytes", () => {
    const good = encodeMessage({
      kind: MessageKind.commandRejection,
      body: { seq: 1, tick: 0, reason: RejectionReason.outOfBounds },
    });

    const lied = Uint8Array.from(good);
    lied[3] = (lied[3] ?? 0) + 1; // claim one more body byte than exists
    expect(() => decodeMessage(lied)).toThrow(DecodeError);

    // Consistent length but more bytes than the codec consumes → expectEnd fires.
    const padded = new ByteWriter();
    padded.u16(PROTOCOL_VERSION).u8(MessageKind.commandRejection).u32(15);
    padded.u32(1).u64(0).u16(RejectionReason.outOfBounds).u8(0xaa);
    expect(() => decodeMessage(padded.finish())).toThrow(/trailing/);
  });

  it("rejects empty and truncated envelopes", () => {
    expect(() => decodeMessage(new Uint8Array(0))).toThrow(DecodeError);
    // Correct version stamp (little-endian u16), then truncation mid-header.
    expect(() => decodeMessage(Uint8Array.of(PROTOCOL_VERSION, 0, 1))).toThrow(DecodeError);
  });

  // ── Wire-layout pins ────────────────────────────────────────────────────
  // If one of these fails, the wire layout changed: bump PROTOCOL_VERSION,
  // update the vector, and say so in the PR (CLAUDE.md hard rule). These are
  // the tripwire; the property tests above can't see layout drift because
  // both sides drift together.

  it("pins the selectTile command wire layout (v5 stamp; body unchanged since v1)", () => {
    const bytes = encodeMessage({
      kind: MessageKind.command,
      body: { seq: 1, tick: 2, type: CommandType.selectTile, x: 3, y: 4 },
    });
    expect(toHex(bytes)).toBe(
      ["0500", "01", "12000000", "01000000", "0200000000000000", "0100", "0300", "0400"].join(""),
    );
  });

  it("pins the saveResponse wire layout (v5 stamp; body unchanged since v2)", () => {
    const bytes = encodeMessage({
      kind: MessageKind.saveResponse,
      body: { slot: 2, civ: Uint8Array.of(0xca, 0xfe) },
    });
    expect(toHex(bytes)).toBe(
      [
        "0500", // protocol version
        "07", // MessageKind.saveResponse
        "07000000", // body length 7
        "02", // slot
        "02000000", // civ byte length
        "cafe", // civ bytes
      ].join(""),
    );
  });

  it("pins the loadResponse wire layout (v5 stamp; body unchanged since v2)", () => {
    const bytes = encodeMessage({
      kind: MessageKind.loadResponse,
      body: { ok: false, tick: 7, detail: "bad" },
    });
    expect(toHex(bytes)).toBe(
      [
        "0500", // protocol version
        "09", // MessageKind.loadResponse
        "0e000000", // body length 14
        "00", // ok = false
        "0700000000000000", // tick
        "0300", // detail byte length
        "626164", // "bad"
      ].join(""),
    );
  });

  it("pins the buildRoad command wire layout (v5 stamp; body unchanged since v3)", () => {
    const bytes = encodeMessage({
      kind: MessageKind.command,
      body: {
        seq: 1,
        tick: 2,
        type: CommandType.buildRoad,
        ax: 3,
        ay: 4,
        bx: 5,
        by: 6,
        roadClass: 2,
      },
    });
    expect(toHex(bytes)).toBe(
      [
        "0500", // protocol version
        "01", // MessageKind.command
        "17000000", // body length 23
        "01000000", // seq
        "0200000000000000", // tick
        "0300", // CommandType.buildRoad
        "0300", // ax
        "0400", // ay
        "0500", // bx
        "0600", // by
        "02", // RoadClassWire.avenue
      ].join(""),
    );
  });

  it("pins the empty-world snapshot wire layout (v5 stamp; body unchanged since v4)", () => {
    const bytes = encodeMessage({
      kind: MessageKind.snapshot,
      body: {
        kind: SnapshotKind.keyframe,
        tick: 0,
        speed: 1,
        selectedTile: null,
        dirtyChunkIds: new Uint32Array(0),
        hud: { population: 0, fundsCents: 0 },
        advisorEvents: [],
        roadVersion: 0,
        roads: [{ ax: 1, ay: 2, bx: 3, by: 2, roadClass: 1 }],
      },
    });
    expect(toHex(bytes)).toBe(
      [
        "0500", // protocol version
        "03", // MessageKind.snapshot
        "2f000000", // body length 47
        "01", // SnapshotKind.keyframe
        "0000000000000000", // tick
        "01", // speed
        "00", // no selection
        "00000000", // 0 dirty chunks
        "00000000", // population
        "0000000000000000", // fundsCents
        "0000", // 0 advisor events
        "00000000", // roadVersion
        "01", // roads present
        "01000000", // 1 segment
        "0100", // ax
        "0200", // ay
        "0300", // bx
        "0200", // by
        "01", // roadClass street
      ].join(""),
    );
  });
});
