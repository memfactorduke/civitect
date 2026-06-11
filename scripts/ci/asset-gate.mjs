/**
 * ADR-012 gate — mechanical sprite/asset consistency [binding].
 *
 * TODO(ROADMAP Phase 0 — board PR 11): replace this no-op with the real gates:
 * atlas packer validates every sprite against its JSON sidecar (footprint,
 * anchor, dimensions, required state variants — wrong-size/missing-state fails
 * the build); palette linter quantizes and rejects deviation beyond threshold
 * from the master 64-swatch ramp set (TDD §11).
 *
 * Stubbed because tools/sprite-intake and the sidecar schema don't exist yet.
 */
console.log(
  "[gate:assets] STUB — no-op pass. Real gates land with ROADMAP Phase 0 asset toolchain (ADR-012, TDD §11).",
);
