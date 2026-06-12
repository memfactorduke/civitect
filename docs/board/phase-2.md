# Board — Phase 2: Zoning, growth & land value [L]

Decomposed 2026-06-12 (continuation run) per AI-WORKFLOW §3, executed under
the session's standing completion directive. Coarser PRs than Phase 0/1
(dense systems that only make sense together), each still one review unit.

| # | Task | Package | Spec | Size | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Protocol v6: zone/dezone/placeBuilding commands, ZoneKind/BuildingKind vocab, snapshot demand block + building list (version+list, road pattern) | protocol | GDD §6/§7, TDD §7 | M | codec property + pins | done (#41) |
| 2 | Sim systems: zone painting (road-adjacent depth 4), buildings SoA + cohort blocks (age×edu), demand from first principles (factor breakdown), staggered growth/level/abandon, power+water connectivity ledgers, land value field (derived, dirty-region) — hash appends + re-bless; golden `growth-city-01` | sim | GDD §6/§7/§8, TDD §4/§5 | XL | properties (cohort conservation, factors-sum, planarity intact), growth golden, re-bless w/ balance-diff | done (#42) |
| 3 | Balance gate REAL (unstubs the Phase 2 stub): assertion bands over the growth golden — **exit criterion 1: 0→5k pop unattended** | e2e | TDD §12.3, ADR-013 | M | bands green; gate negative-tested | in-review |
| 4 | Renderer: building blocks (placeholder volumes until sprites [style bible pending]) + overlays v1 (zones, land value, power, water) | renderer | TDD §8 | L | overlay units; dev harness | pending |
| 5 | UI: demand panel (factors visible — **exit criterion 3: factors sum, property**), advisor feed w/ CauseChain rendering, building inspector — **exit criterion 2: cause links resolve in e2e** | ui + app + e2e | GDD §6, ADR-009 | L | RTL + factors-sum property + cause-chain e2e | pending |
| 6 | First 60 growable sprites | Codex + Mem | ADR-012 | content | intake gates | BLOCKED on style bible (Phase 0 criterion 3) — placeholder volumes stand in |

**Exit criteria:** (1) golden city 0→5k unattended, balance bands green ← 2+3 ·
(2) cause-chain links resolve in e2e ← 5 · (3) demand factors sum property ← 5.
