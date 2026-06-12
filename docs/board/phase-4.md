# Board — Phase 4: Services & utilities complete [L]

Decomposed 2026-06-12 (continuation run). Tranche structure: interface
first (protocol v11 + save v7), then the coverage/budget core with its
ground-truth property (exit criterion 2), then the service loops
(garbage/health/deathcare/education), pollution with downstream flow,
fire + dispatch-on-congested-network (exit criterion 1), presentation,
and the golden re-bless (exit criterion 3).

Phase law (ROADMAP §4): coverage is **road-network distance, never
euclidean** (pillar 2: bad roads = bad services); service vehicles are
**real trips** on the traffic model; every failure is diagnosable through
a cause chain (ADR-009).

| # | Task | Package | Spec | Size | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Protocol v11 + save v7: service building kinds (append-only BuildingKind — fire/police/health/deathcare/education/parks/telecom/garbage/sewage sets), ServiceId registry, `setServiceBudget` command (permille 500–1500), snapshot serviceCoverage block (active-overlay only, worker-held selection — presentation state never enters the sim), inspector buildingInfo (capacity/queue/effectiveness), SERVICES save section id 13 + BUILDINGS row append (stock/sick/corpses/fireTicks) with v6→v7 migration on archived fixtures | protocol | GDD §7, TDD §7/§10, ADR-006/010 | M | symmetric codec property tests; fixed byte-layout vectors (PROTOCOL_VERSION 11 tripwire); migration ladder v1→…→v7 green on archived fixtures | done (#58 — hash-neutral: sim rejects setServiceBudget as unknownCommand until task 2, goldens untouched; v7 fixture archives non-default budgets + a sparse pollution field; inspector answers building kind/level/status now, service fields zeroed until task 2) |
| 2 | Services core: per-service registry (radius/capacity/budget scaling, diminishing returns >100%), network-distance coverage fields (multi-source Dijkstra from station road anchors, version-fenced like utilities), budget slider state (canonical, hashed, saved), services tick step skeleton on rng.services | sim | GDD §7, TDD §4/§5, ADR-005 | L | **coverage ≡ Dijkstra ground truth property (exit criterion 2)** over random networks + stations; budget scaling units; hash-append re-pin + re-bless (balance-diff artifact); determinism: same seed+log ⇒ same hash with services on | done (#59 — coverage ≡ per-station Dijkstra oracle property at 25 runs/CI (held at 250 locally); euclid-vs-network and island-station demos; budget domain re-checked sim-side; layout-only bless: all 5 goldens hash-moved with byte-identical HUD scalars) |
| 3 | Service loops: garbage (generation by kind/level, truck rounds from landfill/incinerator/recycling, uncollected ⇒ desirability hit + advisor), health (sickness ← pollution + low coverage, treatment ← capacity×coverage), deathcare (age/sickness deaths → corpses → hearse dispatch → cemetery fill/crematorium; lingering corpses crash desirability), education (cohort tier transitions gated by seats: elementary/high/university; library boost). Service vehicle trips join OD generation (real trips — GDD §9 freight pattern) | sim | GDD §7/§8, ADR-002/005 | XL | per-loop units (generation/collection/death/enrollment conservation); service-trip conservation joins the ledger property; sickness↔pollution coupling unit; staggered-slice budget (tick cost flat); golden re-bless | pending |
| 4 | Pollution v1: ground field (industry/landfill legacy, slow decay — canonical), air (derived: industry + traffic volume, wind offset), noise (derived: road volume/class), **water pollution with downstream flow** (sewage outlets → water tiles → downhill/flow spread; polluted pump ⇒ citywide sickness event with outlet→river→pump cause chain) | sim | GDD §10, ADR-005/009 | L | downstream-flow determinism unit (flow follows elevation, tie-broken); polluted-pump scenario: sickness spike + resolving 3-link cause chain; ground-pollution persistence across save/load | pending |
| 5 | Fire + dispatch: ignition (rng.events), burn progress, tile-adjacent spread when response is late, ruin state; dispatch = nearest station with free truck routed on the **congested** cost field; truck trips load the network; extinguish on arrival | sim | GDD §7/§14 (core), §9 [LOCKED] congestion consequences | L | **exit criterion 1 differential test**: same fire, congested vs free corridor — late truck ⇒ spread, on-time ⇒ contained; advisor chain resolves fire→truck-delay→saturated-edge; spread determinism unit | pending |
| 6 | Presentation: per-service coverage overlays (paletted ramps, overlay selector), budget panel (sliders → setServiceBudget), advisor feed v1 **grouped by cause** (summaryKey groups, severity + count + jump), service building inspector (capacity/queue/effectiveness), fire/ruin building tints (v0 — sprites content-gated) | renderer+ui+app | GDD §15, TDD §8/§9, ADR-008/009 | L | overlay e2e (place station → overlay renders nonzero near it through the real worker); budget slider e2e (drag → snapshot reflects scaled coverage); advisor grouping RTL units | pending |
| 7 | Exit criteria + goldens: `services-city-01` golden (all services exercised), re-bless moved goldens with balance-diff ledger, balance bands extended (sickness, garbage backlog, education progression), board closeout | e2e | ADR-013 | M | all three ROADMAP exit criteria recorded as automated tests; balance gate green inside new bands; cross-engine determinism check on the new golden | pending |

**Exit criteria mapping:** fire-spreads-because-truck-late with cause
chain ← 5 · coverage ≡ network-distance ground truth (property) ← 2 ·
goldens re-blessed with services ← 7.

**Deliberately deferred (recorded, not glossed):** police/crime loop is
v1-minimal (coverage suppresses a derived crime pressure feeding land
value + advisor; full crime↔abandonment economics join Phase 5 land
value); parks/telecom are coverage-only desirability contributors
(sprites content-gated); helipad/HQ/large-station variants are data rows
in the registry, not new mechanics; service upkeep costs join the
Phase 5 budget cycle (sliders scale capacity/coverage now, money lands
with the economy); district budget overrides are Phase 6 (policies).

**Content gates (unchanged pattern):** service building sprites ride the
style-bible pipeline (Phase 0 criterion 3 / Phase 2 task 6); mechanics
ship against placeholder tints.
