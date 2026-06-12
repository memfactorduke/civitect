# Overnight report — 2026-06-12 (Claude Code autonomous run)

Brief: drive Phase 0 to completion and into Phase 1 as far as the gates
allow, PR by PR, under the standing merge policy (self-merge only when the
full ladder + CI are green and no human judgment is involved).

**Result: Phase 0 is code-complete with both code-side exit criteria
passing. Phase 1 is decomposed and 4 of its 12 tasks are merged.**
16 PRs landed (#4–#19), all gates green, zero gate erosion, nothing red on
main at any point.

---

## Merged PRs (chronological, all CI-green)

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

## Recommended next three items

1. **Phase 1 task 7 — the terrain bless.** Everything stacks behind it
   (roads-in-World, terrain rendering, the 500-segment perf criterion).
   It's an L: terrain layers + accessors in World, map loading at boot,
   stateHash append, save v2 + flat-terrain migration, `pnpm bless` with
   the balance-diff as your review artifact.
2. **Phase 1 task 2 — camera** (pan/zoom/LOD skeleton, renderer-only,
   bless-free). Unblocks chunked terrain rendering (task 9); also listed
   as a Codex-parallelizable candidate once you bless its slice.
3. **AI-WORKFLOW §1 edit: per-agent git worktrees as the standing rule**
   (one paragraph + a CLAUDE.md line). Cheap insurance against the only
   real incident of the night. Decide 11b's image library while you're at
   it if you want the full intake chain moving.

## State of the gates (none weakened, three made real)

lint / det-lint / wall / typecheck / unit: live (det-lint caught a real
`Object.values` in pathfinding; `noImplicitReturns` added repo-wide) ·
golden: **REAL** (#4) · perf: **REAL** (#4) · assets: **REAL** (#13) ·
e2e smoke: added to CI (#7) · determinism cross-check: **REAL**, weekly +
dispatchable (#12) · balance: stub (Phase 2, as planned).
