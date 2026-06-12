# Overnight report — 2026-06-12 (Claude Code autonomous run)

Brief: drive Phase 0 to completion and into Phase 1 as far as the gates
allow, PR by PR, under the standing merge policy (self-merge only when the
full ladder + CI are green and no human judgment is involved).

**Result (final, ~07:00): Phase 0 code-complete; Phase 1 driven to the
limit of what the gates allow without you** — every bless-free task is
merged (#4–#22, #26, #27); everything hash-moving is built, green, and
parked as a three-deep stacked PR chain awaiting your bless (#23 ← #24
← #25). Remaining Phase 1 items are all Mem-gated: the bless, two slice
approvals (map generator, follow-on batch), and the image-library pick.

---

## Phase 1 continuation (second half of the night)

| PR | Status | One-liner |
|---|---|---|
| #21 | merged | Camera: pan/zoom transform (anchor-invariant zoom, property-tested), LOD tier skeleton, 120 Hz interpolation hook; picking inverts the live camera |
| #22 | merged | Save format v2: saves carry TERRAIN; first ADR-010 migration (v1→flat-terrain injection); v1 fixture exercises the ladder forever |
| #23 | **PARKED — your bless** | Terrain in World: stateHash appends the five layers; tripwires re-pinned; empty-city re-blessed `9d4a7831…` with HUD identical (pure serialization move); balance-diff is the review artifact |
| #24 | **PARKED — stacked on #23** | Roads in World: v3 commands in the tick pipeline, session-local undo/redo. **Exit criterion `build∘undo ≡ identity on state hash` passes** (property, 60 runs). Second hash append (re-pin + re-bless, HUD identical); first golden `roads-city-01` |
| #25 | **PARKED — stacked on #24** | 500-segment L-map golden through golden+perf gates (**tick p95 0.0001 ms**) + roads e2e through the real worker (undo depth exact, rejects observed). Render-frame half of exit criterion 1 awaits road rendering — recorded, not glossed |
| #26 | merged | Chunked terrain rendering: 32×32 baked chunks, dirty re-bake wired to snapshot dirtyChunkIds, v0 tints, dev-harness island |
| #27 | merged (hotfix) | #26 regressed CI tap latency 35-44→227 ms (software-GL render-texture sampling); fix: texture-cache only terrain chunks. **Main was red for ~6 min** — see incident 2 |

### Phase 1 exit criteria status

1. **500-segment network, zero dropped frames** — sim half PASSES in parked #25 (tick p95 0.0001 ms vs 20 ms gate, in the per-PR perf gate once merged); render-frame half is unmeasurable until road RENDERING exists (follow-on task 12; board says so).
2. **Pathfinding correctness suite** — **PASSES, merged** (#18: oracle-equality property vs Dijkstra, 120 random networks).
3. **Undo/redo property (build∘undo ≡ identity on state hash)** — **PASSES** in parked #24.

### The parked stack, and how to land it

Read #23's balance-diff (hash moves, HUD identical) → merge #23 → retarget #24 to main (BEFORE deleting the 7b branch — the stacked-PR gotcha) → merge #24 (its diff: second hash move + the new roads golden) → retarget #25 → merge. Each level is fully green including the Chromium+WebKit cross-check.

### Incident 2 (mine, with the fix)

#26 merged while its CI was still running: my merge pattern piped `gh pr checks` through `head`, which masks the pending/fail exit status — so "check then merge" silently became "merge regardless". Sixteen PRs got lucky; #26 didn't (the smoke gate caught a real 5× input-latency regression on software GL) and main was red ~6 minutes until #27. Fixed both: the regression (texture-cache only terrain chunks, rationale + measurements pinned in stage.ts) and the procedure (`gh pr checks --watch`, merge only on verified pass). Recommend branch protection requiring the gate ladder so a bad merge pattern can never do this again — one checkbox in repo settings.

## Merged PRs — Phase 0 half (chronological, all CI-green)

| PR | One-liner |
|---|---|
| #4 | Golden + perf harness (`@civitect/e2e`): first golden `empty-city-01` blessed — independently reproduced the sim tripwire hash `bb15b4106250fb2f`; golden + perf gates unstubbed; bless flow + balance-diff report |
| #5 | Renderer shell: Pixi v8 boot (WebGL, DPR≤2), iso transforms (property-tested picking), snapshot→display projection, Vite dev harness |
| #6 | UI shell: React 19 overlay, zustand vanilla-store/hook split, `CommandIntent` dispatch seam (UI never stamps seq/tick), i18n keys, RTL tests; jsdom opt-in per file |
| #7 | App round trip: sim worker (envelope-only traffic), worker re-stamps + immediate command ticks, Playwright smoke in CI. **Tap→highlight median 1.8 ms vs 50 ms target** |
| #8 | `.civ` save codec: sectioned container, RAW-byte xxh64 checksums (impl verified against python-xxhash on all code paths), WORLDCORE section id 11 (TDD §10 edited in-PR), fixture archive seeded |
| #9 | Protocol v2: saveRequest/saveResponse/loadRequest/loadResponse kinds; wire pins re-stamped deliberately |
| #10 | Save manager: quicksave/quickload through the worker; save→load→state-hash-equal proven in Node + Playwright. **Fixed a real integration bug the e2e caught**: keyframes must apply at older ticks (save-load rewind) — last-tick-wins now applies to deltas only (renderer + ui, one line each + regression tests) |
| #11 | Sprite sidecar schema (protocol): strict parser-as-schema, append-only category/state registries, 14 validation units |
| #12 | Determinism cross-check: same runner module in Chromium + WebKit must reproduce the committed Node hash; weekly workflow unstubbed and **proven green via workflow_dispatch (run 27396517146)** |
| #13 | Sprite-intake gates (tools): dimension/anchor/footprint/state/palette validators, zero-dep PNG codec (decoder cross-validated against Python zlib on all 5 filter types), asset gate unstubbed; provisional 64-swatch palette |
| #14 | Board: Phase 0 exit-criteria verification recorded |
| #15 | Board: Phase 1 decomposition (12 tasks; bless choke point isolated as task 7) |
| #16 | Phase 1.1: terrain RLE codec + `.civmap` map files; container extracted so saves/maps share one layout; map fixture archived |
| #17 | Phase 1.3: road graph — SoA nodes/edges, free-lists, two-level mutation versioning (global fence + per-slot), canonical form; add∘remove≡identity property |
| #18 | Phase 1.4: ALT pathfinding — A* + landmark bounds, version-keyed cache; oracle-equality property vs Dijkstra (120 random networks); deterministic paths, not just costs |
| #19 | Phase 1.5: road command vocabulary (protocol v3) — build/bulldoze/upgrade by tile pair, undo/redo as sim commands; sim `unknownCommand` guard + `noImplicitReturns` enabled repo-wide |

## Phase 0 exit criteria (recorded in `phase-0.md`)

1. **PASS** — empty-city 1-game-year golden: `bb15b4106250fb2f` in Node, Chromium, and WebKit (local + Weekly CI run).
2. **PASS** — tap→highlight round trip: medians 1.8 ms / 0.4 ms vs the 50 ms target (CI enforces the 100 ms TDD §2 hard gate per-PR).
3. **PENDING CONTENT** — 12 style-bible sprites through the gates: gates live + negative-tested; waiting on the Codex batch + your curation.

## Parked / awaiting your judgment

- **Board 11b (sprite-intake processing chain)** — parked on your image-library pick (sharp vs pngjs vs assetpack-plugins). The gates don't block on it; the zero-dep PNG codec is the single swap point.
- **Phase 1 task 7 (terrain in World)** — THE golden re-bless + tripwire re-pin + save-format v2 migration. Mem-only per policy; deliberately not started so you get it as one clean reviewable bless rather than a 4 a.m. one. Tasks 8/10/11 stack behind it.
- **Palette swatches** — provisional 8×8 ramp set committed; swapping in the blessed style-bible palette is yours (one JSON file).
- **Pause semantics nuance** (PR #7 description): commands apply via an immediate tick even at speed 0 — that's how unpause works and selection stays live while paused, but if you want hard pause for non-setSpeed commands it's a two-line worker change.
- **Protocol design calls made without you** (all flagged in their PRs, all append-only/cheap to revise): worker re-stamps command ticks (#7); save/load message shapes (#9); tile-pair road addressing + sim-side undo (#19); PROTOCOL_VERSION bumps on vocabulary additions (#9/#19).

## Blocked

None — nothing hit the 3-attempt rule; `BLOCKED.md` was never needed.

## Incident worth reading (process, not code)

Mid-session, Codex's style-bible run executed `git checkout` in the shared
working tree — HEAD silently moved to its branch (based on stale main) and
node_modules was pruned against the old lockfile. No work lost (remote was
complete; uncommitted files survive checkout), but it's structural: git
branch state is per-TREE, and ADR-014's package-level concurrency rule
doesn't cover that. Everything from PR #11 on was built from a dedicated
worktree at `Projects/Civitect-worktree-overnight` (remove with
`git worktree remove` when convenient — but see recommendation below).

## Recommended next three items (updated, end of night)

1. **Land the parked stack**: read two balance-diffs (#23, #24 — both
   show hash-only moves with identical HUDs), merge top-down with the
   retarget-before-delete dance described above. ~15 minutes, unlocks
   everything.
2. **Turn on branch protection** (require the ADR-013 gate ladder to
   merge) + the AI-WORKFLOW §1 worktree rule — the night's two incidents,
   each one checkbox/paragraph from impossible.
3. **Approve the two pending slices**: task 6 (map generator — needed for
   real maps and the map-selection boot flow) and task 12's decomposition
   (intersections, bridges, ped/bike, road RENDERING + drag-to-build UX,
   save v3 ROADS section — road rendering also completes exit criterion
   1's render half). Pick 11b's image library when convenient.

## State of the gates (none weakened, three made real)

lint / det-lint / wall / typecheck / unit: live (det-lint caught a real
`Object.values` in pathfinding; `noImplicitReturns` added repo-wide) ·
golden: **REAL** (#4) · perf: **REAL** (#4) · assets: **REAL** (#13) ·
e2e smoke: added to CI (#7) · determinism cross-check: **REAL**, weekly +
dispatchable (#12) · balance: stub (Phase 2, as planned).
