# ADR-007 — Monorepo & code tooling

**Status:** Accepted · 2026-06-11

## Context
One person + AI agents need: instant feedback loops, mechanical style (zero bikeshedding), and a repo layout agents navigate without guidance.

## Decision
- **pnpm workspaces** monorepo (layout in TDD §1); packages publishable-shaped but private.
- **TypeScript strict** (+ `noUncheckedIndexedAccess`); project references for fast incremental builds.
- **Vite** for app/dev servers + library builds; **Vitest** for tests (Node-mode for sim — no browser overhead in the hot loop).
- **Biome** for lint+format (single fast tool; custom ESLint retained *only* inside `packages/sim` for the determinism ban-rules of ADR-005 until ported to Biome plugins).
- **dependency-cruiser** in CI: enforces ADR-006 import wall.
- GitHub + Actions CI: lint → typecheck → unit → golden-masters → perf gate; trunk-based, short-lived branches, PRs as the AI review surface (ADR-014).
- Node 22 LTS floor; versions pinned at scaffold time and recorded in repo CLAUDE.md.

## Consequences
- Agents get sub-second feedback on most changes; CI is the arbiter of done (AI-WORKFLOW definition-of-done).
- We accept: two lint tools temporarily (Biome + scoped ESLint), pnpm-specific tooling knowledge.

## Alternatives
- Nx/Turborepo: rejected for now — pnpm + Vite is enough at this scale; revisit if CI minutes hurt.
- ESLint+Prettier everywhere: rejected — slower; Biome covers 95% with one config.
