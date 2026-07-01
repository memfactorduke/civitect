# Civitect — Game Design Document

**Version 0.1 · 2026-06-11 · Status: Living document**
All numeric values are initial design values, flagged for tuning during playtests. Mechanics marked **[TUNE]** are expected to change; mechanics marked **[LOCKED]** are structural.

---

## 1. Vision

**Civitect is a full-depth city builder for touch.** The depth of Cities: Skylines — real traffic, a real economy, citizens you can follow — engineered for an iPhone in your hand and the same city continued on your desktop.

### Pillars

1. **Every number has a face.** Statistics drive the city, but you can always tap into them: tap a jammed road and see who's on it, tap a citizen and see why she's unhappy. Depth must be *inspectable*, never a spreadsheet behind glass. [LOCKED]
2. **Problems are puzzles, not punishments.** Challenge comes from interlocking systems (traffic ↔ land value ↔ economy), and every problem must be diagnosable through the tools the game gives you. No opaque failure. [LOCKED]
3. **Respect the session.** Meaningful progress in a 10-minute phone session; depth that rewards a 3-hour desktop session. Same city, same save, both contexts. [LOCKED]
4. **Performance is a feature.** 60fps interaction, instant tool response, no loading walls mid-play. The performance budget (TDD §2) is a design constraint, not an aspiration. [LOCKED]

### Player fantasy
You are mayor, planner, and engineer at once. The fantasy arc: *empty valley → first crossroads village → growing pains → humming metropolis that is recognizably yours.*

### Audience & platforms
- Primary: players of Pocket City, TheoTown, SimCity BuildIt who want "the real thing" on mobile; lapsed C:S players without desktop time.
- Platforms: iOS (iPhone 15 Pro-class and newer), Android (2023+ flagship-class), browser + PWA desktop. One save via cloud sync (ADR-003).
- Sessions: designed for 5–20 min mobile loops and long-form desktop play.

### Out of scope for v1.0 [LOCKED]
Multiplayer/co-op · mod scripting (data formats stay plugin-friendly for later) · freeform curved roads (grid + diagonals instead, §5) · in-game terrain sculpting · parking simulation · seasons (cosmetic tint only, post-v1).

---

## 2. Core loops

**Minute loop:** observe → diagnose (overlays/inspector) → build/rezone/policy → watch the city respond.
**Session loop:** pick a district-scale project (new industrial area, metro line, downtown upzone) → fund it → integrate it → stabilize budget.
**Meta loop:** milestone unlocks → new mechanics and buildings → new problem classes → mastery. A milestone should change *what kind of problem the player is solving*, not just add a building.

**Failure pressure:** money is the early-game constraint, space and traffic the mid-game, logistics and land value the late game. Bankruptcy triggers a one-time bailout offer per city (high-interest loan + advisor scrutiny); declining it or failing again = city continues in "receivership" sandbox with achievements disabled. Optional hardcore toggle: bankruptcy ends the city. **[TUNE]**

---

## 3. World & maps

- Tile grid, 8m × 8m per tile. Map sizes: **S 192²** (~2.4 km²), **M 320²** (~6.6 km²), **L 512²** (~16.8 km²), **XL 768²** (~37.7 km², desktop-recommended, post-launch). [TUNE]
- Terrain: stepped elevation in 5 terrace levels (classic SC2000/Anno read in isometric), water bodies (sea, lakes, rivers with flow direction for water pollution), beaches, cliffs. No in-game sculpting; variety comes from the map catalog + seeded generator.
- Natural resources painted on the map: **fertile land, forest, ore, oil** — drive specialized industry (§8). Wind and water-flow maps for power siting.
- Each map ships with outside connections: highway (always), rail, sea route, air corridor (unlock-gated). Outside connections are the city's import/export and immigration arteries.
- Map generator tool (dev-side, TDD §13) produces the launch catalog of ~24 maps across coastal/river/valley/plains archetypes with difficulty ratings.

