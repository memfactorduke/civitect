# ADR-003 — Offline-first with cloud save sync

**Status:** Accepted · 2026-06-11

## Context
Phone↔desktop continuity is a stated product goal. Options: fully offline, + cloud sync, + community features. Brief §D3 quantified: sync ≈ 3–5% effort if designed in now; community ≈ 15–25% + permanent moderation ops.

## Decision
Level 1 now: fully offline gameplay; optional sign-in (Apple/Google) syncing saves through a thin backend (ADR-011). Conflicts: generation counter, last-writer-wins, "keep both" fork on divergence — no merging.

**Format-forward rule [binding]:** save format (ADR-010) and sim determinism (ADR-005) must keep Level 2 (sharing, replay-verified leaderboards, challenges) addable without migration. Nothing may assume saves never leave the device.

## Consequences
- Cross-device continuity ships at 1.0; no gameplay ever gated on connectivity; account deletion/privacy compliance enters scope (bounded, standard).
- Community features deferred deliberately — when added, deterministic replays make leaderboard anti-cheat ≈ free (server re-simulates).
- We accept: running a (thin) backend and auth UX surface.

## Alternatives
- **Fully offline:** rejected — manual save shuttling defeats the two-context product thesis.
- **Community at launch:** rejected — moderation ops + content APIs are a second product; sequencing risk for a solo builder.
