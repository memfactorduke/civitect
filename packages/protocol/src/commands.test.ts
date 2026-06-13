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

describe("setServiceBudget decode validation (v11, GDD §7 domain)", () => {
  const body = (service: number, permille: number) =>
    new ByteWriter().u32(1).u64(0).u16(13).u8(service).u16(permille).finish();

  it("accepts the domain corners", () => {
    for (const [service, permille] of [
      [1, 500],
      [9, 1500],
    ] as const) {
      const cmd = decodeCommandBody(new ByteReader(body(service, permille)));
      expect(cmd).toMatchObject({ type: 13, service, permille });
    }
  });

  it("rejects unknown service ids", () => {
    expect(() => decodeCommandBody(new ByteReader(body(0, 1000)))).toThrow(DecodeError);
    expect(() => decodeCommandBody(new ByteReader(body(10, 1000)))).toThrow(DecodeError);
  });

  it("rejects budgets outside 50–150% (the slider's wire contract)", () => {
    expect(() => decodeCommandBody(new ByteReader(body(1, 499)))).toThrow(DecodeError);
    expect(() => decodeCommandBody(new ByteReader(body(1, 1501)))).toThrow(DecodeError);
  });
});

describe("economy command decode validation (v12, GDD §8 domains)", () => {
  it("setTaxRate accepts the corners and rejects outside 1–29%", () => {
    const body = (zone: number, permille: number) =>
      new ByteWriter().u32(1).u64(0).u16(14).u8(zone).u16(permille).finish();
    expect(decodeCommandBody(new ByteReader(body(1, 10)))).toMatchObject({ zone: 1, permille: 10 });
    expect(decodeCommandBody(new ByteReader(body(6, 290)))).toMatchObject({
      zone: 6,
      permille: 290,
    });
    expect(() => decodeCommandBody(new ByteReader(body(0, 90)))).toThrow(DecodeError);
    expect(() => decodeCommandBody(new ByteReader(body(7, 90)))).toThrow(DecodeError);
    expect(() => decodeCommandBody(new ByteReader(body(1, 9)))).toThrow(DecodeError);
    expect(() => decodeCommandBody(new ByteReader(body(1, 291)))).toThrow(DecodeError);
  });

  it("loan commands reject tiers outside 1–3", () => {
    const body = (type: number, tier: number) =>
      new ByteWriter().u32(1).u64(0).u16(type).u8(tier).finish();
    expect(decodeCommandBody(new ByteReader(body(15, 1)))).toMatchObject({ tier: 1 });
    expect(decodeCommandBody(new ByteReader(body(16, 3)))).toMatchObject({ tier: 3 });
    expect(() => decodeCommandBody(new ByteReader(body(15, 0)))).toThrow(DecodeError);
    expect(() => decodeCommandBody(new ByteReader(body(16, 4)))).toThrow(DecodeError);
  });
});
