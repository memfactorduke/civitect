/**
 * ADR-013 gate — performance (TDD §2 budgets, §12.4).
 *
 * TODO(ROADMAP Phase 0 — board PR 4): replace this no-op with the real gate:
 * measure sim tick p95 during golden-city replay on the normalized CI machine
 * and fail on hard-gate breach (TDD §2 table, e.g. tick p95 > 20 ms). Also
 * emit the p95 delta vs main — reviewers must flag >10% regressions even
 * under gate (AI-WORKFLOW §4.2).
 *
 * Stubbed because there is no sim to measure yet.
 */
console.log(
  "[gate:perf] STUB — no-op pass. Real gate lands with ROADMAP Phase 0 perf harness (ADR-013 §4, TDD §2/§12.4).",
);
