import { describe, expect, it } from "vitest";
import { SIM_PACKAGE } from "./index";

describe("@civitect/sim scaffold", () => {
  it("resolves and runs under Vitest Node-mode (walking-skeleton substrate)", () => {
    expect(SIM_PACKAGE).toBe("@civitect/sim");
  });
});
