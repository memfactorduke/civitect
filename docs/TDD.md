# Civitect — Technical Design Document

**Version 0.1 · 2026-06-11 · Status: Living document**
Implements GDD v0.1 under ADR-001 (web-first TypeScript), ADR-002 (hybrid sim), ADR-003 (cloud sync), ADR-004 (isometric 2.5D). Structural choices are **[LOCKED]** unless an ADR supersedes; numbers are initial **[TUNE]**.

---

## 1. System architecture

Monorepo (pnpm workspaces). The wall that matters: **`sim` imports nothing from rendering or UI — ever** [LOCKED, ADR-006]. Everything else follows from keeping that wall intact.

```
civitect/
├─ packages/
│  ├─ sim/          Pure TS simulation core. Zero DOM, zero Pixi. Runs in Worker AND in Node (tests).
│  ├─ protocol/     Shared types + binary codecs for commands, snapshots, saves. The contract.
│  ├─ renderer/     PixiJS v8 world rendering. Consumes snapshots, knows nothing of rules.
│  ├─ ui/           React panels/HUD. Talks to sim only via protocol commands.
│  ├─ app/          Composition root: boot, worker management, scenes, settings, save manager.
│  ├─ backend/      Supabase config, edge functions, sync client (ADR-011).
│  └─ assets/       Atlas manifests, generated sprite metadata (binary atlases in CDN/app bundle).
├─ tools/           Map generator, atlas packer, sim inspector, balance dashboards (web apps).
├─ docs/            This corpus.
└─ e2e/             Playwright device-profile runs + golden-city suite.
```

**Runtime topology:** Main thread = renderer + UI + input. Dedicated **Web Worker = entire simulation**. Communication via `protocol` messages (§7). Renderer never computes game logic; sim never formats for display.

```
[input] → UI(React) → CommandQueue ──postMessage──▶ SimWorker (10Hz fixed tick)
                ▲                                        │
        [panels, HUD]                                    ▼
[PixiJS renderer] ◀──transferable snapshot/diffs── SnapshotEncoder
```

---

## 2. Performance budgets [LOCKED as gates, values TUNE]

**Device floor:** iPhone 15 Pro (A17 Pro, 8GB) / 2023+ Android flagship (SD 8 Gen 2-class, 8GB+) / 2020+ desktop in evergreen browser. We do **not** budget for older devices; if it happens to run, fine.

| Budget | Target (floor device) | Hard gate (CI fails) |
|---|---|---|
| Sim tick p95 (L map, 250k pop, 10k agents) | ≤ 10 ms | 20 ms |
| Sim tick p95 at 9× speed (90 ticks/s) | sustained without governor on desktop; ≥6× on phone | — |
| Render frame p95 (street zoom, downtown) | ≤ 8 ms (60fps + headroom) | 16 ms |
| 120Hz pan/zoom mode (ProMotion) | camera-only interpolation at 120, sim view at 60 | — |
| Input→visual response (tool placement) | ≤ 50 ms | 100 ms |
| Cold start → main menu | ≤ 2.5 s app / ≤ 4 s web cold | — |
| Load L-map save | ≤ 3 s | 6 s |
| Memory steady-state (L map) | ≤ 1.2 GB | 1.8 GB |
| Initial web payload (code, gz) | ≤ 8 MB | 15 MB |
| Full asset set (lazy, per-resolution) | ≤ 160 MB | — |
| Battery: 30-min session thermal | no governor below 6× on iPhone 15 Pro | — |

Perf harness (§12) replays golden cities headlessly per PR; device runs weekly on a physical mini-farm (your phone + desktop + BrowserStack as needed).

**Live agent pool scaling:** 10k phone / 25k desktop default; degrades gracefully to 5k (LOD: distant agents become flow-field particles). Pool size is a settings slider — never a correctness input (cohorts are truth; ADR-002).

---

## 3. Determinism contract [LOCKED — ADR-005]

Same seed + same command log ⇒ **bit-identical** world state on every platform. This enables: golden-master tests AI agents run autonomously, time-travel debugging, replay-verified leaderboards later (ADR-003), and cloud-sync integrity checks.

Rules (enforced by lint rules + the determinism CI suite):

