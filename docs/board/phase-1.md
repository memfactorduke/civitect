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
| 2 | Camera: pan (pointer drag) / zoom (wheel + pinch) with world↔screen transform owned by a camera module; zoom-tier LOD skeleton (far/mid/near thresholds, no behavior yet); render-frame interpolation hook for the 120 Hz pan mode | renderer | TDD §8, ADR-008 | M | transform round-trip + clamp property tests; picking integrates camera transform; dev-harness manual check | — | in-review |
| 3 | Road graph module — standalone in sim (NOT yet referenced by World/tick, so no hash change): nodes/edges SoA, class/lanes/length/speed/capacity, versioned incremental mutations (add/remove/split), tile→edge index | sim | TDD §5 | M | mutation properties (add∘remove ≡ identity on serialized form); edge-version monotonicity units | — | done |
| 4 | ALT pathfinding (A* + landmark lower bounds) over the road graph + cache keyed by edge version with invalidation tests | sim | TDD §5 | M | equality-vs-Dijkstra-oracle property on random graphs; cache invalidation units; det-lint green | 3 | done |
| 5 | Road command vocabulary: buildRoad / bulldozeRoad / upgradeRoad / undo / redo + new rejection reasons; PROTOCOL_VERSION bump + wire pins | protocol | TDD §7 | S–M | symmetric codec property + fixed-vector pins | — | done |
| 6 | Map generator v1: seeded terrace/water/resource generation (integer noise, reproducible), 6 archetype maps committed as fixtures + preview PNGs via intake encoder | tools | TDD §13, GDD §3 | L | committed map hashes stable; maps decode via protocol; previews render | 1 | pending-approval |
| 7 | Terrain in World: u16 tile layers + accessors, map loading at worker boot, stateHash APPEND — **golden re-bless + tripwire re-pin (Mem)**; save format v2 (saves gain TERRAIN; v1→v2 migration injects flat terrain; v1 fixtures keep loading) | sim | TDD §4/§5/§10, ADR-010 | L | balance-diff bless report; migration fixture tests; units | 1 | approved |
| 8 | Roads in World: graph + commands wired into tick pipeline (validation, auto-intersect at crossings v0), undo/redo command application | sim | TDD §4/§5/§7 | L | property: build∘undo ≡ identity on state hash (exit criterion 3); first golden `roads-city-01` (new golden = agent-blessable) | 3, 5, 7 | approved |
| 9 | Chunked terrain rendering: 32×32-tile chunks baked to render textures, dirty-chunk re-bake from snapshot dirtyChunkIds, terrain/zone/road tints v0 | renderer | TDD §8, ADR-008 | L | bake/invalidate units (pure chunk math); dev harness on a generated map | 1, 2 | approved |
| 10 | Road tools end-to-end: drag→buildRoad command→sim→snapshot→chunk redraw; bulldoze; undo/redo binding; Playwright e2e | app + e2e | TDD §1/§7 | M | e2e: build 10 segments, undo all → state hash equals start | 8, 9 | approved |
| 11 | 500-segment network perf scenario on an L map: golden + render frame budget (exit criterion 1) joins the perf gate | e2e | TDD §2/§12 | M | perf gate green at 500 segments on L map | 8, 9 | approved |
| 12 | Follow-on batch (decompose when 1–11 land): intersections (auto signals/stops, roundabouts), bridges/tunnels, ped/bike paths, 120 Hz pan polish | — | ROADMAP P1 | XL | — | 10, 11 | pending-approval |

**Exit criteria → task mapping:** 500-segment network, zero dropped frames
← 11 · pathfinding correctness suite ← 4 · undo/redo property (build∘undo
≡ identity on state hash) ← 8.

**Codex parallelization candidates:** 6 preview-render styling; 9 tint
palettes — after 1/2 land interfaces.
