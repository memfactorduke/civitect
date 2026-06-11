import { describe, expect, it } from "vitest";
import { PROTOCOL_PACKAGE } from "./index";

describe("@civitect/protocol scaffold", () => {
  it("resolves and runs under Vitest Node-mode (walking-skeleton substrate)", () => {
    expect(PROTOCOL_PACKAGE).toBe("@civitect/protocol");
  });
});