---

## 4. Camera & presentation

- Fixed isometric orientation (no rotation in v1 — sprite cost and readability; revisit post-v1 with 4-view sprites). Zoom range: full-map overview → street level where citizens are individually visible.
- Day/night cycle synced to sim clock (§12) via lighting tint + window/streetlight emissive layers. Night is informational too: lit windows = occupancy, dark district = power cut.
- Weather: cosmetic rain/fog layers, no sim effect in v1. [TUNE]
- Art direction: clean stylized isometric, strong silhouettes readable at 50% zoom on a phone, consistent NW sun. Building states rendered: construction scaffold → active → no-power/no-water badge → abandoned (desaturate + decay overlay) → on fire → ruin. Style bible: `docs/art/STYLE-BIBLE.md` (produced with first asset batch, see AI-WORKFLOW).

---

## 5. Roads & paths

The road network is the city's circulatory system and its biggest puzzle surface.

- **Geometry:** orthogonal + 45° diagonal segments on the tile grid, automatic intersection generation, bridges (over water/roads), tunnels (portal pairs). No freeform curves in v1 [LOCKED — ADR consequence of sprite pipeline].
- **Hierarchy [TUNE]:**

| Road | Lanes | Speed | Capacity (veh/h/lane) | Notes |
|---|---|---|---|---|
| Gravel road | 1×1 | 30 | 300 | cheap, no services degrade |
| Street | 1×1 | 40 | 600 | zonable |
| Avenue | 2×2 | 50 | 700 | zonable, median |
| Boulevard | 3×3 | 50 | 700 | bus/tram lanes option |
| Highway | 3 one-way | 100 | 1,800 | no zoning, ramps |
| One-way street/avenue variants | — | — | +15% capacity | flow-control tool |

- **Intersections:** auto type by class crossing — stop-controlled, traffic signals (player-overridable), roundabout piece (2×2 and 3×3), highway ramps and prebuilt interchange pieces (clover, diamond, trumpet). Intersection control affects edge cost in the traffic model (§9).
- **Pedestrian & bike paths:** separate cheap network; reduce short car trips via mode choice (§9). Crosswalks auto at intersections; mid-block crossings placeable.
- **Road tools:** drag-to-build with cost preview and slope/water validation, parallel-road mode, upgrade-in-place (preserves zoning), bulldoze with refund curve (100% within 1 game-day, then 50%). Undo/redo stack for build actions (deterministic command log makes this cheap — TDD §3).
- **Maintenance:** roads degrade with traffic volume; road maintenance budget slider trades upkeep cost vs. speed/capacity penalty. Snow/weather excluded v1.

---

## 6. Zoning & growth

- Zone types: **Residential** (low/high density), **Commercial** (low/high), **Industrial** (generic + 4 resource specializations), **Office**, **Mixed-use** (ground commercial + residential above, unlocked mid-game). Zoning is painted per-tile along roads (depth 4 tiles, C:S-style).
- **Demand (RCI+O)** is computed from first principles, not a mystery meter [LOCKED]:
  - R demand ← job openings + city attractiveness (land value, services, low taxes, low pollution) − housing vacancy.
  - C demand ← resident purchasing power + tourists − retail vacancy; requires goods supply (§8).
  - I demand ← goods orders from C + export prices − industrial vacancy + workforce availability (low education tiers).
  - O demand ← educated workforce share + C/I administrative needs.
  - The demand panel shows the *factors*, not just bars — pillar 1.
- **Building growth:** zoned lots spawn buildings when demand + desirability clear thresholds. Buildings level **L1→L5** on sustained desirability: land value, service coverage, education of occupants (R), customer traffic (C), logistics access (I), workforce quality (O). Leveling changes sprite, capacity, tax yield. **De-leveling** and **abandonment** occur on sustained failure (no power/water 2+ days, unreachable, crime, pollution for R). Abandoned buildings drag neighbor land value; auto-demolish policy available.
- **Desirability/land value field:** per-tile score = Σ weighted contributions (service coverage §7, parks, pollution −, noise −, traffic −, water view +, education, transit access). Computed incrementally on dirty regions (TDD §5). Land value drives growth, leveling, and property tax yield.

