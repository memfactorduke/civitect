import { describe, expect, it } from "vitest";
import { BACKEND_PACKAGE } from "./index";

describe("@civitect/backend scaffold", () => {
  it("resolves and runs under Vitest Node-mode (walking-skeleton substrate)", () => {
    expect(BACKEND_PACKAGE).toBe("@civitect/backend");
  });
});
