import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DecodeError, EncodeError } from "../errors";
import { ByteReader } from "./reader";
import { utf8Decode, utf8Encode } from "./utf8";
import { ByteWriter } from "./writer";

describe("ByteWriter / ByteReader", () => {
  it("round-trips every primitive (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xff }),
        fc.integer({ min: 0, max: 0xffff }),
        fc
          .tuple(fc.integer({ min: 0, max: 0xffff }), fc.integer({ min: 0, max: 0xffff }))
          .map(([hi, lo]) => hi * 0x10000 + lo),
        fc.maxSafeNat(),
        fc.maxSafeInteger(),
        fc.fullUnicodeString({ maxLength: 64 }),
        (a, b, c, d, e, s) => {
          const w = new ByteWriter();
          w.u8(a).u16(b).u32(c).u64(d).i64(e).str(s);
          const r = new ByteReader(w.finish());
          expect(r.u8()).toBe(a);
          expect(r.u16()).toBe(b);
          expect(r.u32()).toBe(c);
          expect(r.u64()).toBe(d);
          expect(r.i64()).toBe(e);
          expect(r.str()).toBe(s);
          r.expectEnd();
        },
      ),
    );
  });

  it("round-trips i64 boundary values exactly", () => {
    for (const v of [0, -1, 1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, -4294967296]) {
      const r = new ByteReader(new ByteWriter().i64(v).finish());
      expect(r.i64()).toBe(v);
    }
  });

  it("emits little-endian bytes (layout pin)", () => {
    const bytes = new ByteWriter().u16(0x0102).u32(0x03040506).finish();
    expect(Array.from(bytes)).toEqual([0x02, 0x01, 0x06, 0x05, 0x04, 0x03]);
  });

  it("rejects out-of-range writes loudly instead of wrapping", () => {
    const w = new ByteWriter();
    expect(() => w.u8(256)).toThrow(EncodeError);
    expect(() => w.u8(-1)).toThrow(EncodeError);
    expect(() => w.u8(1.5)).toThrow(EncodeError);
    expect(() => w.u16(0x10000)).toThrow(EncodeError);
    expect(() => w.u32(2 ** 32)).toThrow(EncodeError);
    expect(() => w.u64(-1)).toThrow(EncodeError);
    expect(() => w.u64(Number.MAX_SAFE_INTEGER + 2)).toThrow(EncodeError);
    expect(() => w.i64(0.5)).toThrow(EncodeError);
    expect(() => w.str("a".repeat(0x10000))).toThrow(EncodeError);
    expect(() => w.patchU32(0, 1)).toThrow(EncodeError); // nothing written yet
  });

  it("rejects truncated reads with DecodeError", () => {
    const r = new ByteReader(Uint8Array.of(1, 2));
    expect(() => r.u32()).toThrow(DecodeError);
    const short = new ByteReader(new ByteWriter().u16(10).finish()); // str length 10, no bytes
    expect(() => short.str()).toThrow(DecodeError);
  });

  it("rejects u64 values beyond the safe-integer range", () => {
    const allOnes = new Uint8Array(8).fill(0xff);
    expect(() => new ByteReader(allOnes).u64()).toThrow(DecodeError);
    expect(new ByteReader(allOnes).i64()).toBe(-1); // same bytes, signed: fine
  });

  it("grows past its initial capacity transparently", () => {
    const w = new ByteWriter(8);
    for (let i = 0; i < 1000; i++) {
      w.u32(i);
    }
    const r = new ByteReader(w.finish());
    for (let i = 0; i < 1000; i++) {
      expect(r.u32()).toBe(i);
    }
    r.expectEnd();
  });

  it("respects Uint8Array views with a non-zero byteOffset", () => {
    const backing = new Uint8Array(16);
    const payload = new ByteWriter().u32(0xdeadbeef).finish();
    backing.set(payload, 5);
    const view = backing.subarray(5, 5 + 4);
    expect(new ByteReader(view).u32()).toBe(0xdeadbeef);
  });
});

describe("utf8", () => {
  it("round-trips all well-formed Unicode (property)", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 128 }), (s) => {
        expect(utf8Decode(utf8Encode(s))).toBe(s);
      }),
    );
  });

  it("replaces lone surrogates with U+FFFD, matching TextEncoder", () => {
    expect(utf8Decode(utf8Encode("a\ud800b"))).toBe("a�b");
    expect(Array.from(utf8Encode("\udfff"))).toEqual(Array.from(utf8Encode("�")));
  });

  it("rejects malformed byte sequences strictly", () => {
    expect(() => utf8Decode(Uint8Array.of(0xc0, 0x80))).toThrow(DecodeError); // overlong
    expect(() => utf8Decode(Uint8Array.of(0xe0, 0x80, 0x80))).toThrow(DecodeError); // overlong
    expect(() => utf8Decode(Uint8Array.of(0xed, 0xa0, 0x80))).toThrow(DecodeError); // surrogate
    expect(() => utf8Decode(Uint8Array.of(0xf4, 0x90, 0x80, 0x80))).toThrow(DecodeError); // >U+10FFFF
    expect(() => utf8Decode(Uint8Array.of(0xff))).toThrow(DecodeError); // bad lead
    expect(() => utf8Decode(Uint8Array.of(0xe2, 0x82))).toThrow(DecodeError); // truncated
    expect(() => utf8Decode(Uint8Array.of(0x61, 0x80))).toThrow(DecodeError); // orphan continuation
  });
});
