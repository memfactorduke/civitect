# Civitect — Development Roadmap

**Version 0.1 · 2026-06-11**

The full game (GDD v0.1 scope) built as **vertical slices**: every phase ends with the game *playable and gated* — exit criteria met, perf budgets green, golden cities updated. This is not an MVP ladder; it's the whole game in dependency order. Sizes are relative (S < M < L < XL ≈ 1 : 2 : 4 : 8); calendar time depends on your orchestration hours — with daily agent sessions, expect phases 0–3 to move fast and content phases (6–8) to be throughput-bound on asset generation.

**Standing rule:** a phase is done when its exit criteria pass *as automated tests* where testable, and the playable build feels right to you. Both. Feel failures reopen design, not just code.

---

### Phase 0 — Foundations [M]
Repo scaffold (TDD §1 layout), CI with all gates wired (lint/typecheck/unit/golden/perf harness skeleton), protocol package v1 (commands/snapshots/inspector), deterministic tick loop + PRNG streams + determinism lint rules, empty-world worker↔renderer↔UI round trip, save/load of empty world with version header, **style bible seed batch** (ADR-012 — unblocks all content phases), asset gate toolchain (packer + palette linter).
**Exit:** golden "empty city, 1 game-year" replay hash-stable across Node/Chromium/WebKit; a tapped tile round-trips command→sim→snapshot→highlight in <50ms; first 12 style-bible sprites pass mechanical gates.
**AI:** Claude Code everything code; Codex style bible iterations.

### Phase 1 — World & roads [L]
Terrain rendering (terraces, water, resources), map generator v1 + 6 maps, camera (pan/zoom/LOD tiers, 120Hz pan mode), road graph + build/bulldoze/upgrade tools with validation + undo/redo, intersections (auto signals/stops, roundabout pieces), bridges/tunnels, pathfinding (ALT) with cache invalidation, ped/bike paths.
**Exit:** build a 500-segment network on L map with zero dropped frames (perf gate); pathfinding correctness suite green; undo/redo property-tested (build∘undo ≡ identity on state hash).

### Phase 2 — Zoning, growth & land value [L]
Zone painting (all types + densities), demand model from first principles (GDD §6), cohort tables + building growth/leveling L1–L5/abandonment, land value field with incremental dirty-region updates, power+water networks (auto-under-road), first 60 growable sprites, inspector panels with cause chains (the pillar-2 skeleton), overlays v1 (zones, land value, power, water).
**Exit:** golden city grows 0→5k pop unattended with believable spatial structure (balance bands green); cause-chain links resolve correctly in e2e; demand panel factors sum to displayed demand (property test).

### Phase 3 — Traffic & live agents [XL] — *the signature system*
OD generation from cohorts, mode choice, MSA/BPR assignment (sliced solver), edge congestion → travel-time matrix → job matching + land value feedback, live agent pool (sampler chokepoint, camera-aware), vehicle/pedestrian rendering + following camera, pinned cims, traffic overlay + road inspector (volume/capacity/origin profile), rush-hour patterns, freight trips from goods chain stubs.
**Exit:** the follow test (GDD §17.5) passes e2e; conservation property (generated ≈ assigned) green; 10k agents + 250k pop at ≤10ms tick p95 on device floor; deliberately under-built bridge produces diagnosable jam with correct cause chain.

### Phase 4 — Services & utilities complete [L]
All services (GDD §7 table): coverage-via-network + capacity queues, service vehicles as real trips (fire response, garbage trucks, hearses), budget sliders, sewage/garbage full loops, water pollution with downstream flow, health/sickness ↔ pollution, deathcare cycle, education buildings + pipeline gating, all service overlays, advisor feed v1 grouped by cause.
**Exit:** fire on a congested street spreads realistically because the truck is late (and the cause chain says so); each service's coverage overlay matches network-distance ground truth (property test); golden cities re-blessed with services.

### Phase 5 — Economy, industry chains & progression [L]
Full budget cycle (taxes by zone×level×land value, upkeep, loans), monthly report with deltas + why-links, goods chain (raw→processed→goods→retail with real freight), specialized industry on map resources, import/export via outside connections, office sector, tourism v1, milestones 240→350k with staged unlocks, unique buildings (~18), achievements (~60), difficulty modes + bailout/receivership flow.
**Exit:** balance sims hold assertion bands across 5 archetype playstyles for 20 game-years; bankruptcy post-mortem articulable from in-game info alone (playtest heuristic 4); progression pacing playtest: each milestone introduces its problem class on schedule.

### Phase 6 — Districts, policies & transit [XL]
District painting + per-district stats/identity, ~22 policies + city ordinances with real system hooks, district tax overrides, congestion pricing, **full transit set:** bus/tram/metro/rail/ferry/airport with line editor, per-line economics, transit vehicles as capacity agents, stop catchment via path network, ridership ↔ mode choice integration, transit overlays + line profitability panels.
**Exit:** a transit-first 100k city is viable and fun (playtest); mode share responds to policy levers within modeled bands; line editor usable one-handed on phone (UX test); goldens re-blessed.

### Phase 7 — Polish, audio & onboarding [L]
Adaptive audio + ambient beds, day/night emissive polish, weather cosmetics, full UX pass (haptics, gesture polish, panel density, color-blind verification in CI), onboarding goal track + advisor explainer cards, settings (agent pool slider, battery saver, reduced motion), localization key extraction pass, map catalog completed to ~24 (GDD §3/§18), performance hardening to budget *targets* (not just gates) on full feature load.
**Exit:** new-player playtest: first city to 1k pop unaided ≥80%; session-value heuristic (GDD §17.2) passes; all §2 budgets at target on device floor with everything on.

### Phase 8 — Disasters & events [M]
Fire spread core, toggleable flood/tornado/earthquake/meteor, early warning + disaster response services, insurance ordinance, positive events (festivals, stadium matches, marathons with street closures), event-driven advisor moments.
**Exit:** each disaster produces a recoverable, diagnosable crisis on a 50k golden city (scripted scenario tests); disasters-off mode fully clean.

### Phase 9 — Platform hardening [L]
Capacitor 8 shells (iOS/Android): lifecycle, background autosave, haptics, share sheet for save export, secure token storage; PWA desktop polish (install, offline cache, file handling); device matrix runs; store assets/listings; thermal/battery profiling passes; crash recovery e2e; accessibility audit.
**Exit:** TestFlight + Play internal track + installable PWA all green on the full e2e suite; 30-min session thermal budget holds on iPhone 15 Pro.

### Phase 10 — Cloud sync & launch [M]
Supabase wiring per ADR-011 (auth, blobs, RLS, deletion cascade), sync UX (generation conflicts → fork prompt with thumbnails), privacy policy + compliance, closed beta (TestFlight/Play track) with telemetry opt-in, balance hotfix loop from beta data, launch checklist, 1.0 submission.
**Exit:** two-device sync fork/merge e2e green; beta cohort retention + heuristic checks pass; stores approved.

---

### Post-1.0 (sequenced, not scheduled)
**1.x:** scenarios + map editor → community features (ADR-003 Level 2: city sharing, replay-verified leaderboards, weekly challenges) → seasons/cosmetics → camera rotation feasibility study (4-view sprite regeneration via ADR-012 pipeline) → modding data formats.

### Dependency notes
3 blocks 4/5/6 hard (everything consumes traffic). 0's style bible blocks all sprite batches (2/4/5/6 content). 9 can start its shell work parallel to 7–8. 10 last by design (sync against a stable format; ADR-010 migrations cover beta-era saves).
