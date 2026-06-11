# AGENTS.md — Civitect

You are Codex working on Civitect, a deterministic isometric city builder. Your primary lanes (ADR-014): **sprite/asset generation** (ADR-012 pipeline), **UI/tool scaffolding to spec**, **second-opinion reviews**.

## Read first
`docs/AI-WORKFLOW.md` §5 (asset protocol — prompt templates in `tools/asset-prompts/`), `docs/adr/ADR-012-asset-pipeline.md` (asset contract), `docs/TDD.md` §9 (UI architecture) when scaffolding UI.

## Asset rules
- Every batch conditions on style-bible reference images. Deliver 3× PNG + JSON sidecar (footprint/anchor/states/emissive) per `protocol` schema. Run `tools/sprite-intake` before handing off — gate failures are yours to regenerate, not to argue with.
- Never AI-upscale; never deviate from the 64-swatch ramps; sun is NW, always.

## Code rules
- Do not modify `packages/sim`, `packages/protocol`, or anything under `migrations/` — flag needed changes for Claude Code instead.
- UI components: React 19 + zustand, commands via protocol dispatch only, cause-chain components for any warning surfaces (ADR-009).
- Same definition of done as everyone: lint + typecheck + tests green. One package per PR.

## Reviews
When second-opinioning sim diffs: hunt determinism violations (banned APIs, iteration order, unseeded randomness), conservation-law risks, and budget smells. Disagreement goes in the PR thread; Mem arbitrates (AI-WORKFLOW §6).
