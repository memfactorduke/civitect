# ADR-001 — Web-first TypeScript stack

**Status:** Accepted · 2026-06-11 · Decided by Mem after decision brief

## Context
Civitect targets iOS + Android (primary) and browser/desktop with one codebase, built by one person orchestrating AI agents (Claude Code primary). Candidates: Unity 6, Godot 4, web-first TypeScript. Full analysis: `docs/DECISION-BRIEF.md` §D1. Key facts at decision time: Godot 4 C# still cannot export to web (mid-2026); Unity 6 web now supports mobile browsers but remains editor-centric; Pocket City shipped on Phaser+TS+workers.

## Decision
TypeScript monorepo. Simulation = pure TS package in a Web Worker. Rendering = PixiJS v8 (WebGL). Mobile = Capacitor 8 shells. Desktop = browser/PWA. UI = React DOM overlay (ADR-009).

**Escape hatch [binding]:** any sim system that exhausts TS optimization and still breaches its budget (TDD §2 gates) is ported to Rust→WASM *behind its existing interface*. Designated candidates: pathfinding, traffic assignment. The hatch exists because the sim core is isolated (ADR-006); nothing else may take a WASM dependency without a new ADR.

## Consequences
- AI agents can build, test, and verify nearly 100% of the product headlessly; iteration speed is the project's core asset.
- One build artifact per platform from one codebase; browser version is first-class.
- We accept: ~2–5× native-speed penalty on sim arithmetic (mitigated by data layout + ADR-002 model; bounded by the WASM hatch), iOS WebView quirk management (Capacitor's job), building our own dev tooling (TDD §13 — also an asset, agents extend it).
- Performance is owned by *design* (budgets, SoA, staggering), not by engine headroom.

## Alternatives
- **Unity 6:** highest ceiling (Burst/ECS), best native export; rejected: editor-in-the-loop breaks the AI-agent workflow that constitutes our velocity; heavyweight for 2D iso sprites; web builds heavy on phones; license-trust history.
- **Godot 4:** good 2D, agent-friendly text scenes; rejected: C# has no web export → browser build forces GDScript (slower than modern JS JIT for tight numeric loops) or a split codebase.
