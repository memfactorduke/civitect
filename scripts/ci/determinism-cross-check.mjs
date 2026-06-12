/**
 * ADR-013 layer 5 — weekly determinism cross-check (TDD §12.6, ADR-005).
 *
 * TODO(ROADMAP Phase 0 — board PR 12): replace this no-op with the real check:
 * run the golden replays in Chromium and WebKit (Playwright) and in Node;
 * all three final-state hashes must agree bit-exactly. This is what catches
 * engine float/JIT surprises that the §3 rules are designed to prevent.
 *
 * Stubbed because the golden harness (board PR 4) doesn't exist yet.
 */
console.log(
  "[weekly:determinism] STUB — no-op pass. Real check lands with ROADMAP Phase 0 (ADR-013 §5, TDD §12.6).",
);
