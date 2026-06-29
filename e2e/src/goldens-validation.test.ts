import { describe, expect, it } from "vitest";
import { parseExpectations } from "./goldens";

const validExpectation = {
  "growth-city-01": {
    hash: "290cdb0efa95c5f9",
    hud: {
      tick: 131_400,
      population: 5_063,
      fundsCents: 36_686_364,
    },
  },
};

describe("parseExpectations", () => {
  it("accepts the committed golden expectation shape", () => {
    expect(parseExpectations(validExpectation, "hashes.json")).toEqual(validExpectation);
  });

  it.each([
    ["non-object document", [], "golden expectations must be a JSON object"],
    ["empty document", {}, "golden expectations must not be empty"],
    [
      "invalid golden name",
      { "Growth City": validExpectation["growth-city-01"] },
      'invalid golden name "Growth City"',
    ],
    [
      "malformed expectation",
      { "growth-city-01": "290cdb0efa95c5f9" },
      'hashes.json "growth-city-01": expectation must be an object',
    ],
    [
      "unknown expectation field",
      { "growth-city-01": { ...validExpectation["growth-city-01"], note: "manual edit" } },
      'hashes.json "growth-city-01": unknown field "note"',
    ],
    [
      "bad hash",
      { "growth-city-01": { ...validExpectation["growth-city-01"], hash: "not-a-hash" } },
      'hashes.json "growth-city-01": hash must be 16 lowercase hex characters',
    ],
    [
      "missing hud",
      { "growth-city-01": { hash: "290cdb0efa95c5f9" } },
      'hashes.json "growth-city-01".hud: hud must be an object',
    ],
    [
      "bad tick",
      {
        "growth-city-01": {
          ...validExpectation["growth-city-01"],
          hud: { ...validExpectation["growth-city-01"].hud, tick: -1 },
        },
      },
      'hashes.json "growth-city-01".hud: tick must be a non-negative safe integer',
    ],
    [
      "bad population",
      {
        "growth-city-01": {
          ...validExpectation["growth-city-01"],
          hud: { ...validExpectation["growth-city-01"].hud, population: 1.5 },
        },
      },
      'hashes.json "growth-city-01".hud: population must be a non-negative safe integer',
    ],
    [
      "bad funds",
      {
        "growth-city-01": {
          ...validExpectation["growth-city-01"],
          hud: { ...validExpectation["growth-city-01"].hud, fundsCents: Number.NaN },
        },
      },
      'hashes.json "growth-city-01".hud: fundsCents must be a safe integer',
    ],
    [
      "unknown hud field",
      {
        "growth-city-01": {
          ...validExpectation["growth-city-01"],
          hud: { ...validExpectation["growth-city-01"].hud, demand: 10 },
        },
      },
      'hashes.json "growth-city-01".hud: unknown field "demand"',
    ],
  ])("rejects %s", (_caseName, raw, message) => {
    expect(() => parseExpectations(raw, "hashes.json")).toThrow(message);
  });
});