---

## 7. Utilities & city services

### Utilities (networked)
- **Power:** generation buildings (coal, gas, wind, solar, hydro [map-dependent], nuclear, battery storage late-game) feed a grid that propagates through powered tiles/lines; demand from buildings by type/level; brownouts roll if supply < demand (priority: services last to drop). Wind/solar vary with map wind field and day cycle → storage matters. Pollution per plant type (§10).
- **Water & sewage:** pumps (groundwater or river), water towers, treatment plants, sewage outlets/treatment. **Pipes auto-run under roads** [LOCKED — mobile UX]; standalone conduit tool exists for crossing unroaded terrain. Capacity + pressure modeled at district granularity; sewage into water bodies pollutes downstream (flow direction matters).
- **Garbage:** generation per building; collected by trucks from landfill/incinerator/recycling center (trucks are real freight trips in the traffic model). Landfills fill and can be emptied/closed; incinerators make power + air pollution; recycling reduces goods import needs slightly.

### Services (coverage + capacity)
Each service building has a **road-network coverage radius** (not euclidean — pillar 2: bad roads = bad services) and a **capacity queue**. Coverage decays with network distance; effectiveness = coverage × capacity-fill.

| Service | Buildings (v1) | Capacity unit | Failure effect |
|---|---|---|---|
| Fire | station, large station, helipad (late) | trucks | fires spread tile-to-tile, destroy buildings |
| Police | station, HQ | patrols | crime ↑ → land value ↓, abandonment |
| Health | clinic, hospital | treated/day | sickness ↑ (pollution-linked), deaths ↑ |
| Deathcare | cemetery (fills), crematorium | hearses | corpses lower desirability sharply |
| Education | elementary, high school, university, library | seats | caps citizen education progression (§8) |
| Parks & rec | 8 park tiers, plaza, sports field, stadium (unique) | — | leisure happiness, land value + |
| Telecom | cell tower | coverage | minor happiness/office desirability |

- Service **budget sliders** (50–150%) scale capacity and coverage per service, with diminishing returns above 100%. District-level overrides via policies (§11).

---

## 8. Citizens, education & the economy

### Cohort model (the truth — ADR-002)
Population lives in per-building cohort tables: counts by **age band** (child/teen/adult/senior) × **education tier** (E0–E3) × employment status. All flows below are cohort math; live agents (§9) are a sampled projection.

- **Lifecycle:** births (R buildings, rate by happiness), aging transitions, mortality (age + health). New cities skew young; aging waves are a real late-game problem (deathcare demand, workforce dips) — as in C:S, but visible in the demographics panel before it hurts.
- **Education pipeline:** children→elementary, teens→high school, adults→university (capacity-gated). Education tier gates job eligibility: E0 farm/basic industry, E1 industry/retail, E2 office/services, E3 specialized/unique. Over-education + no matching jobs → emigration of graduates ("brain drain" advisor warning).
- **Employment:** job slots live on C/I/O buildings by tier; matching favors short commutes (uses traffic travel times — congestion literally shrinks the labor market). Unemployment by tier feeds R demand and crime.
- **Happiness** (per cohort, weighted): housing quality, services coverage, commute time, pollution/noise, taxes, leisure, safety, employment match. Drives growth, immigration, riots—no, no riots v1; drives protests as advisor events only. [TUNE]

