# ADR-014 — AI agent division of labor

**Status:** Accepted · 2026-06-11

## Context
Available: Claude Code sub (Fable 5 — strongest reasoning/architecture/code model) and ChatGPT/Codex $200 sub (Codex agent + in-workflow image generation via gpt-image-1.5). One human orchestrator. The operational playbook lives in `docs/AI-WORKFLOW.md`; this ADR fixes the principles.

## Decision
- **Claude Code (Fable 5) owns the correctness-critical path [binding]:** architecture, `sim`/`protocol` packages, determinism-sensitive code, save/sync, test suites, and **final review of every PR regardless of author**. Repo carries `CLAUDE.md` as its operating contract.
- **Codex owns the visual content pipeline:** all sprite/icon/texture generation per ADR-012, style bible iteration; plus parallelizable scaffolding (UI components to spec, tool pages) and second-opinion reviews on Claude-authored diffs. Repo carries `AGENTS.md`.
- **Concurrency rule:** two agents never write the same package in the same session; interface changes land in `protocol` (by Claude Code) before dependents update.
- **Human role:** product taste, playtesting, blessing golden diffs, store/ops accounts, final merge authority.

## Consequences
- Each tool runs where it's strongest; the gate (tests + Claude Code review) is uniform, so authorship doesn't determine quality.
- We accept: orchestration overhead (mitigated by AI-WORKFLOW templates), context re-establishment costs (mitigated by corpus docs + CLAUDE.md/AGENTS.md being the single source of truth).

## Alternatives
- Single-tool (Claude Code only): simpler; rejected — forfeits in-workflow image generation, which is load-bearing for ADR-012 content volume.
- Free-for-all task assignment: rejected — review responsibility and package ownership must be unambiguous for merge safety.
