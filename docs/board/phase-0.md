# Board — Phase 0: Foundations [M]

Decomposition per AI-WORKFLOW §2 (plan beat) and §3 (granularity: one package,
runnable verification, ≤ a session). Roadmap scope + exit criteria:
`docs/ROADMAP.md` Phase 0.

**Status legend:** `pending-approval` (Mem hasn't blessed the slice) ·
`approved` · `in-progress` · `in-review` · `done`

| # | Task (one package each) | Package | Spec | Size | Verification | Depends on | Status |
|---|---|---|---|---|---|---|---|
| 1 | Monorepo scaffold: workspaces, strict TS + project refs, Biome, Vitest, dep-cruiser wall, CI skeleton with all ADR-013 gates (stubs reference their unstubbing phase) | root | TDD §1, ADR-007 | M | full gate ladder green locally + in CI | — | done |
| 2 | protocol v1: versioned binary codecs for commands/snapshots/inspector queries + version-mismatch boot error | protocol | TDD §7, ADR-006 | M | encode∘decode fast-check property tests (review checklist §4) | 1 | done |
| 3 | sim core: 10 Hz deterministic tick loop, PCG32 per-system streams (`sim/rng`), tick-stamped command application, empty-world store + state hash; scoped ESLint determinism ban-rules join the lint gate | sim | TDD §3/§4, ADR-005 | M | seeded-replay reproducibility units; lint gate catches banned APIs | 2 | done |
| 4 | Golden + perf harness: headless replay runner, committed-hash compare, `--bless` + balance-diff skeleton, tick-p95 measurement; first golden `empty-city-01` (1 game-year). Unstubs golden + perf gates | e2e | TDD §12.1/.4, ADR-013 | M | gate fails on deliberate hash perturbation; passes clean | 3 | done |
| 5 | Renderer shell: Pixi v8 boot (WebGL), snapshot consumption, empty-world stage, tile highlight | renderer | TDD §8, ADR-008 | S–M | snapshot→display-state units; dev-server boot | 2 | done |
| 6 | UI shell: React 19 overlay, zustand stores from snapshot scalars, command dispatch, i18n key plumbing | ui | TDD §9, ADR-009 | S | RTL component tests | 2 | done |
| 7 | App round trip: sim worker boot, command queue, transferable snapshots; tap→command→sim→snapshot→highlight | app | TDD §1/§7 | M | Playwright smoke asserting <50 ms input→visual (exit criterion 2) | 3, 5, 6 | done |
| 8 | `.civ` save codec: header (magic/formatVersion/simVersion/seed/tick/checksums), sectioned layout, deflate-raw; fixture-save archive seeded | protocol | TDD §10, ADR-010 | M | round-trip property test + fixture round-trip | 2 | done |
| 9a | Save/load worker messages: saveRequest/saveResponse/loadRequest/loadResponse kinds, protocol v2 (interface-first split out of task 9 — .civ blobs must wear the envelope to cross the worker boundary) | protocol | TDD §7/§10 | S | symmetric codec property + v2 wire pins | 8 | in-review |
| 9 | Save manager: save/load empty world, checksum verify, version-header validation | app | TDD §10 | S | e2e save→load→state-hash-equal | 7, 8, 9a | approved |
| 10 | Sprite sidecar JSON schema (footprint/anchor/states/emissive mask) — interface first for tools | protocol | TDD §11, ADR-012 | S | schema validation units | 2 | approved |
| 11 | sprite-intake chain (bg removal, palette snap, 3×→2×/1× fixed-kernel downscale) + atlas packer validation + 64-swatch palette linter + contact sheets. Unstubs asset gate | tools | TDD §11, ADR-012 | L | gate rejects seeded bad fixtures (wrong size / off-palette / missing state), accepts good | 10 | approved |
| 12 | Determinism cross-check: golden replays in Chromium/WebKit/Node hash-agree. Unstubs weekly workflow | e2e | TDD §12.6, ADR-005 | S–M | three-engine hash agreement (exit criterion 1) | 4 | approved |

**Parallel, not a Claude Code PR:** style-bible seed batch (~12 hero sprites) —
Codex generates, Mem curates (AI-WORKFLOW §1/§5); hard-gated on PR 11
(exit criterion 3). Unblocks every content phase (ADR-012).

**Exit criteria → task mapping:** hash-stable empty-city golden across
Node/Chromium/WebKit ← 4 + 12 · tap round-trip <50 ms ← 7 · first 12
style-bible sprites pass mechanical gates ← 11 + Codex batch.

**Codex parallelization candidates** (AI-WORKFLOW §1: well-specified scaffolding
while Claude Code is in sim): 5, 6 — after 2 lands the interfaces.