### Money economy
- **City budget:** property taxes (by zone × level × land value), service upkeep, road maintenance, loans (3 tiers, monthly interest), one-time construction costs. Monthly budget cycle with a readable report (pillar 2): income/expense breakdown with month-over-month deltas and "why" links.
- **Taxes:** per zone type + density, 1–29%, default 9%. >12% suppresses demand and happiness progressively; <7% stimulates. District tax overrides unlock late. [TUNE]
- **Goods economy (simplified C:S chain) [LOCKED structure]:** Raw (farm/forest/ore/oil from map resources) → **Processed** (industry) → **Goods** (industry) → sold by Commercial to citizens/tourists, surplus exported via outside connections; deficits imported (→ freight traffic at borders, import cost drag on C profits). Office produces no goods; it sinks educated labor and pays well. Every chain hop is real freight on the road/rail/sea network — industry siting is a logistics puzzle, not decoration.
- **Tourism:** attractiveness from parks, unique buildings, stadium events, low crime; tourists arrive via outside connections, spend at C, load transit. Small system v1, expansion hook later.

---

## 9. Traffic & transit (the signature system)

### Model (hybrid — ADR-002)
1. Each sim-hour, trips aggregate into an **origin–destination matrix** by purpose (commute, school, shopping, freight, services) and mode.
2. **Mode choice** (logit on time/cost/availability): walk/bike for short trips with paths, transit if line exists and competitive, else car/truck.
3. **Equilibrium flow assignment** distributes car/truck trips over the road graph with BPR-style volume-delay (congestion emerges mathematically — the same method real transport planners use). Full solve each game-day at 4am + incremental updates hourly and on network edits.
4. **Live agents:** ~10k sampled citizens/vehicles (device-scaled, TDD §2) drive/walk/ride along assigned flows. Fully inspectable: tap a vehicle → who, from where, to where, why this route. Pinned/favorited cims persist permanently.
5. Rush hours from departure-time distributions (7–9a, 4–7p peaks); freight runs all day; night is quiet. Day/night cycle is thus *informationally honest* about traffic.

### Congestion consequences [LOCKED]
Travel times feed back into: job matching radius (§8), service effectiveness (§7 — fire trucks stuck in jams fail), goods delivery (starved C/I de-level), land value (noise/jam penalty), citizen happiness (commute factor). Traffic is never just red lines — it bites through every system, and each bite is shown with a cause link.

### Transit (full set at 1.0 — roadmap phase 6)
- **Bus** (depot + stops, line editor), **Tram** (tracks on boulevards), **Metro** (underground, station + tunnels — portal-rendered in iso), **Passenger rail** (intercity + intra), **Freight rail** (industry logistics bypass), **Harbor** (passenger ferry + freight dock on coastal maps), **Airport** (late-game unique, passenger volume + tourism boost).
- Line editor: tap-sequence stops, color/name lines, per-line vehicle count allocation, headway and load stats, profitability per line. Transit vehicles are live agents with capacity; overcrowding shows as full vehicles skipping stops (visible problem → buy more vehicles or rethink line).
- Walkability interacts: stop catchment via path network distance.

**As-built (Phase 6, 2026-07):** the transit CORE shipped — lines (ordered stops, mode/color/name/vehicles/headway), stop-cell catchment, mode choice (transit competes with the car; a good line pulls commuters off congested roads), and per-line economics (fares in, per-mode vehicle upkeep out, at the monthly budget close). The congestion charge (GDD §11) makes transit more attractive by pricing car trips through a district. STILL TO COME: vehicle CAPACITY / overcrowding (deferred — the "buy more vehicles" loop above), the six MODES' distinct siting + costs (currently mode is a label; bus-like behaviour for all), the RENDERER transit layer (lines/vehicles/stops drawn) and the line-editor UI. So transit is fully SIMULATED and balance-testable, but not yet visible or buildable in-game — that's the playability gap (rendering = task 5, UI = task 6).

---

## 10. Pollution, health & environment

