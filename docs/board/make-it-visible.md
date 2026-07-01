# Make it visible — Phase 6 front-end plan

**Created 2026-07-01.** After a long autonomous run, the Phase-6 *simulation* is
deep and fully tested, but the Phase-6 *systems have no face*. This is the plan
to make transit, districts, and policies visible and playable.

## Where we actually are

**The base game IS playable.** `pnpm --filter @civitect/app dev` boots the real
app: a PixiJS renderer (`packages/renderer` — iso projection, camera, chunked
static layers, agent trails) + a React HUD (`packages/ui` — HUD, budget/demand
panels, building/road inspectors, advisor feed, overlays, speed controls) over a
sim-in-worker. You can lay roads, zone, place buildings, watch the city grow and
agents move, read the economy, toggle service overlays, and inspect anything.
Phase 0–5 front-end is done; Playwright smoke tests drive it in a live browser.

**What's invisible:** everything from Phase 6. Transit lines, districts, and the
eight policy levers (incl. the congestion charge + truck ban) are **fully
simulated** — `pnpm demo` proves it in numbers — but there is **no way to see or
build them in the app.**

## The one blocking fact

The renderer and UI can only draw/read what's on the **snapshot** (the sim →
render contract, `packages/protocol/src/snapshot.ts`). **Phase-6 state is not on
the snapshot yet.** So graphics work is *blocked* on protocol/sim work.

- No transit lines / stops / vehicles / per-line ledger on the wire.
- No district paint layer / per-district stats on the wire.
- `OverlayId` only covers 0–14 (service coverage + fields); no 15=district /
  16=transit / 17=ridership.
- **Commands already exist** (`createLine`/`addStop`/`removeStop`/
  `setLineVehicles`/`deleteLine`, `paintDistrict`/`nameDistrict`, `setPolicy`/
  `setOrdinance`, `setDistrictTax`) — so *input → sim* is ready. Only the
  *display* path is missing.

## Division of labour

- **Codex → graphics:** all rendering (B) + all UI components (C).
- **Claude → plumbing + validation:** the snapshot/protocol work (A) that
  unblocks Codex, and the balance harness (D).
- **A is the critical path.** Codex is blocked on transit/district state
  reaching the snapshot; do A first (or in lockstep, wire-format agreed up front).

---

## A. Snapshot plumbing — Claude (protocol + sim) — DO FIRST

Expose Phase-6 canonical state to the renderer/UI. Each is a protocol version
bump + symmetric codec + fixed wire vector + the sim's `snapshotEncode` filling
it (the established pattern).

1. **Transit block:** lines (ordered stops, mode, color, name, vehicles,
   headway) + per-line ledger (riders, fareCents, costCents ⇒ profit) +
   city mode-share. Enough to draw lines and populate a line-editor/profitability
   panel.
2. **District block:** the district paint (id per tile — a diff/RLE like the
   zone layer) + per-district stats (pop, jobs, land value, pollution,
   mode-share) + the policy/ordinance masks (so panels can show what's on).
   *Depends on district stat AGGREGATION — board task 2b, still pending — for
   the stats; the paint layer + masks can ship first.*
3. **Overlays 15–17:** extend `OverlayId` + `OVERLAY_MAX` with
   district / transit / ridership, and have the sim emit those tile/edge layers
   (charge & ban zones can render from the district + policy masks).

## B. Rendering — Codex (renderer) — after A's wire format is agreed

1. **Transit layer:** lines as colored polylines through their stops; stop
   markers; vehicles as agents moving along lines (the ADR-002 sampled/derived
   projection — not canonical).
2. **Six modes** with distinct read: bus, tram (on boulevards), metro
   (underground station + portal-rendered tunnels in iso), passenger + freight
   rail, harbor ferry + dock, airport. Siting cues + sprites (asset pipeline,
   ADR-012).
3. **District layer:** translucent per-district tint + boundaries + name labels;
   highlight congestion-charge / truck-ban zones.
4. **Overlays:** transit, ridership, district through the generalized overlay
   ids from A.3.

## C. UI — Codex (ui) — after A

1. **Transit line editor:** tap-sequence stops → `createLine`/`addStop`; pick
   mode/color/name; vehicle-count + headway sliders (`setLineVehicles`); per-line
   **profitability panel** (riders × fare − upkeep, from the ledger in A.1). This
   is *the* signature Phase-6 interaction; one-handed on phone is a FEEL exit
   criterion (Mem).
2. **District tool:** paint districts (`paintDistrict`), rename (`nameDistrict`),
   per-district stats panel (from A.2), per-zone tax overrides (`setDistrictTax`).
3. **Policy panels:** per-district policy toggles + city-ordinance toggles
   (`setPolicy`/`setOrdinance`) for the eight live levers, each showing its
   effect + monthly upkeep; the congestion charge (milestone-gated — reflect the
   lock) and truck ban as district controls.
4. **Overlay picker** entries for transit / ridership / district.

## D. Validate — Claude (e2e) — board task 7

The mode-share balance harness: an archetype where mode share responds to a
policy lever within a modeled band (needs a non-gated lever like **free
transit**, in flight, since the congestion charge is 30k-gated). Then goldens
re-blessed with transit/districts and Phase-6 closeout.

---

## Live sim levers already built (so the UI has real things to drive)

Transit core (mode choice + fare/upkeep economics), districts + per-zone tax
overrides, and **seven policy levers**: high-rise ban, recycling, clean industry,
industry subsidy, public health, **congestion charge**, **truck ban** — four of
them (recycling, industry subsidy, public health, clean industry) bill monthly
upkeep. All deterministic, all merged to `main`. `pnpm demo` walks a city through
the transit + congestion-charge loop headlessly.

## Housekeeping (flag)

- ~71 stale open Codex PRs (incremental coverage on the base UI, pre-Phase-6) —
  triage against the current protocol before reusing.
- Two committed junk dup files from an iCloud sync (`packages/sim/src/economy/
  progression 2.ts` + its `.test`) — `git rm` in a cleanup pass.