1. **No floating-point transcendentals in sim.** `Math.sin/cos/exp/log/pow` are implementation-defined → banned in `packages/sim` (ESLint rule). Use integer math, fixed-point (Q16.16 where fractional accumulation is needed), and shared lookup tables. Plain float `+ - * /` are IEEE-754-exact and allowed where order is fixed.
2. **Money is integer cents.** All economy accumulation in integers. [LOCKED]
3. **Seeded PRNG only:** PCG32 (integer ops, `Math.imul`-based), one stream per system (traffic, growth, agents…) so systems can be re-run independently. `Math.random` banned in sim.
4. **Fixed iteration order:** no object-key iteration over sim state; all hot state lives in typed arrays with explicit indices (§4); any map iteration sorts keys first.
5. **No wall clock** (`Date.now`, `performance.now`) inside sim; the tick counter is time.
6. **Command log:** every player action is a serialized command with the tick it applies on. A save = snapshot + (optionally) command tail. A bug report = seed + command log = perfect repro.

---

## 4. Simulation core

### Tick pipeline (10 Hz, 1 tick = 1 game-minute)

Fixed order [LOCKED]; each system is a pure function over the store + its PRNG stream:

```
applyCommands → networks(power,water) → buildings(growth/decay, staggered 1/60th per tick)
→ cohorts(lifecycle hourly slice) → economy(accrual; monthly close on tick boundary)
→ trafficIncremental → agents(move, spawn/recycle) → services(queues)
→ pollution/landValue(dirty regions) → events/advisors → snapshotEncode(if frame due)
```

Heavy systems are **staggered**: each tick processes a deterministic slice (e.g., 1/60th of buildings), so per-tick cost is flat and budgets hold at every speed.

### Data layout: structure-of-arrays tables [LOCKED]

No entity objects in hot paths. Each domain is a table of parallel typed arrays with a free-list:

```ts
// e.g. buildings table (≈40 bytes/building × 50k buildings ≈ 2 MB)
type Buildings = {
  count: number; freeHead: number;
  tileIdx: Uint32Array; kind: Uint16Array; level: Uint8Array; flags: Uint8Array;
  cohortOffset: Uint32Array;   // into cohort block store
  powerNeed: Uint16Array; waterNeed: Uint16Array; jobsByTier: Uint16Array/*×4*/;
  // ...
}
```

Cohorts: per-building fixed-size block (age×education×status counts as Uint16) in one contiguous buffer — the entire demography of a 1M city is a few MB and iterates linearly (cache-friendly, GC-silent).

Tile fields (land value, 4 pollutions, noise, coverage per service) are flat `Float32Array/Uint8Array` per layer with **dirty-region** incremental recompute (build actions mark regions; full settle daily).

---

## 5. World & networks data model

- **Tile grid:** `Uint16Array` terrain (elevation terrace, water, resource, zone, district id per layer). L map 512² = 262k tiles; all layers ≈ 12 MB.
- **Road graph:** separate from tiles — `nodes` (intersections, dead-ends) + `edges` (segments with class, lanes, length, speed, capacity, control type). Tiles store `edgeId` for picking. Graph mutations (build/bulldoze) are incremental with versioning; pathfinding caches invalidate by edge version.
- **Power/water:** union-find connectivity over network tiles + per-component supply/demand ledgers; recompute on mutation only. Sub-graph capacity (water pressure) at district granularity.
- **Pathfinding:** A* with landmarks (ALT) over the road graph for agents/service vehicles; transit routing layered (walk→stop→line graph→stop→walk). Contraction hierarchies as escape hatch if profiling demands (ADR-001 hatch applies to algorithms too).

---

## 6. Traffic engine (ADR-002 hybrid)

