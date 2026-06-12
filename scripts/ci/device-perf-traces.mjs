/**
 * ADR-013 layer 4 (render half) — weekly device-profile render traces (TDD §12.4).
 *
 * TODO(ROADMAP Phase 1): replace this no-op with Playwright render-perf traces
 * on device profiles, checked against the TDD §2 render budgets (frame p95
 * ≤ 8 ms target / 16 ms gate at street zoom). Physical-device runs happen on
 * the mini-farm outside CI; this job covers the emulated profiles.
 *
 * Stubbed because there is no renderer yet (lands ROADMAP Phase 0 PR 5,
 * with real scenes to trace arriving in Phase 1 terrain/camera work).
 */
console.log(
  "[weekly:device-perf] STUB — no-op pass. Real traces land with ROADMAP Phase 1 (TDD §2/§12.4).",
);
