import { describe, expect, it } from "vitest";
import { parseSpriteSidecar, SpriteCategory, SpriteState } from "./sprite";

const GOOD = {
  id: "r-low-house-01",
  category: "residential",
  footprint: { w: 1, d: 1 },
  canvas: { w: 192, h: 240 },
  anchor: { x: 96, y: 216 },
  states: {
    normal: "r-low-house-01.png",
    construction: "r-low-house-01.construction.png",
    abandoned: "r-low-house-01.abandoned.png",
    "emissive-mask": "r-low-house-01.emissive.png",
  },
};

describe("sprite sidecar schema (TDD §11, ADR-012)", () => {
  it("parses a complete sidecar", () => {
    const sidecar = parseSpriteSidecar(GOOD, "good.json");
    expect(sidecar.category).toBe(SpriteCategory.residential);
    expect(sidecar.footprint).toEqual({ w: 1, d: 1 });
    expect(sidecar.states[SpriteState.emissiveMask]).toBe("r-low-house-01.emissive.png");
  });

  it.each([
    ["id not kebab-case", { ...GOOD, id: "R Low House" }, /kebab-case/],
    ["unknown category", { ...GOOD, category: "spaceports" }, /unknown category/],
    ["footprint zero", { ...GOOD, footprint: { w: 0, d: 1 } }, /footprint/],
    ["footprint over 8×8", { ...GOOD, footprint: { w: 9, d: 1 } }, /footprint/],
    ["footprint fractional", { ...GOOD, footprint: { w: 1.5, d: 1 } }, /footprint/],
    ["canvas missing", { ...GOOD, canvas: undefined }, /canvas/],
    ["anchor negative", { ...GOOD, anchor: { x: -3, y: 10 } }, /anchor/],
    ["anchor outside canvas", { ...GOOD, anchor: { x: 500, y: 10 } }, /outside the 192×240 canvas/],
    [
      "unknown state name",
      { ...GOOD, states: { ...GOOD.states, glowing: "x.png" } },
      /unknown state/,
    ],
    ["state not a png", { ...GOOD, states: { normal: "house.webp" } }, /must name a \.png/],
    ["missing normal state", { ...GOOD, states: { construction: "c.png" } }, /"normal" state/],
    ["not an object", 42, /JSON object/],
  ])("rejects %s", (_label, doc, message) => {
    expect(() => parseSpriteSidecar(doc, "bad.json")).toThrow(message);
  });

  it("error messages carry the source file name (batch triage)", () => {
    expect(() => parseSpriteSidecar(42, "sprites/tower.json")).toThrow(/^sprites\/tower\.json:/);
  });
});
