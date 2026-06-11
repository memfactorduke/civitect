# Civitect — AI Workflow Playbook

**Version 0.1 · 2026-06-11 · Operationalizes ADR-014**

How one human (Mem) + Claude Code (Fable 5) + Codex build this game without stepping on each other. The corpus (`GDD`, `TDD`, `adr/`) is the shared brain; this doc is the choreography.

---

## 1. Who does what

| Workstream | Owner | Why |
|---|---|---|
| Architecture, `sim`, `protocol`, determinism-sensitive code | **Claude Code** | Correctness-critical path; Fable 5's reasoning is the project's senior engineer (ADR-014) |
| Save/sync, migrations, backend | **Claude Code** | Data-loss surface |
| Test suites, golden infrastructure, CI | **Claude Code** | The verification layer must be trustworthy |
| Renderer & UI implementation to spec | **Claude Code primary; Codex for parallel scaffolding** | Codex takes well-specified component batches while Claude Code is deep in sim work |
| All sprite/icon/texture generation | **Codex** | In-workflow image gen (gpt-image-1.5); ADR-012 gates catch consistency |
| Style bible iteration | **Codex generates, Mem curates** | Taste is human |
| `tools/` dashboards & throwaway scripts | **Either** | Low risk |
| PR review | **Claude Code reviews everything, including its own prior work in fresh sessions; Codex second-opinions sim-critical diffs** | Uniform gate regardless of author |
| Playtesting, balance blessing, taste, merges, store ops | **Mem** | Judgment & authority |

**Concurrency rule (ADR-014):** never two agents writing one package in one session. Typical parallel split: Claude Code in `sim`, Codex in `assets` or `ui`. Interface changes land in `protocol` first, by Claude Code, then dependents update.

## 2. Session choreography

**Cadence that works for solo orchestration:**
1. **Plan beat (you + Claude Code, 10 min):** pick the next roadmap slice; Claude Code decomposes into PR-sized tasks (each: one package, runnable verification, ≤ a session). Decomposition gets written to the working board (`docs/board/` or issues — your choice at repo setup).
2. **Build beat (parallel):** Claude Code on the critical-path task; Codex on the current asset batch or scaffold batch. Both work against corpus specs by file/section reference (never paraphrase specs into prompts — link them).
3. **Gate beat:** CI runs the ADR-013 ladder. Claude Code reviews diffs (checklist §4). You play the build if player-facing.
4. **Bless beat (when goldens change):** Claude Code produces the balance-diff report; you read it and bless or bounce.

**Context discipline:** every session starts by reading `CLAUDE.md`/`AGENTS.md` (repo) which point into this corpus. Specs live in docs, never in chat history — if a decision was made in conversation, it gets written into the corpus *that session* or it didn't happen.

## 3. Task granularity guide

Good agent task: *"Implement §6.3 assignment solver slice scheduling per TDD; extend golden city 'gridlock-01' to cover it; tick budget table must stay green."*
Bad: "work on traffic" (no verification), "fix the bug" (no repro — attach seed+command log), anything touching two packages "while you're there."

## 4. Review checklist (Claude Code applies to every PR)

1. Determinism: no banned APIs in `sim` (lint should catch; reviewer confirms intent), PRNG stream discipline, iteration-order safety.
2. Budgets: perf gate deltas — flag any p95 regression >10% even if under gate.
3. Wall integrity: imports respect ADR-006 (dependency-cruiser green, plus sanity).
4. Protocol: version bump if layout changed; codecs symmetrical (encode∘decode property test present).
5. Cause chains: any new advisor/warning emits causes (ADR-009 typecheck enforces; reviewer checks they're *useful*).
6. Tests: golden/property coverage moves with behavior; `--bless` diffs justified in PR description.
7. GDD/TDD drift: if implementation deviated from spec, PR must include the docs edit (or an ADR if it's a decision).

## 5. Codex asset production protocol (per ADR-012)

**Batch unit:** one category × one zoom-consistent set (e.g., "R low-density L1–L3, 12 buildings × 4 variants"), 30–60 sprites.

**Prompt template (keep in `tools/asset-prompts/`):**
```
[STYLE] Use attached style-bible refs: iso 2:1, sun NW 45°, palette ramps R-04,
        line weight 1px@3x, no outline glow, flat ambient occlusion only.
[SPEC]  Building: {name}. Footprint {w}×{d} tiles (tile=192×96px @3x).
        Anchor center-bottom of footprint. Canvas {W}×{H}px transparent.
        States required: normal, construction, abandoned, night-emissive mask.
[CONTEXT] Sits in {zone/level} district alongside refs {a,b}. Read clearly at 50% zoom.
[NEGATIVE] No photorealism, no perspective skew, no drop shadow outside footprint.
```
Then: post-process chain (`tools/sprite-intake`) → mechanical gates → contact-sheet for Mem's taste pass → atlas. Reject-and-regenerate is normal; gates make rejects cheap. Log accepted prompt variants back into the template file — the prompt library *is* the art pipeline's source code.

## 6. When the agents disagree

Codex second-opinion flags on a Claude Code diff → Claude Code responds in the PR thread → if unresolved, it's a decision: Mem rules, and if it's structural, it becomes an ADR. Disagreement is signal, not friction; the failure mode to avoid is silent deference.

## 7. The orchestrator's week (suggested rhythm)

- Daily: one plan beat + merge queue review (≤30 min when phases are humming).
- Per phase: one full playtest against the phase's exit criteria + heuristics (GDD §17).
- Weekly: device-farm perf run review; balance dashboard skim; corpus drift audit (Claude Code task: "diff implemented behavior vs GDD/TDD, list divergences").
- Monthly: re-read ROADMAP sizing against reality; resequence if a phase split is warranted (split > slip).
