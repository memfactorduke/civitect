import { describe, expect, it } from "vitest";
import { BACKEND_PACKAGE, decideCitySync } from "./index";

describe("@civitect/backend scaffold", () => {
  it("resolves and runs under Vitest Node-mode (walking-skeleton substrate)", () => {
    expect(BACKEND_PACKAGE).toBe("@civitect/backend");
  });

  it("exports the sync decision boundary", () => {
    expect(decideCitySync(null, null).kind).toBe("in-sync");
  });
});
