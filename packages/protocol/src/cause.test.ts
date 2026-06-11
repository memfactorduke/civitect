import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ByteReader } from "./bytes/reader";
import { ByteWriter } from "./bytes/writer";
import {
  type AdvisorEvent,
  AdvisorSeverity,
  decodeAdvisorEvent,
  decodeCauseChain,
  decodeEntityRef,
  EntityKind,
  encodeAdvisorEvent,
  encodeCauseChain,
} from "./cause";
import { DecodeError, EncodeError } from "./errors";
import { advisorEventArb, causeChainArb } from "./testing/arbitraries";

describe("cause chains", () => {
  it("encode∘decode is identity for advisor events (property)", () => {
    fc.assert(
      fc.property(advisorEventArb, (event) => {
        const w = new ByteWriter();
        encodeAdvisorEvent(w, event);
        const r = new ByteReader(w.finish());
        expect(decodeAdvisorEvent(r)).toEqual(event);
        r.expectEnd();
      }),
    );
  });

  it("encode∘decode is identity for bare chains (property)", () => {
    fc.assert(
      fc.property(causeChainArb, (chain) => {
        const w = new ByteWriter();
        encodeCauseChain(w, chain);
        const r = new ByteReader(w.finish());
        expect(decodeCauseChain(r)).toEqual(chain);
        r.expectEnd();
      }),
    );
  });

  it("advisor events without a cause chain do not typecheck (ADR-009)", () => {
    // @ts-expect-error — `cause` is required; pillar-2 enforcement is structural.
    const event: AdvisorEvent = {
      id: 1,
      tick: 0,
      severity: AdvisorSeverity.warning,
      messageKey: "advisor.test",
    };
    expect(event).toBeDefined(); // the assertion above is the test; this silences "unused"
  });

  it("rejects weights past 1000 permille on both sides", () => {
    const link = {
      subject: { kind: EntityKind.tile, id: 0 },
      labelKey: "cause.test",
      weightPermille: 1001,
    };
    const w = new ByteWriter();
    expect(() => encodeCauseChain(w, { summaryKey: "s", links: [link] })).toThrow(EncodeError);

    const crafted = new ByteWriter();
    crafted.str("s").u16(1).u8(EntityKind.tile).u32(0).str("cause.test").u16(1001);
    expect(() => decodeCauseChain(new ByteReader(crafted.finish()))).toThrow(DecodeError);
  });

  it("rejects unknown entity kinds and severities", () => {
    const badRef = new ByteWriter().u8(99).u32(0).finish();
    expect(() => decodeEntityRef(new ByteReader(badRef))).toThrow(DecodeError);

    const badSeverity = new ByteWriter().u32(1).u64(0).u8(99).str("k").finish();
    expect(() => decodeAdvisorEvent(new ByteReader(badSeverity))).toThrow(DecodeError);
  });
});
