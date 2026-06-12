# Board — Phase 3: Traffic & live agents [XL] — the signature system

Decomposed 2026-06-12 (continuation run). Tranche structure: the
mathematical core first (OD → mode → assignment → feedback, conservation-
proven), then agents/rendering/inspection, then perf/diagnosis.

| # | Task | Package | Spec | Size | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Traffic core: hourly OD from cohorts (8×8 zone-cells), table-logit mode choice, STATELESS hourly assignment over the road graph with 2-pass BPR feedback (integer (v/c)^4 — no pow), congested travel times; conservation counters | sim | GDD §9, TDD §6, ADR-002/005 | L | conservation property EXACT (exit criterion 2 ✓); congestion + determinism props; path cache keyed on graph version (balance gate runtime unchanged); covered by existing goldens (traffic is derived) | in-review |
| 2 | Solver slicing + MSA averaging with hashed/saved traffic state (save v5) — replaces v1's hour-boundary spike (TDD §6.3 deviation note) | sim+protocol | TDD §6.3 | L | tick p95 flat at hour boundaries; MSA convergence band | pending |
| 3 | Live agents: pool + camera-aware sampler (the ADR-002 chokepoint), transform buffer in snapshots (transferable), renderer agent layer, pinned cims | sim+protocol+renderer | GDD §9.4, TDD §6.5/§7 | XL | sampler-chokepoint unit; follow test e2e (exit criterion 1) | pending |
| 4 | Traffic overlay (edge volume/capacity tints) + road inspector (volume, capacity, travel time) + rush-hour departure curves | sim+protocol+renderer+ui | GDD §9.5 | L | overlay units; inspector e2e | pending |
| 5 | Jam diagnosis: under-built bridge scenario → advisor with cause chain pointing at the saturated edge (exit criterion 4) | sim+e2e | GDD §9, ADR-009 | M | e2e: deliberate bottleneck → diagnosable jam advisor | pending |
| 6 | Perf: 250k pop + 10k agents tick p95 ≤ 10 ms on device floor (exit criterion 3) | e2e | TDD §2 | L | device measurement recorded; perf golden joins gate | pending |

**Exit criteria:** follow test ← 3 · conservation ← 1 · 10k agents/250k pop
p95 ← 6 · diagnosable jam with cause chain ← 5.
