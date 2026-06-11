# ADR-005 — Deterministic fixed-timestep simulation

**Status:** Accepted · 2026-06-11

## Context
A solo + AI-agent project lives or dies on automated verification. Cloud sync integrity (ADR-003), golden-master testing (ADR-013), time-travel debugging, perfect bug repros, and future replay-verified leaderboards all require one property: same seed + same commands ⇒ bit-identical state, on every platform.

## Decision
Fixed timestep: 10 ticks/sec at 1× speed, 1 tick = 1 game-minute; speed multipliers run more ticks, never bigger ones. Determinism contract (TDD §3, lint-enforced in `packages/sim`): no transcendental float functions (LUTs/fixed-point instead — JS basic float ops are IEEE-754-exact, `Math.sin` et al. are not); money in integer cents; PCG32 seeded streams per system; fixed iteration order (typed-array tables); no wall clock; every player action a tick-stamped command in a log.

## Consequences
- Tests, replays, and sync verification are exact, not approximate. A bug report is seed + command log. Time travel is re-simulation.
- Weekly cross-engine hash checks (Chromium/WebKit/Node) keep the contract honest (TDD §12.6).
- We accept: discipline costs (no casual `Math.random`, careful math in sim), LUT/fixed-point work where curves are needed, and that the renderer (outside the contract) may interpolate freely — only sim state is bound.

## Alternatives
- Tolerance-based "close enough" determinism: rejected — drift compounds; bit-exact is barely harder and infinitely more useful.
- Lockstep float-with-fenced-libm: rejected — fragile across JS engines; LUTs are simpler and faster anyway.
