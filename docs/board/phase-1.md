# Board — Phase 1: World & roads [L]

Decomposition per AI-WORKFLOW §2/§3 (one package, runnable verification,
≤ a session). Scope + exit criteria: `docs/ROADMAP.md` Phase 1.
Drafted by Claude Code in the 2026-06-12 overnight run — statuses reflect
that session; Mem blesses the decomposition itself on morning review.

**Status legend:** `pending-approval` · `approved` · `in-progress` ·
`in-review` · `done` · `parked`

**The bless choke point:** task 7 appends terrain to the World state hash —
that re-blesses `empty-city-01` and re-pins the sim tripwire hashes, which
is **Mem-only** (overnight merge policy). Everything stacking on 7 parks
behind it; tasks 1–6 are deliberately bless-free and land first.

| # | Task (one package each) | Package | Spec | Size | Verification | Depends on | Status |
|---|---|---|---|---|---|---|---|
| 1 | Terrain section codec (RLE over u16 layers: elevation terrace, water, resource, zone, district) + map file = .civ container with TERRAIN only (`encodeMap`/`decodeMap`); map fixture seeded | protocol | TDD §5/§10 | M | RLE + map round-trip property tests; fixture decode pin | — | done |
| 2 | Camera: pan (pointer drag) / zoom (wheel + pinch) with world↔screen transform owned by a camera module; zoom-tier LOD skeleton (far/mid/near thresholds, no behavior yet); render-frame interpolation hook for the 120 Hz pan mode | renderer | TDD §8, ADR-008 | M | transform round-trip + clamp property tests; picking integrates camera transform; dev-harness manual check | — | done |
| 3 | Road graph module — standalone in sim (NOT yet referenced by World/tick, so no hash change): nodes/edges SoA, class/lanes/length/speed/capacity, versioned incremental mutations (add/remove/split), tile→edge index | sim | TDD §5 | M | mutation properties (add∘remove ≡ identity on serialized form); edge-version monotonicity units | — | done |
| 4 | ALT pathfinding (A* + landmark lower bounds) over the road graph + cache keyed by edge version with invalidation tests | sim | TDD §5 | M | equality-vs-Dijkstra-oracle property on random graphs; cache invalidation units; det-lint green | 3 | done |
| 5 | Road command vocabulary: buildRoad / bulldozeRoad / upgradeRoad / undo / redo + new rejection reasons; PROTOCOL_VERSION bump + wire pins | protocol | TDD §7 | S–M | symmetric codec property + fixed-vector pins | — | done |
| 6 | Map generator v1: seeded terrace/water/resource generation (integer noise, reproducible), 6 archetype maps committed as fixtures + preview PNGs via intake encoder | tools | TDD §13, GDD §3 | L | committed maps content-equal on regeneration; archetype sanity suite; previews committed | 1 | done |
| 7 | Terrain in World: u16 tile layers + accessors, map loading at worker boot, stateHash APPEND — **golden re-bless + tripwire re-pin (Mem)**; save format v2 (saves gain TERRAIN; v1→v2 migration injects flat terrain; v1 fixtures keep loading) | sim | TDD §4/§5/§10, ADR-010 | L | balance-diff bless report; migration fixture tests; units | 1 | parked — AWAITING MEM BLESS (PR #23) |
| 8 | Roads in World: graph + commands wired into tick pipeline (validation, auto-intersect at crossings v0), undo/redo command application | sim | TDD §4/§5/§7 | L | property: build∘undo ≡ identity on state hash (exit criterion 3); first golden `roads-city-01` (new golden = agent-blessable) | 3, 5, 7 | parked — stacked on 7 bless (PR #24, green) |
| 9 | Chunked terrain rendering: 32×32-tile chunks baked to render textures, dirty-chunk re-bake from snapshot dirtyChunkIds, terrain/zone/road tints v0 | renderer | TDD §8, ADR-008 | L | bake/invalidate units (pure chunk math); dev harness on a generated map | 1, 2 | done (incl. #27 hotfix: no texture cache on the no-terrain grid — CI software-GL latency) |
| 10 | Road tools end-to-end: drag→buildRoad command→sim→snapshot→chunk redraw; bulldoze; undo/redo binding; Playwright e2e | app + e2e | TDD §1/§7 | M | e2e: build 10 segments, undo all → state hash equals start | 8, 9 | approved |
| 11 | 500-segment network perf scenario on an L map: golden + render frame budget (exit criterion 1) joins the perf gate | e2e | TDD §2/§12 | M | perf gate green at 500 segments on L map | 8, 9 | approved |
| 12a | Road rendering: protocol v4 snapshots (roadVersion + segment list) + renderer road layer + device frame-budget harness — pulled forward (bless-free, completes exit criterion 1's render half) | protocol+renderer+e2e | TDD §7/§8 | M | device-measured: p95 10.1 ms < 16 ms, zero frames >33 ms over a rendered 500-segment L-map pan | 2, 9 | done (#30+#31) |
| 12b | Real road data in snapshots: sim toSnapshot canonical segments keyed on graph version; worker sends on mutation | sim+app | TDD §7 | S | units: keyframe carries segments, idle deltas null | 8, 12a | parked — stacked on 8 (PR #32, green) |
| 12c | Drag-to-build road tool UX (ghost preview, optimistic rejection rollback) + chunk-level road tinting | renderer+app+ui | TDD §7/§8/§9 | M | e2e: drag builds a polyline; ghost clears on rejection | stack landed | pending-approval |
| 12d | Intersections: auto signals/stops by class meeting, roundabout pieces; segment splitting at crossings | sim (+protocol if new commands) | ROADMAP P1, TDD §5 | L | golden `intersections-01`; crossing-split property tests | stack landed | pending-approval |
| 12e | Bridges/tunnels: water/elevation crossing validation + cost class; ped/bike path class | sim+protocol | ROADMAP P1 | L | validation rejections property-tested; golden extension | 12d | pending-approval |
| 12f | Save format v3: ROADS section (canonical graph serial) + v2→v3 migration; lifts the saves-with-roads refusal | protocol+app | TDD §10, ADR-010 | M | migration fixtures; save→load→hash-equal with roads | stack landed | done (#34) |
| 12g | 120 Hz pan polish: ProMotion frame-rate-aware blend into the camera's render() hook | renderer | ADR-008 | S | 60↔120 Hz trajectory-equivalence property; device feel check remains Mem | — | in-review |

**Exit criteria → task mapping & status (2026-06-12):**
1. 500-segment network, zero dropped frames — **sim half PASS** (#25 parked:
   tick p95 0.0001 ms); **render half PASS, device-measured** (12a harness:
   p95 10.1 ms < 16 ms, zero frames >33 ms, camera panning a rendered
   500-segment L map). Both automated; the spec asserts the 16 ms budget on
   hardware (CI software-GL is excluded per TDD §12.4 device cadence).
2. Pathfinding correctness suite — **PASS, merged** (#18).
3. build∘undo ≡ identity on state hash — **PASS** (#24 parked, property).

Phase 1 completion = Mem lands the parked stack (#23 ← #24 ← {#25, #32})
and approves the 12c–12g batch + task 11b's image library. All code that
could move without those judgments has moved.

**Codex parallelization candidates:** 6 preview-render styling; 9 tint
palettes — after 1/2 land interfaces.
