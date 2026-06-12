import { describe, expect, it } from "vitest";
import { fnv1a64 } from "./hash";

const utf8 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe("fnv1a64", () => {
  it("matches published FNV-1a 64 test vectors", () => {
    expect(fnv1a64(new Uint8Array(0))).toBe("cbf29ce484222325"); // offset basis, by definition
    expect(fnv1a64(utf8("a"))).toBe("af63dc4c8601ec8c");
    expect(fnv1a64(utf8("foobar"))).toBe("85944171f73967e8");
  });

  it("is sensitive to every byte", () => {
    expect(fnv1a64(utf8("ab"))).not.toBe(fnv1a64(utf8("ba")));
    expect(fnv1a64(Uint8Array.of(0))).not.toBe(fnv1a64(Uint8Array.of(0, 0)));
  });
});
