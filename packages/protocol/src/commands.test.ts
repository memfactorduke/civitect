import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ByteReader } from "./bytes/reader";
import { ByteWriter } from "./bytes/writer";
import {
  decodeCommandBody,
  decodeRejectionBody,
  encodeCommandBody,
  encodeRejectionBody,
} from "./commands";
import { DecodeError } from "./errors";
import { commandArb, rejectionArb } from "./testing/arbitraries";

describe("command codec", () => {
  it("encode∘decode is identity for commands (property)", () => {
    fc.assert(
      fc.property(commandArb, (cmd) => {
        const w = new ByteWriter();
        encodeCommandBody(w, cmd);
        const r = new ByteReader(w.finish());
        expect(decodeCommandBody(r)).toEqual(cmd);
        r.expectEnd();
      }),
    );
  });

  it("encode∘decode is identity for rejections (property)", () => {
    fc.assert(
      fc.property(rejectionArb, (rejection) => {
        const w = new ByteWriter();
        encodeRejectionBody(w, rejection);
        const r = new ByteReader(w.finish());
        expect(decodeRejectionBody(r)).toEqual(rejection);
        r.expectEnd();
      }),
    );
  });

  it("rejects unknown command types and rejection reasons", () => {
    const badCommand = new ByteWriter().u32(1).u64(0).u16(999).finish();
    expect(() => decodeCommandBody(new ByteReader(badCommand))).toThrow(DecodeError);

    const badRejection = new ByteWriter().u32(1).u64(0).u16(999).finish();
    expect(() => decodeRejectionBody(new ByteReader(badRejection))).toThrow(DecodeError);
  });
});
