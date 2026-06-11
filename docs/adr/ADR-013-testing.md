# ADR-013 — Golden-master + property testing strategy

**Status:** Accepted · 2026-06-11

## Context
AI agents write most code; the human can't QA every change in a running game. Verification must be automated, behavioral, and cheap to run constantly. Determinism (ADR-005) makes exact behavioral testing possible.

## Decision
Five layers (detail TDD §12), CI-gated in this order:
1. **Golden-master cities:** ~12 scripted seed+command-log cities replayed headlessly per PR; final-state hashes must match bit-exactly. Intentional rule changes regenerate via `--bless`, producing a balance-diff report — *the diff is the review artifact*.
2. **Property tests** (fast-check): conservation laws (people, money, trips), no-NaN/no-∞ invariants under command fuzzing.
3. **Balance simulations:** scenario runner with assertion bands (e.g., unemployment within range by year 5) + plots to the balance dashboard — catches slow economic explosions goldens miss.
4. **Perf gates:** golden replays measure tick p95 against TDD §2 budgets; breach fails CI. Weekly device-profile render traces (Playwright).
5. **Determinism cross-check:** weekly golden replays across Chromium/WebKit/Node must hash-agree.

Definition of done for any sim PR [binding]: lint + typecheck + units + goldens (or blessed diff) + perf gate green.

## Consequences
- Agents self-verify; regressions surface as hash diffs with replays attached (perfect repro by construction); balance changes become reviewable artifacts rather than vibes.
- We accept: golden maintenance (blessing discipline — every bless gets a human-read diff), CI minutes, fixture-save corpus upkeep (shared with ADR-010).

## Alternatives
- Conventional unit tests only: rejected — misses emergent/system-interaction regressions, which are *the* bug class in sim games.
- Screenshot-diff e2e as primary: rejected — flaky, slow; kept only as smoke layer.
