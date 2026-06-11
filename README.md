# Civitect — Planning Corpus

A full-depth city builder (Cities: Skylines class) for iPhone 15 Pro-class devices, with the same city playable in browser/desktop. Built by one human orchestrating Claude Code (Fable 5) + Codex. This repo holds the planning corpus (law for all agent sessions) and, from Roadmap Phase 0 onward, the monorepo itself (`packages/`, `tools/` — layout in TDD §1).

## State of the project — 2026-06-11

**All foundational decisions are made.** Planning corpus v0.1 complete. Next action: Phase 0 scaffold (see ROADMAP).

| Decided | Choice | Record |
|---|---|---|
| Visual style | Isometric 2.5D, fixed orientation | ADR-004 |
| Tech stack | Web-first TypeScript · PixiJS v8 · Capacitor 8 · sim-in-worker · Rust/WASM escape hatch | ADR-001 |
| Simulation | Hybrid: cohort truth + equilibrium traffic + ~10k sampled live agents | ADR-002 |
| Online | Offline-first + cloud save sync (Supabase); community later, format-ready | ADR-003, ADR-011 |
| Device floor | iPhone 15 Pro / 2023+ Android flagship / 2020+ desktop | TDD §2 |
| AI division | Claude Code: correctness-critical path + all reviews · Codex: art pipeline + parallel scaffolds | ADR-014 |

## Read in this order

1. **[docs/DECISION-BRIEF.md](docs/DECISION-BRIEF.md)** — why the big three were decided (historical record).
2. **[docs/GDD.md](docs/GDD.md)** — the game: pillars, every system, content inventory, testable fun heuristics.
3. **[docs/TDD.md](docs/TDD.md)** — the machine: architecture, determinism contract, perf budgets, data model, save/sync.
4. **[docs/adr/](docs/adr/README.md)** — 14 binding decision records.
5. **[docs/ROADMAP.md](docs/ROADMAP.md)** — 11 vertical-slice phases with exit criteria, Phase 0 → 1.0.
6. **[docs/AI-WORKFLOW.md](docs/AI-WORKFLOW.md)** — the choreography: who builds what, review gates, asset protocol.
7. **[CLAUDE.md](CLAUDE.md)** + **[AGENTS.md](AGENTS.md)** (repo root) — operating contracts for Claude Code and Codex sessions.

## Operating principles (the short version)

- **Cohorts are truth, agents are a sample, the follow test is the bar.** (ADR-002)
- **Bit-exact determinism or it's a bug.** Same seed + commands ⇒ same city, every platform. (ADR-005)
- **The sim never imports the world.** Headless testability is the project's superpower. (ADR-006)
- **Machines check consistency, humans check taste.** Asset gates, golden masters, balance diffs. (ADR-012/013)
- **If it was decided, it's written down.** Chat is not a source of truth.
