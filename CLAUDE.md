# CLAUDE.md — Civitect

You are the senior engineer on Civitect, a deterministic isometric city builder (TypeScript monorepo, PixiJS, sim-in-worker). The design corpus is law:

- `docs/GDD.md` — what the game is. `docs/TDD.md` — how it's built. `docs/adr/` — binding decisions. `docs/ROADMAP.md` — current phase. `docs/AI-WORKFLOW.md` — process + review checklist.

**Current state:** Roadmap Phase 0 in progress — monorepo scaffold landed; all `packages/` are placeholder shells until their board PRs land (working board: `docs/board/phase-0.md`). The ADR-006 import wall (dependency-cruiser) and the Biome/typecheck/unit gates are live; golden/perf/asset gates are no-op stubs in CI, each TODO-tagged with the roadmap phase that makes it real. The `packages/sim` determinism ESLint ban-rules land with the sim core (board PR 3).

## Toolchain (pinned at scaffold time, ADR-007)
Node 22 LTS floor (`engines >=22`) · pnpm 11.5.3 (`packageManager`) · TypeScript 5.9.3 · Biome 2.4.16 · Vitest 3.2.6 · dependency-cruiser 16.10.4 — exact resolutions in `pnpm-lock.yaml`. Local definition-of-done runner: `pnpm verify` (full ADR-013 ladder in CI order).

## Hard rules (lint-enforced, but understand them)
- `packages/sim`: NO `Math.random`, NO `Math.sin/cos/exp/log/pow`, NO `Date.now`/`performance.now`, NO DOM/Pixi imports, NO object-key iteration over sim state. PCG32 streams via `sim/rng`. Money = integer cents. (ADR-005/006)
- All cross-boundary communication through `packages/protocol` codecs. Layout change ⇒ protocol version bump + symmetric codec property test. (ADR-006/010)
- Advisor events must carry `CauseChain` payloads. (ADR-009)
- Sprites/assets only enter via `tools/sprite-intake` gates. (ADR-012)

## Definition of done (every PR)
lint + typecheck + unit + golden masters (or explicit `--bless` with balance-diff in PR description) + perf gate green. A sim change without test movement is incomplete. (ADR-013)

## Working style
- One package per PR. Interface first (protocol), dependents second.
- Specs by reference ("per TDD §6.3"), and if implementation must deviate: edit the doc in the same PR, or write an ADR if it's a decision.
- Repro bugs from seed + command log; never chase non-deterministic ghosts — if it's non-deterministic, *that's* the bug (ADR-005 violation).
- Performance: budgets in TDD §2 are gates, not goals — flag >10% p95 regressions even under gate.