1. **Trip generation** (hourly): cohort tables × purpose rates → OD demand by (origin zone-cell, destination zone-cell, purpose). Zone-cells = 8×8-tile aggregation → OD stays small (≤ ~4k cells on L).
2. **Mode choice:** logit over generalized cost (time + monetary + transfer penalty) for walk/bike/transit/car per OD pair. Capped car-ownership factor from wealth/policies.
3. **Assignment:** Method of Successive Averages over edge costs with BPR volume-delay `t = t0·(1+α(v/c)^β)`, α=0.15, β=4 [TUNE]; full equilibrium solve daily (4:00), incremental MSA step hourly; solver runs in fixed work slices across ticks to respect the tick budget. Network edits re-derive congested costs immediately and join demand at the next hourly step — the originally-specced event-driven mid-hour re-solve was cut in Phase 3 tranche 2: it makes traffic state depend on edit timing, which breaks the Phase 1 exit criterion `build∘undo ≡ identity` on the state hash (volumes are canonical, keyed by canonical edge identity). Revisit as an ADR if responsiveness demands it.
4. **Edge state out:** volume/capacity, speed, queue length → renderer tints, land value noise input, service response times, travel-time matrix for job matching (sampled, cached).
5. **Live agents:** sampler draws journeys ∝ OD flows visible near camera + pinned cims; vehicles follow edge speeds with simple car-following spacing (visual), pedestrians walk paths. Agents carry `cohortRef` so inspection reconstructs a stable persona (seeded by building + slot — same person while observed; GDD §17.5).
6. **Transit:** lines as ordered stop lists; vehicle agents loop with capacity; boarding from stop queues fed by mode choice; per-line ledger (riders, cost, fare) daily.

**Verification hooks:** conservation checks (trips generated = assigned ± tolerance), equilibrium gap metric exported to the balance dashboard; both asserted in golden tests.

---

## 7. Worker protocol [LOCKED interfaces, ADR-006]

- **Commands (UI→sim):** versioned binary structs (protocol package owns codecs): `{tick, type, payload}` — build road, zone rect, set budget, etc. Optimistic UI ghosts; sim is authoritative, rejects invalid (insufficient funds) with reason codes.
- **Snapshots (sim→render):** per render-frame *delta* of visible state: dirty tile-chunk ids, building sprite states, agent transform buffer (`Float32Array` ring, transferable), HUD scalars, advisor events. Full keyframe on scene load / camera jump. Transferables (zero-copy `postMessage`) as baseline; **SharedArrayBuffer fast path** (agent transforms) enabled where cross-origin isolation allows (Capacitor: yes via custom scheme headers; web: COOP/COEP configured; graceful fallback) [TUNE after device profiling].
- **Inspector queries:** request/response with stable ids (`buildingId`, `agentId`, `edgeId`) — panels poll at 4 Hz while open, not per-tick.
- Protocol version stamped in every message; mismatch = hard error at boot (no silent drift between deployed web sim worker and cached shell).

---

## 8. Rendering (PixiJS v8) [ADR-008]

