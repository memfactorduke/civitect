import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ByteReader } from "./bytes/reader";
import { ByteWriter } from "./bytes/writer";
import { DecodeError } from "./errors";
import { decodeSnapshotBody, encodeSnapshotBody } from "./snapshot";
import { snapshotArb } from "./testing/arbitraries";

describe("snapshot codec", () => {
  it("encode∘decode is identity (property)", () => {
    fc.assert(
      fc.property(snapshotArb, (snap) => {
        const w = new ByteWriter();
        encodeSnapshotBody(w, snap);
        const r = new ByteReader(w.finish());
        expect(decodeSnapshotBody(r)).toEqual(snap);
        r.expectEnd();
      }),
    );
  });

  it("rejects unknown snapshot kinds and malformed presence flags", () => {
    const badKind = new ByteWriter().u8(9).u64(0).u8(0).finish();
    expect(() => decodeSnapshotBody(new ByteReader(badKind))).toThrow(DecodeError);

    const badFlag = new ByteWriter().u8(1).u64(0).u8(0).u8(2).finish();
    expect(() => decodeSnapshotBody(new ByteReader(badFlag))).toThrow(DecodeError);
  });
});
