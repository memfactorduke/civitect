import { describe, expect, it } from "vitest";
import { UI_PACKAGE } from "./index";

describe("@civitect/ui scaffold", () => {
  it("resolves and runs under Vitest (walking-skeleton substrate)", () => {
    expect(UI_PACKAGE).toBe("@civitect/ui");
  });
});
