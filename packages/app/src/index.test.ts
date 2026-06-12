import { describe, expect, it } from "vitest";
import { APP_PACKAGE } from "./index";

describe("@civitect/app scaffold", () => {
  it("resolves and runs under Vitest (walking-skeleton substrate)", () => {
    expect(APP_PACKAGE).toBe("@civitect/app");
  });
});
