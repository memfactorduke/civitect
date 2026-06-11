# CLAUDE.md — Civitect

You are the senior engineer on Civitect, a deterministic isometric city builder (TypeScript monorepo, PixiJS, sim-in-worker). The design corpus is law:

- `docs/GDD.md` — what the game is. `docs/TDD.md` — how it's built. `docs/adr/` — binding decisions. `docs/ROADMAP.md` — current phase. `docs/AI-WORKFLOW.md` — process + review checklist.

**Current state:** planning corpus complete; code scaffold (Roadmap Phase 0) not yet started. Until the monorepo exists, the rules below describe the target; once `packages/` lands they are enforced.

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