- **Air pollution:** emitted by industry/power/traffic volume; spreads with map wind vector; settles into a per-tile field. Sickens R cohorts, suppresses land value.
- **Ground pollution:** industry/landfill/sewage legacy; persists (slow decay), blocks R desirability; visible soil discoloration.
- **Noise:** roads by volume/class, airports, industry; R-only land value/happiness penalty. Quiet infrastructure (trees, noise barriers) mitigates.
- **Water pollution:** sewage/industry into water bodies, flows downstream; pumps in polluted water → citywide sickness events (dramatic, diagnosable, classic).
- Trees: placeable singly/brush; reduce noise/air locally, raise land value. Forest industry consumes mapped forest unless replanted (sustainability policy).

---

## 11. Districts & policies

- Free-draw district painting tool; districts get names (auto-generated, renamable), stats panels, and identity.
- **Per-district policies** (each with upkeep or tradeoff; ~22 at launch [TUNE]): education boost, free transit, smoke detectors, recycling, water restrictions, power conservation, high-rise ban, heavy-traffic ban, old-town (no trucks), parks maintenance+, small-business subsidy, industry subsidy, office incentives, tourism promotion, noise ordinance, neon ban, pet policy (flavor), school busing, bike lanes mandate, congestion charge (downtown pricing — strong lever, late unlock), tax overrides per zone, specialized-industry designation (per resource).
- **City-wide ordinances:** a subset apply globally. Policies are the "express intent without micromanagement" layer — mid-game depth driver and the main lever differentiating districts.

**As-built (Phase 6, 2026-07 — first policy slices; the ~22 list above is the 1.0 aspiration):** the painting tool, names, per-district `policyMask` + city `ordinanceMask` (both hashed+saved), and per-zone tax overrides shipped. Seven levers now move a MODELED outcome (not flavour), each a gated integer mask read that leaves a policy-free city byte-identical: **high-rise ban** (per-district, caps building level ≤3), **recycling** (ordinance, less garbage), **clean industry** (per-district, less industrial ground pollution), **industry subsidy** (ordinance, lifts I demand), **public health/parks** (ordinance, lower base sickness), **congestion charge** (per-district, tolls driving through → shifts commuters to transit; milestone-gated at 30k), **heavy-traffic/truck ban** (per-district, freight detours around it). The four "program" levers (recycling, industry subsidy, public health, clean industry) bill a **monthly upkeep** to the budget — the cost-vs-benefit tradeoff; regulatory levers (bans, charge) are free by construction. Deferred: education boost, free transit, bike lanes, tourism promotion, noise/neon/pet flavour, specialized-industry designation, and the rest.

---

## 12. Time, weather & simulation clock

- 1 sim tick = 1 game-minute; 10 ticks/sec at 1× (game-day ≈ 2.4 real minutes). Speeds: pause / 1× / 3× / 9× (9× is desktop-headroom; phone may governor to ~6× under thermal pressure — speed governor is explicit UI, never silent slowdown). [TUNE]
- Monthly: budget cycle, demographics report. Daily: full traffic solve, land value settle. Hourly: demand, incremental flows, service queues.
- Offline time does not advance (no idle-game mechanics). [LOCKED]

---

## 13. Progression, difficulty & modes

- **Milestones** by population (240 → 500 → 1.2k → 2.5k → 5k → 9k → 16k → 30k → 55k → 90k → 140k → 220k → 350k [TUNE]) unlock mechanics progressively: budget panel → loans → districts → policies → high density → transit tiers → unique buildings → congestion pricing → airport. Unlock pacing is the tutorialization spine: each milestone introduces one new *problem class* with an advisor explainer.
- **Unique buildings** (~18): earned by playstyle achievements in-city (e.g., university city, freight empire), grant city-wide bonuses + tourism. Stadium hosts monthly events (traffic spike + income — a deliberate recurring traffic drill).
- **Achievements** (~60): mix of growth, mastery (e.g., "average commute < 15 min at 100k pop"), and absurd (C:S tradition).
- **Difficulty:** Relaxed / Mayor (default) / Ironclad — starting funds, loan terms, demand sensitivity, disaster frequency, bailout availability. Plus sandbox toggles (unlimited money, all unlocked) that disable achievements.
- **Scenarios & map editor:** post-1.0 with the community update (ADR-003 level 2).

