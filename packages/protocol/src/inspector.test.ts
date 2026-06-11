import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ByteReader } from "./bytes/reader";
import { ByteWriter } from "./bytes/writer";
import { DecodeError } from "./errors";
import {
  decodeInspectorRequestBody,
  decodeInspectorResponseBody,
  encodeInspectorRequestBody,
  encodeInspectorResponseBody,
} from "./inspector";
import { inspectorRequestArb, inspectorResponseArb } from "./testing/arbitraries";

describe("inspector codec", () => {
  it("encode∘decode is identity for requests (property)", () => {
    fc.assert(
      fc.property(inspectorRequestArb, (req) => {
        const w = new ByteWriter();
        encodeInspectorRequestBody(w, req);
        const r = new ByteReader(w.finish());
        expect(decodeInspectorRequestBody(r)).toEqual(req);
        r.expectEnd();
      }),
    );
  });

  it("encode∘decode is identity for responses, found and not-found (property)", () => {
    fc.assert(
      fc.property(inspectorResponseArb, (res) => {
        const w = new ByteWriter();
        encodeInspectorResponseBody(w, res);
        const r = new ByteReader(w.finish());
        expect(decodeInspectorResponseBody(r)).toEqual(res);
        r.expectEnd();
      }),
    );
  });

  it("rejects unknown entity kinds in requests", () => {
    const bad = new ByteWriter().u32(1).u8(42).u32(0).finish();
    expect(() => decodeInspectorRequestBody(new ByteReader(bad))).toThrow(DecodeError);
  });
});
