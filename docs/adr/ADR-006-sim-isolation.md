# ADR-006 — Sim core isolation & worker protocol

**Status:** Accepted · 2026-06-11

## Context
The architecture's load-bearing wall: testability (headless sim), the WASM escape hatch (ADR-001), UI responsiveness, and the determinism contract all depend on the simulation being a sealed unit.

## Decision
`packages/sim` imports nothing from renderer/UI/DOM (dependency-cruiser CI rule). It runs identically in a Web Worker (production) and Node (tests/tools). All interaction crosses `packages/protocol`: versioned binary **commands** in (tick-stamped, validated, rejectable with reason codes), **snapshot deltas** out (transferables baseline; SharedArrayBuffer fast path where cross-origin isolation allows), request/response **inspector queries** for panels. Sim is authoritative; UI ghosts are cosmetic until confirmed.

## Consequences
- Claude Code can run "simulate 10 years, assert solvency" as a unit test — the single highest-leverage property of the whole architecture.
- Main thread never blocks on sim; protocol version stamps prevent cached-shell/worker drift (TDD §7).
- We accept: codec maintenance (one place: protocol package), slight latency (≤1 tick) on command application, and designing UI around async confirmation.

## Alternatives
- Sim on main thread with cooperative scheduling: rejected — GC + long ticks would fight 60fps; worker isolation also enforces the import wall socially.
- Full ECS framework dependency: rejected — our table layout (TDD §4) is simpler, faster for this access pattern, and dependency-free.