---

## 14. Disasters & events (toggleable, phase 8)

- Core (always on): **building fires** (spread tile-adjacent, fire service response), utility failures from neglect.
- Toggleable natural set: **flood** (river/sea rise along low terraces), **tornado** (path destruction, warning time), **earthquake** (radius damage + fires + road breaks), **meteor** (rare, dramatic). Early-warning buildings + disaster response unit reduce damage/casualties; insurance ordinance softens cost.
- City events (positive): festivals, marathons (street closures — traffic puzzle as *event*), stadium matches.

---

## 15. UX & interface

### Touch-first (phone)
- One-finger pan, pinch zoom, tap inspect, long-press quick-info, two-finger tilt nothing (fixed iso). Build mode: bottom sheet with category tabs → drag placement with magnetic snapping, large confirm/cancel targets, haptic ticks on snap. Undo/redo always visible in build mode.
- **Inspector panels** are the soul of pillar 1: every entity (building, road, vehicle, citizen, district, line) has a panel with live stats *and causal links* ("Customers: low ← high import prices ← port congestion" — each link tappable to jump).
- **Overlays** (one tap from main HUD): traffic, transit ridership, land value, all four pollutions, power, water, every service coverage, education, happiness, zones, districts, resources. Color-blind-safe ramps (verified per palette — TDD §9).
- **Advisor feed:** problem notifications grouped by cause, each with severity, affected count, and jump-to-location; monthly digest summarizes trends. No modal interruptions during play. [LOCKED]
- Desktop/browser: WASD/edge pan, scroll zoom, hotkeys for tools/overlays/speeds, right-click context menus, hover tooltips. Same UI skeleton, density adapts.

### Onboarding
Guided first city via milestone-gated contextual goals (build power → zone → first budget), skippable for veterans. No tutorial walls. Advisor explains each newly unlocked mechanic with a 2-panel card + optional "show me".

---

## 16. Audio

- Ambient bed layered by what's on screen: nature → suburb birds/dogs → downtown hum → industry clank; density crossfades with zoom and district under camera.
- Adaptive music: calm exploratory default, subtle tension layer when advisor severity rises, celebration sting on milestones. Full mute-and-play-podcasts support expected on mobile; the game must read fine silently. UI sounds: distinct, quiet, satisfying placement/confirm ticks.

---

## 17. What "fun" and "challenging" mean here (testable)

Playtest heuristics the design is accountable to:

1. **Diagnosability:** given any advisor warning, a tester can find the cause via ≤3 taps using inspector links. (Pillar 2 verification.)
2. **Session value:** a 10-minute session at 30k pop accomplishes a player-named goal ≥80% of the time.
3. **Depth ceiling:** experienced players at 100k+ pop report unsolved optimization goals (commute time, line profitability, land-value max) — the game must not be "solved" at milestone cap.
4. **Honest difficulty:** failure post-mortems ("why did I go bankrupt?") are articulable by the player without external guides.
5. **The follow test:** following a random citizen for one full day produces a coherent, explainable life (home→work→shop→home, consistent with her panel). This is the hybrid model's quality bar (ADR-002 reconciliation).

---

## 18. Content inventory at 1.0 (build target)

~140 growable building sprites per zone-density-level matrix (with variants), ~70 service/utility/unique placeables, ~30 road/rail/path pieces + intersections, 8 park tiers, ~24 maps, ~22 policies, ~18 unique buildings, ~60 achievements, 6 transit modes with vehicles, 4 disaster types, full overlay set. Asset specs and generation workflow: ADR-012 + AI-WORKFLOW.

---

*Cross-references: technical architecture in `TDD.md`; decisions in `adr/`; build order in `ROADMAP.md`.*
