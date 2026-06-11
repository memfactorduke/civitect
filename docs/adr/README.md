# Civitect — Architecture Decision Records

One decision per file. **Accepted** ADRs are binding on all code and all AI agent sessions; changing one requires a superseding ADR, never a silent drift.

| # | Decision | Status |
|---|---|---|
| [001](ADR-001-tech-stack.md) | Web-first TypeScript stack | Accepted |
| [002](ADR-002-simulation-model.md) | Hybrid cohort + sampled-agent simulation | Accepted |
| [003](ADR-003-online-scope.md) | Offline-first + cloud save sync | Accepted |
| [004](ADR-004-visual-style.md) | Isometric 2.5D, fixed orientation | Accepted |
| [005](ADR-005-determinism.md) | Deterministic fixed-timestep simulation | Accepted |
| [006](ADR-006-sim-isolation.md) | Sim core isolation + worker protocol | Accepted |
| [007](ADR-007-monorepo-tooling.md) | Monorepo & code tooling | Accepted |
| [008](ADR-008-rendering.md) | PixiJS v8 rendering architecture | Accepted |
| [009](ADR-009-ui-layer.md) | React DOM overlay for game UI | Accepted |
| [010](ADR-010-save-format.md) | Versioned binary save format | Accepted |
| [011](ADR-011-backend.md) | Supabase backend for sync | Accepted |
| [012](ADR-012-asset-pipeline.md) | AI-generated sprite pipeline with mechanical gates | Accepted |
| [013](ADR-013-testing.md) | Golden-master + property testing strategy | Accepted |
| [014](ADR-014-ai-workflow.md) | AI agent division of labor | Accepted |

**Template:** Status (Proposed/Accepted/Superseded-by-N) · Context · Decision · Consequences (incl. what we give up) · Alternatives considered (and why rejected).
