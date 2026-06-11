# ADR-002 — Hybrid cohort + sampled-agent simulation

**Status:** Accepted · 2026-06-11

## Context
The citizen/traffic representation determines depth, performance, and engineering cost. Full per-agent (C:S style) caps mobile cities at ~10–20k pop and concentrates risk in pathfinding; pure statistical (SC4 style) scales but kills citizen-level inspectability — the product's pillar 1. Brief §D2.

## Decision
Two-layer model. **Cohorts are truth:** per-building demographic tables (age × education × employment) drive all demography, economy, demand, and land value; cost scales with buildings, not population. **Traffic is truth at the flow level:** hourly OD matrices + equilibrium assignment (MSA over BPR edge costs) produce real congestion; cost scales with road graph size. **Agents are a sample:** a device-scaled pool (~10k phone / 25k desktop) of live, pathfinding, inspectable citizens/vehicles instantiated from cohorts ∝ flows, camera-aware. Pinned/favorited citizens become permanently tracked.

**Single chokepoint rule [binding]:** only the reconciliation sampler may instantiate agents, and it may only read cohort/flow state — the two layers cannot disagree by construction at spawn; drift while alive is bounded by pool recycling.

## Consequences
- Million-population cities within phone budgets (TDD §2); congestion, commutes, and economy remain genuinely emergent (equilibrium math, not scripted).
- "Tap any citizen" works; "follow forever" is sampled-but-stable (and exact for pinned cims). The follow test (GDD §17.5) is the quality bar.
- We accept: reconciliation engineering (one chokepoint, heavily tested), partial persistence illusion (industry standard — C:S despawns too), and that some C:S-style emergent oddities (the fun kind) need deliberate design rather than falling out of agent soup.

## Alternatives
- **Full per-agent:** rejected on phone population ceiling + engineering concentration; revisit never (model is structural).
- **Pure statistical:** rejected on pillar 1 (inspectability) — the magic is the product.