- **Renderer:** WebGL backend at launch (Pixi's production guidance), WebGPU flag-gated for later. Antialias off; devicePixelRatio capped at 2 phone / 2 desktop [TUNE].
- **World composition:** screen-space chunked **static layer** — 32×32-tile chunks of terrain/roads/zones baked to cached render textures, re-baked on dirty; **building layer** sprite-batched from atlases with iso depth sort key `(y, x, layer)` precomputed per placement (static buildings don't resort per frame); **agent layer** instanced/batched sprites updated from the transform buffer; **overlay layer** (data heatmaps) as paletted textures generated from sim fields; **effects** (fire, smoke, weather) particle containers, budget-capped.
- **Culling:** chunk-level frustum culling; agents only instantiated within expanded camera bounds (sampler is camera-aware, §6.5).
- **Zoom LOD:** 3 tiers — far (chunk textures only, agents as flow particles), mid (buildings full, agents simplified), near (full detail + citizen sprites). Transitions crossfade.
- **Day/night:** color-grade LUT swap + emissive window/streetlight layer (separate atlas channel), driven by sim clock.
- **Atlases:** 2048² pages, per-category (terrain/roads, R buildings, C/I/O, services, agents, fx, UI icons) at 1×/2×/3×; category pages lazy-load (web) with placeholder silhouettes. Packing via assetpack in `tools/` (ADR-012).

---

## 9. UI layer [ADR-009]

- **React 19 DOM overlay** above the Pixi canvas (panels, HUD, menus — text-heavy work where DOM accessibility/layout wins). State: zustand stores fed by snapshot scalars + inspector responses; UI dispatches protocol commands only.
- Panel system: bottom-sheet (phone) / docked side panels (desktop) from the same components; CSS container queries for density adaptation.
- Causal-link inspector (GDD §15) is a generic component over `CauseChain` protocol payloads — sim systems emit cause graphs; UI renders them tappable. **Every sim system must emit cause metadata** for its warnings [LOCKED — this is pillar-2 enforcement at the type level: advisor events without cause chains fail type-check].
- Accessibility: color-blind-safe overlay ramps (verified via simulation in CI snapshot tests), dynamic type scaling on phone, full keyboard map on desktop, reduced-motion mode.
- Localization-ready from day one: all strings through i18n keys (ship English; structure costs nothing now, retrofit costs weeks).

---

## 10. Save format & cloud sync [ADR-010, ADR-011]

### File format `(.civ)`
Binary, little-endian, sectioned:

```
Header: magic 'CIVT' | formatVersion u16 | simVersion u16 | seed u64 | tick u64
        | mapId | checksums (xxhash64 per section) | flags
Sections (each: id u16 | compressedLen u32 | rawLen u32 | bytes):
  TERRAIN (RLE)  ROADS (graph serial)  BUILDINGS (table dump)
  COHORTS (quantized u16 blocks)  NETWORKS  ECONOMY  POLICIES/DISTRICTS
  AGENTPINS (favorited cims only)  SETTINGS  COMMANDTAIL (since last keyframe)
```

Section ids are append-only: 1–10 in the order listed above, **11 = WORLDCORE**
(Phase 0: speed, selection, map dims, funds, population, RNG stream states —
the whole pre-systems world), **12 = TRAFFIC** (Phase 3: persistent MSA
volumes + sliced-solver job state in canonical edge order; formatVersion 5).
System sections take over fields from WORLDCORE
as their systems land; each takeover is a formatVersion bump with a migration.
Checksums cover the RAW (uncompressed) section payload, so a verified load
proves storage, transport, and decompression end-to-end.

- Compression: `CompressionStream('deflate-raw')` native; fflate fallback. L-map save ≈ 1–4 MB.
- **Versioning:** `formatVersion` bumps on layout change with explicit migration functions (`migrations/v3_v4.ts`), tested against archived fixture saves of every prior version [LOCKED]. `simVersion` records rules version: loading an older-rules save replays cleanly because state is snapshot, not replay (command tail discarded across simVersion bumps).
- Autosave: rolling 3 slots, on background/quit + every 5 game-days; crash recovery offers newest valid (checksum-verified) save.

### Cloud sync (Level 1, ADR-003/011)
- **Supabase:** Sign in with Apple + Google; saves as Storage blobs; Postgres rows for metadata `{cityId, deviceId, generation, simVersion, thumbnailUrl, updatedAt}` with RLS per-user.
- **Conflict policy:** generation counter; push increments, pull compares. Divergence (offline edits on two devices) → "keep both" fork prompt with thumbnails/timestamps. No merging [LOCKED — single-player saves, LWW + fork is correct].
- Offline-first: queue sync ops; no feature gates behind connectivity. Account deletion = cascade delete (store compliance).

---

## 11. Asset pipeline (technical contract — workflow in AI-WORKFLOW, specs in ADR-012)

- Source sprites: PNG at 3× (largest), mip-derived 2×/1× via tooling (consistent downscale kernel) — never AI-upscaled.
- Tile metric: 64×32 px at 1× (2:1 iso). Building footprints 1×1…8×8 tiles; sprite anchor at footprint center-bottom; max height 4× footprint width [TUNE].
- Every sprite ships with metadata sidecar (footprint, anchor, emissive mask ref, state variants) — JSON schema in `protocol`; atlas packer validates (wrong-size/missing-state assets fail the build, not the game).
- Palette governance: master 64-swatch ramp set; CI rejects sprites whose quantized palette deviates beyond threshold (keeps mixed AI batches coherent — the #1 risk of AI-generated art is style drift; we gate it mechanically).

---

## 12. Testing & quality [ADR-013]

The strategy exists so AI agents can verify their own work without a human eyeballing a running game:

1. **Golden-master cities:** ~12 scripted cities (seed + command log) replayed headlessly in Node per PR; final state hashes must match committed hashes bit-exactly (determinism + regression in one). Rule changes regenerate goldens via explicit `--bless` with diff report (the balance diff *is* the code review artifact).
2. **Property tests** (fast-check): conservation laws — population in = out across migrations; money conservation across transactions; trips generated = assigned; no NaN/∞ in any field after 10k random command fuzz.
3. **Balance simulations:** parameterized scenario runner ("zone R only", "no transit at 100k") with assertion bands (unemployment between X–Y by year 5) — catches "economy explodes" classes of bug. Outputs plots to the balance dashboard for human review.
4. **Diagnosability gates:** scripted failures (bankruptcy, abandonment, congestion, polluted water) must emit advisor cause chains whose subjects resolve to current world state — this automates the GDD §17 "no opaque failure" promise.
5. **Perf gates:** golden-city replay measures tick p95 in CI (normalized machine), fails on budget breach (§2 gates). Render perf: Playwright traces on device profiles weekly.
6. **Unit/component:** Vitest for sim systems (pure functions — trivially testable by design); React Testing Library for panels; Playwright e2e smoke (boot → build road → zone → save → load → verify).
7. **Determinism cross-check:** same golden replays run in Chromium/WebKit/Node weekly; hashes must agree (catches engine float/JIT surprises — the §3 rules make this pass; the test keeps us honest).

---

## 13. Developer tooling (`tools/`, all web apps — AI agents can extend them)

- **Sim inspector:** load any save/replay, scrub the timeline (deterministic re-sim = free time travel), inspect any table row, diff two ticks.
- **Balance dashboard:** plots from balance sims (demand curves, cash flow, demographics pyramids) per branch vs main.
- **Map generator:** seeded terrain/resource/wind generation with archetype presets; exports map files + preview renders for the catalog (GDD §3).
- **Atlas packer + sprite linter:** ADR-012 contract enforcement.
- **Replay theater:** render any bug-report replay in-browser with overlay scrubbing.

---

## 14. Error handling, recovery, telemetry

- Sim exceptions: tick wrapped; on throw — snapshot quarantine save, error + last 200 commands captured locally, sim pauses with user-facing "paused due to error" (never silent corruption). [LOCKED]
- Renderer/WebGL context loss: automatic context restore + atlas re-upload (standard Pixi handling, tested in e2e).
- Telemetry: **opt-in**, anonymous, no PII: device class, perf percentiles, crash payloads (seed+commands hash, not content), feature usage counters. Local perf HUD toggle for development and bug reports. Privacy policy covers it (ADR-011 compliance).

---

## 15. Security & privacy

- No secrets in client. Supabase RLS per-user; storage paths user-scoped; rate limits on sync endpoints.
- Auth tokens in platform secure storage (Capacitor) / httpOnly-adjacent best practice (web).
- Save files are local user property — import/export always available (no lock-in, also the offline cross-device path).
- Future leaderboards: replay verification design reserved (determinism §3 makes server re-sim possible); no client trust ever required.

---

## 16. Risks & escape hatches

| Risk | Likelihood | Mitigation / hatch |
|---|---|---|
| Traffic solver blows tick budget on L maps | Medium | Solver already sliced/async; hatch: Rust→WASM port behind same interface (ADR-001) — pathfinding/MSA are the designated candidates |
| iOS WebView memory ceiling under 3× atlases | Medium | Resolution-tier assets (2× cap on phone), category lazy-load, §2 memory gate watches it |
| SAB cross-origin isolation friction | Medium | Transferable-baseline protocol works everywhere; SAB is purely additive fast path |
| Cohort↔agent visual contradictions (pillar 1 break) | Medium | Reconciliation sampler owns ALL agent instantiation (single chokepoint); "follow test" (GDD §17.5) in e2e |
| AI-generated art style drift | High | Mechanical palette/spec gates (§11) + style bible + seed-image conditioning (AI-WORKFLOW) |
| Scope: "entire game" stall risk | High | Roadmap phases are vertical slices each ending playable + gated (ROADMAP); corpus keeps scope explicit |

---

*Decisions: `adr/` · Build order: `ROADMAP.md` · Agent operations: `AI-WORKFLOW.md`*
