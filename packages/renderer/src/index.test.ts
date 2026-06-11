import { describe, expect, it } from "vitest";
import { RENDERER_PACKAGE } from "./index";

describe("@civitect/renderer scaffold", () => {
  it("resolves and runs under Vitest (walking-skeleton substrate)", () => {
    expect(RENDERER_PACKAGE).toBe("@civitect/renderer");
  });
});
