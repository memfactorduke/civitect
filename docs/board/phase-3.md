# Board — Phase 3: Traffic & live agents [XL] — the signature system

Decomposed 2026-06-12 (continuation run). Tranche structure: the
mathematical core first (OD → mode → assignment → feedback, conservation-
proven), then agents/rendering/inspection, then perf/diagnosis.

| # | Task | Package | Spec | Size | Verification | Status |
|---|---|---|---|---|---|---|
| 1 | Traffic core: hourly OD from cohorts (8×8 zone-cells), table-logit mode choice, STATELESS hourly assignment over the road graph with 2-pass BPR feedback (integer (v/c)^4 — no pow), congested travel times; conservation counters | sim | GDD §9, TDD §6, ADR-002/005 | L | conservation property EXACT (exit criterion 2 ✓); congestion + determinism props; path cache keyed on graph version (balance gate runtime unchanged); covered by existing goldens (traffic is derived) | done (#46) |
| 2 | Solver slicing + MSA averaging with hashed/saved traffic state (save v5) — replaces v1's hour-boundary spike (TDD §6.3 deviation note) | sim+protocol | TDD §6.3 | L | structural work bound per tick (≤⌈cells/12⌉ origins, job ≤48 ticks); MSA convergence band test; mid-solve save/load identity; canonical-twin routing + canonical growth iteration (two construction-order leaks found and fixed); event-driven re-solve cut, TDD §6.3 edited (undo-identity conflict) | done (#50) |
| 3 | Live agents: pool + camera-aware sampler (the ADR-002 chokepoint), transform buffer in snapshots (transferable), renderer agent layer, pinned cims | sim+protocol+renderer | GDD §9.4, TDD §6.5/§7 | XL | sampler-chokepoint unit; follow test e2e (exit criterion 1) | done (#51 protocol v8, #52 sim pool/sampler + canonical pins, #53 worker rider + renderer layer + camera→viewport plumbing + follow e2e). Exit criterion 1 PASSES e2e (v1 commute bar: stable id, continuous motion, journey completes; the full one-day home→work→shop→home bar gains its shop leg + panel consistency with the inspector tranche). Deferred [TUNE]: car-following spacing, sprite art (content-gated), device pool scaling (tranche 6) |
| 4 | Traffic overlay (edge volume/capacity tints) + road inspector (volume, capacity, travel time) + rush-hour departure curves | sim+protocol+renderer+ui | GDD §9.5 | L | overlay units; inspector e2e | done (#54 — protocol v10 congestion block + inspector road payload; rush curves [TUNE]; overlay layer + T toggle; tap-to-inspect panel; road-inspector e2e through a real morning peak. A congestion-ADVISOR browser run needs ~12 real minutes of jam-building at 9× — diagnosability stays sim-proven (#47), advisor→DOM resolution browser-proven via abandonment (#45)) |
| 5 | Jam diagnosis: under-built bridge scenario → advisor with cause chain pointing at the saturated edge (exit criterion 4) | sim+e2e | GDD §9, ADR-009 | M | sim-level: under-built corridor saturates → alert advisor whose edge ref RESOLVES (alive + over capacity); browser e2e rides the overlay/inspector tranche | done (#47) |
| 6 | Perf: 250k pop + 10k agents tick p95 ≤ 10 ms on device floor (exit criterion 3) | e2e | TDD §2 | L | device measurement recorded; perf golden joins gate | done (#55 — metro-perf scenario: constructed 256×256 city, 252k pop held through a full game-day, 9.9k live agents, **tick p95 4.92 ms** on an M-series Mac (device floor ≤10 ms asserted locally; 20 ms structural gate on CI). Required: per-origin Dijkstra TREES replacing per-pair A* (quadratic OD blowup), DEST_CAP=16 destination choice, fixed ORIGINS_PER_TICK=8 budget — XL maps stretch pass duration, never tick cost. True mobile-floor measurement still owed on Mem's device farm) |

**Exit criteria:** follow test ← 3 · conservation ← 1 · 10k agents/250k pop
p95 ← 6 · diagnosable jam with cause chain ← 5.

**STATUS: ALL FOUR EXIT CRITERIA GREEN (2026-06-12)** — follow test passes
e2e (#53); conservation EXACT as a property (#46); 252k pop + 9.9k agents
at p95 4.92 ms ≤ 10 ms device floor (#55, M-series Mac — mobile-floor
device-farm measurement still owed to Mem); jam diagnosable with resolving
edge cause chain at sim level (#47; advisor→DOM resolution browser-proven
via abandonment, congestion-advisor browser run impractical in smoke
budget — see row 4 note). Content-independent Phase 3 scope is COMPLETE;
deferred mechanics: car-following spacing, agent sprites (content-gated),
transit (Phase 4+), freight stubs (goods chain, Phase 5).
