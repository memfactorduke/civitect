# Board — Phase 5: Economy, industry chains & progression [L]

Decomposed 2026-06-12 (same continuation run as Phase 4). Tranche
structure: interface + land value first (taxes need a tax base), then the
money cycle (funds finally move — ONE coordinated re-bless), the goods
chain with real freight (the Phase-3/4 deferred volume injection lands
here), progression (milestones/uniques/achievements/difficulty), the
economy UI, and the archetype balance harness that carries the exit
criteria.

Phase law (ROADMAP §5 + GDD §8): money is integer cents (ADR-005
[LOCKED]); every chain hop is real freight on the network; the monthly
report explains itself (pillar 2 — deltas + why-links); progression
introduces problem classes, not just buildings.

| # | Task | Package | Spec | Size | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Protocol v12 + save v8 + land value v1: derived land-value field (service coverage + parks + education − pollution − noise − traffic; water view +) with spot reads + full field (coverage-cache pattern); generalized overlay ids (10=landValue, 11–14=pollutions — the task-6 leftover); commands setTaxRate (zone×, 1–29%), takeLoan/repayLoan (3 tiers); snapshot monthly-report block (income/expense lines with MoM deltas + cause refs) + milestone block; inspector landValue on tiles; save v8: ECONOMY section (tax rates, loans, monthly accumulators, milestone/achievement/unique state, difficulty) with v7→v8 migration on archived fixtures | protocol+sim | GDD §6/§8/§13, TDD §7/§10, ADR-005/006/010 | L | land-value field ≡ weighted-sum oracle property over random cities; codec property + fixed vectors (v12 tripwire); migration ladder v1→…→v8 green; land value stays DERIVED (no hash move in this task) | done (#66 — land value derives from coverage+pollution+water view, directional facts proven; ANCHOR-SOURCES fix shipped here: mid-block stations >4 tiles from a node covered NOTHING (found by the directional test) — stations now enter the Dijkstra via covering-edge endpoints with interpolated offsets; services-city re-blessed +1.2% pop; v12 wire complete (tax/loan commands domain-validated, report/milestone blocks, overlay ids 10–14, tile landValue); save v8 ECONOMY (reserved id 6) with a non-default v8 fixture archived) |
| 2 | Budget cycle: starting funds by difficulty; construction costs (roads by class×length, ploppables by kind) with insufficientFunds rejections; monthly close on tick boundary — property taxes by zone×level×land-value bracket, service upkeep (buildings × budget sliders), road maintenance by class; loans (3 tiers: principal, monthly interest, term) with auto-debit; bankruptcy → one-time bailout offer (high-interest loan via advisor with cause chain) → receivership flag (sandbox-continue, achievements disabled) | sim | GDD §2/§8 [money LOCKED], ADR-005 §2 | XL | money conservation property (Σ flows ≡ funds delta, EXACT, every close); insufficientFunds leaves no fingerprints (hash test); bankruptcy scenario: offer → decline → receivership advisor chain resolves; THE FUNDS BLESS: every golden re-blessed once with funds movement documented (HUD fundsCents finally nonzero) | pending |
| 3 | Goods chain + freight: raw (map-resource-gated specialized industry: farm/forest/ore/oil) → processed → goods (generic industry) → retail (C sells to residents/tourists); per-building input/output stocks; REAL freight trips join OD generation as a freight purpose (the Phase-3/4 deferred volume injection — trucks load the network all day per the freight curve); outside connections at map-edge road anchors: import covers deficits (cost drag on C profits), surplus exports (income); starved C/I reset thriveDays (GDD §6 de-level pressure); office = educated-labor sink with wage-weighted tax yield | sim | GDD §8 [chain structure LOCKED], §9.5, TDD §6 | XL | chain conservation property (produced ≡ consumed + exported − imported + Δstock, EXACT); freight conservation joins the traffic ledger property; starvation de-levels (unit); specialized industry refuses off-resource tiles (rejection test); balance bands hold with chain active | pending |
| 4 | Progression: milestones by population (240→350k [TUNE]) with staged unlocks (budget panel → loans → high density → uniques → congestion pricing stub → airport stub; district/policy/transit gates land with Phase 6 but their milestone SLOTS are reserved); unique buildings (~18 ploppable kinds, playstyle-achievement-gated, city-wide bonus hooks + tourism weight); achievements (~60: growth/mastery/absurd — canonical bitset, counter engine); tourism v1 (attractiveness from parks/uniques/low-crime → arrivals via outside connections → C revenue + advisor); difficulty modes (Relaxed/Mayor/Ironclad: starting funds, loan terms, demand sensitivity) + sandbox toggles (achievements disabled) | sim+protocol | GDD §8/§13, ADR-009 | L | milestone ORDER + threshold property (never skips, never regresses); unlock-gated commands reject pre-milestone (negative tests); achievement engine: trigger-once property over fuzzed counters; tourism arrivals ∝ attractiveness (unit); difficulty multipliers applied (unit per mode) | pending |
| 5 | Economy UI: monthly report panel (income/expense lines, MoM deltas, tappable why-links through the existing CauseChain renderer); tax + loan panels (commands with optimistic ghosts); milestone toast + advisor explainer cards (GDD §13 'problem class' framing); achievements panel; bankruptcy/bailout dialog flow; land-value + pollution overlays through the generalized overlay ids; funds HUD goes live (red when in debt) | ui+renderer+app | GDD §13/§15, TDD §9, ADR-009 | L | RTL: report lines sum to the funds delta shown (the demand-panel property pattern); tax slider dispatches; milestone toast renders from snapshot block; e2e: land-value overlay nonzero around a serviced block through the real worker; bankruptcy dialog flow RTL | pending |
| 6 | Archetype balance harness + exit criteria: 5 archetype scenarios (R-sprawl suburb, industry-freight town, office/education city, tourism-parks resort, lean-budget knife-edge) on 64×64 maps; per-PR gate runs each 2 game-years inside bands (parallel vitest files); full 20-game-year suite as a WEEKLY + dispatchable workflow (the determinism-cross-check pattern) and run locally once for the phase claim; bankruptcy post-mortem scenario (automatable half of GDD §17.4): scripted collapse asserts report+advisor chain names the drain; progression pacing test: scripted growth hits every milestone in order with its unlock; goldens re-blessed; closeout | e2e | ADR-013 §3, GDD §17 | L | 5×20y bands green (local + weekly workflow proven via dispatch); 5×2y bands green per-PR; post-mortem chain resolves; pacing test green; board closeout | pending |

**Exit criteria mapping:** balance bands across 5 archetypes × 20
game-years ← 6 · bankruptcy post-mortem articulable (automatable half;
the feel half is Mem's by the ROADMAP standing rule) ← 2+6 · milestone →
problem-class pacing ← 4+6.

**Deliberately deferred (recorded):** districts/policies/transit unlocks
beyond reserved milestone slots (Phase 6); disasters-linked insurance
(Phase 8); leaderboard-grade economy audit trails (post-1.0, ADR-003);
stadium events (Phase 6 with the stadium unique's traffic drill).

**CI-budget note:** 20-game-year × 5-archetype runs are ~2.5–3 h wall —
structurally a weekly/dispatchable gate, not per-PR (precedent: the
determinism cross-check, TDD §12.6). The per-PR rung holds the same bands
at 2 years so regressions surface in review, and the full horizon is
proven at phase closeout + weekly thereafter.
