# Board — Phase 6: Districts, policies & transit [XL]

Decomposed 2026-06-14 (autonomous Phase-6 loop). Tranche structure follows
the proven pattern: interface + save first, then districts (the spatial
layer policies hang off), policies (the intent layer), the transit CORE
(the signature mode-choice integration — isolated so its risky logit math
lands and is adversarially reviewed alone), the transit MODES + rendering,
the transit/district UI (line editor + panels), and the mode-share balance
harness that carries the automatable exit criterion.

Phase law (ROADMAP §6 + GDD §9/§11): the district layer already exists in
the terrain RLE (layer id 4); transit vehicles are CAPACITY agents in the
ADR-002 sampled projection; mode choice is the locked logit (TDD §6.2) —
transit JOINS it, it is not bolted on; every line keeps a per-line ledger
(riders/cost/fare, money integer cents); policies are levers that move
MODELED outcomes, not flavour. Determinism unchanged (ADR-005): transit
assignment is canonical, vehicles are a derived projection.

| # | Task | Package | Spec | Size | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Protocol v13 + save v10: district state (names + per-district policy mask, the layer-4 paint is already terrain), city-wide ordinance mask, transit network (lines = ordered stop lists with mode/color/name/vehicle-count/headway; stops; per-line ledger), commands (paintDistrict/nameDistrict, setPolicy per district + setOrdinance, createLine/addStop/removeStop/setLineVehicles/deleteLine, congestion-charge toggle), snapshot blocks (district stats, line profitability, mode-share) + generalized overlay ids (15=district, 16=transit, 17=ridership), inspector district+line; save v10 TRANSIT+DISTRICTS sections with v9→v10 migration on archived fixtures | protocol+sim | GDD §9/§11, TDD §6/§7/§10, ADR-005/006/010 | L | codec property + fixed vectors (v13 tripwire); migration ladder v1→…→v10 green on archived fixtures; commands domain-validated; transit/district state DERIVED-vs-canonical split documented | pending |
| 1b | Transit INTERFACE (split from task 1 so the CORE logit lands alone in task 4): protocol v14 (createLine/deleteLine/addStop/removeStop/setLineVehicles + TransitMode enum + MAX_LINES; decode domain-validated), save v11 TRANSIT section + v10→v11 empty-network migration, canonical `world.transit` (lines + per-line ledger accumulators, vehicles/mode-choice deferred to task 4) with validated command handlers, stateHash fold | protocol+sim+app | GDD §9, TDD §7/§10, ADR-005/006/010 | M | codec round-trip (FEATURE-ACTIVE lines) + v14 wire vectors; migration ladder v1→…→v11 green + non-default v11 fixture; commands domain-validated + rejection-tested; world↔CivSave round-trips hash-identical WITH lines; empty transit ≡ dormant (pure-serialization re-bless — goldens + tripwires re-pinned, all HUD scalars byte-identical) | **MERGED #211** (self-merged; Mem post-hoc bless review owed) |
| 2 | Districts: free-draw painting tool (district terrain layer), auto-named + renamable, per-district stat AGGREGATION (pop/jobs/land value/pollution/mode share by district — fenced pure functions, content digests on the wire), district tax overrides (per zone, the first policy hook — supersedes the city rate inside the district) | sim | GDD §11, TDD §5, ADR-005 | L | district aggregation ≡ per-tile-sum oracle property over random paints; tax override applies inside / city rate outside (unit); paint∘unpaint ≡ identity on the hash; goldens unaffected (no district = city defaults) | 2a done (tax override, in PR); 2b aggregation pending |
| 2a | District TAX OVERRIDE — the first policy hook: protocol v15 `setDistrictTax` (per-district per-zone permille, 0 = inherit; decode + handler domain-validated), threaded into the monthly tax close (`accumulateClose.taxRateAt` — a nonzero override on the tile's district supersedes the city rate). DEMAND still reads the city rate ⇒ growth unchanged, revenue-only (scoped) | protocol+sim | GDD §11, TDD §8, ADR-005/006 | M | codec round-trip (commandArb + v15 wire vectors); override lifts inside revenue vs an identical no-override town; painted-no-override ≡ city rate; rejects out-of-range; NO golden re-bless (goldens districtless) | **in PR** |
| 3 | Policies + ordinances: ~22 policies with REAL system hooks (education boost, free transit, recycling, high-rise ban, heavy-traffic/old-town truck bans, subsidies R/C/I/O, tourism promotion, noise ordinance, bike-lanes mandate, congestion charge [strong lever, milestone-gated], specialized-industry designation, …) per-district + the city-wide ordinance subset; each carries upkeep or a tradeoff | sim | GDD §11 [policies LOCKED as the intent layer], ADR-005 §2 | XL | each policy moves its MODELED outcome in the asserted direction (unit per lever: congestion-charge ↓ downtown car share, industry-subsidy ↑ I demand, high-rise-ban caps level, truck-ban reroutes freight); upkeep books to the report; unlock-gated levers reject pre-milestone | pending |
| 4 | Transit CORE: lines as ordered stop lists; transit VEHICLES as capacity agents (board from stop queues, overcrowding = full vehicle skips stop); stop catchment via PATH-NETWORK distance (walkability, GDD §9); ridership ↔ MODE CHOICE — transit enters the locked logit (TDD §6.2) on generalized cost (in-vehicle time + wait from headway + transfer + walk) and competes with car/walk; per-line ECONOMICS ledger (riders × fare − vehicle upkeep, integer cents) | sim | GDD §9 [signature system], TDD §6.2/§6.6, ADR-002/005 | XL | mode-share conservation (Σ mode shares ≡ generated trips, EXACT); a competitive line SHIFTS share off cars (property: faster line ⇒ ≥ car share drop); per-line ledger conserves (fare ≡ riders×fare; profit = fare − cost); transit assignment is canonical (save/load + cross-engine identity) | 4a done (mode choice, in PR); 4b vehicles + 4c economics pending |
| 4a | Transit MODE CHOICE core: transit competes with the CAR on the car margin — an integer discrete-choice split (scale-invariant cost-RATIO sharp step table, float/exp-free, ADR-005) diverts a share of driving commuters to a line that serves the OD (stop-cell catchment; generalized cost = fraction-of-congested-car-time + wait(headway) + access-walk [TUNE]); new `ridden` conservation bucket (DERIVED = gen−ass−walk−unr ⇒ NOT hashed/saved). Vehicles/capacity → 4b; per-line fare/upkeep economics + line.riders attribution → 4c | sim | GDD §9, TDD §6.2, ADR-002/005 | L | mode-share conservation EXACT incl. ridden; competitive line SHIFTS ~35% off cars (assigned 190→123 @ peak, demand-side + population identical); save/load identity WITH active line; transit-free cities BYTE-IDENTICAL (goldens unchanged, NO bless); adversarial review clean (0 findings) | **in PR** |
| 5 | Transit MODES + rendering: the six modes (bus depot+stops, tram on boulevards, metro underground station+tunnels portal-rendered in iso, passenger + freight rail, harbor ferry+dock on coastal, airport late-game unique tourism boost) with siting rules + costs; renderer transit layer (lines, vehicles as agents, stops) + transit/ridership overlays | sim+renderer | GDD §9, TDD §6.6/§8, ADR-002/008 | L | siting refuses illegal placement (tram off-boulevard, harbor inland — rejection tests); freight rail bypasses road freight (the chain's trucks choose rail when cheaper — unit); metro portal renders in iso (renderer test); each mode joins the mode-share property | pending |
| 6 | Transit + district UI: line editor (tap-sequence stops, color/name, per-line vehicle allocation, headway slider, load/profitability stats), per-line profitability panel, district paint tool + per-district stats panel + rename, policy panels (per-district + ordinances) with optimistic ghosts, congestion-charge control, transit + ridership + district overlays through the generalized ids; funds/mode-share HUD | ui+renderer+app | GDD §13/§15, TDD §9, ADR-009 | L | RTL: line editor builds a line → dispatches createLine/addStop; profitability panel sums riders×fare − cost to the displayed profit (the report property pattern); policy toggle dispatches setPolicy; e2e: ridership overlay nonzero on a served line through the real worker; one-handed line-editor layout (UX — Mem's feel pass) | pending |
| 7 | Mode-share balance harness + exit criteria: a transit archetype (the task-6 harness extended) where MODE SHARE responds to policy levers within MODELED BANDS (free-transit ↑ transit share; congestion-charge ↑ transit share downtown; bike-lanes ↑ walk share) at 2 game-years per-PR + 20-year weekly; transit-first 100k-city band; goldens re-blessed with transit/districts; closeout | e2e | ADR-013 §3, GDD §17, ROADMAP §6 | L | policy→mode-share bands green (per-PR 2y + weekly 20y dispatchable); transit-first city holds its band; goldens re-blessed; board closeout. NB the two FEEL exit criteria (transit-first city "viable & fun"; line editor one-handed) are Mem's playtest/UX passes by the ROADMAP standing rule | pending |

**Exit criteria mapping (ROADMAP §6):** transit-first 100k city viable+fun
← Mem playtest (feel) · mode share responds to policy levers within bands ←
7 (automatable) · line editor one-handed on phone ← Mem UX test (feel) ·
goldens re-blessed ← 7.

**Deliberately deferred (recorded):** weather/seasons (Phase 7 with §12);
disasters + disaster-policy interaction (Phase 8); leaderboard transit
audit (post-1.0, ADR-003); real-hardware UX/perf of the line editor (Mem,
on device). Specialized-industry designation policy (task 3) only TAGS the
resource preference — the chain's spawn rule (Phase 5) already sites raw on
resources, so the policy biases, it doesn't override.

**CI-budget note:** transit adds capacity-agent stepping + a mode-choice
layer to the per-tick solve — the perf gate (TDD §2) is the tripwire; if the
metro perf scenario regresses >10% p95, the transit step is sliced like the
MSA solver (TDD §6.3 precedent). The 20-game-year mode-share weekly extends
the task-6 archetype harness (GAME_YEARS=20), not a new gate.

**Human gates (Mem, by the ROADMAP standing rule):** the transit-first city
"viable & fun" playtest and the one-handed line-editor UX test are FEEL
judgments a gate can't make — the loop builds to the automatable bands and
flags these for Mem at closeout.
