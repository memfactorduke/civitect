# Civitect — Decision Brief

**Date:** 2026-06-11 · **Status:** RESOLVED — D1: Web-first TS · D2: Hybrid sim · D3: Cloud sync. Kept as historical record; formal ADRs in `adr/`.
**Also locked:** Isometric 2.5D visual style (ADR-004) · Device floor raised post-brief to iPhone 15 Pro-class (see TDD §2 — budgets there supersede estimates below)

This brief exists so you can make the three foundational calls with full understanding. Each section explains what the decision actually controls, how each option works mechanically, how each option *fails*, and what I recommend and why. Once you decide, each becomes a formal ADR in the corpus.

---

## D1 — Tech Stack (will become ADR-001)

### What this decision actually controls

Not "which language" — it controls four things that compound over the project's life:

1. **Your real development velocity.** You are one person orchestrating AI agents. The stack determines how effective Claude Code and Codex can be. This is the dominant factor, and it's the one most stack comparisons ignore because they assume a human team.
2. **The simulation performance ceiling** on a mid-range phone (our worst target: think a 4-year-old Android, ~$200 device).
3. **Platform reach** — you want mobile (primary) + browser/desktop.
4. **Asset pipeline fit** — you chose isometric 2.5D, which means sprites, which means Codex's image generation is your art department. The stack should consume PNGs/sprite sheets natively.

### The three candidates

#### Option A — Web-first TypeScript (recommended)

**Architecture:** A monorepo where the simulation is a *pure TypeScript package with zero rendering dependencies* — deterministic, fixed-timestep, data stored in typed arrays (structure-of-arrays). It runs inside a Web Worker so the UI thread never stutters. Rendering is PixiJS v8 (WebGL now, WebGPU when browsers stabilize — Pixi supports both behind one API). Mobile apps are Capacitor 8 shells (current, healthy: released Dec 2025). Browser version is *the same build*. Desktop is a PWA or Tauri wrapper.

**Why it works for a solo + AI setup:**

- Claude Code is maximally effective in pure-code repos: no editor GUI in the loop, no binary scene files, no asset GUIDs. The sim core can be tested *headlessly* — Claude Code can run "simulate 10 game-years of this city, assert the economy doesn't explode" as a unit test. That single property is worth more than any engine feature, because it means AI agents can verify their own work without you eyeballing a running game.
- One language, one codebase, every platform. No "the web build behaves differently" class of bugs.
- Sprites in, sprites out. Codex generates a PNG; it's in the game in minutes.

**Existence proof:** Pocket City (solo dev, deeper than it looks) was built exactly this way — Phaser + TypeScript, with Web Workers computing traffic, power, and water ([dev blog](https://blog.pocketcitygame.com/pocket-city-development-pipeline/)). We'd exceed its sim depth via better data layout and the hybrid model in D2, but it proves the stack ships real city builders on mobile.

**Honest costs:**

- JavaScript engines run numeric code roughly 2–5× slower than native. Mitigations, in order: (1) the D2 sim model choice matters 100× more than language speed — a hybrid sim in TS beats a full-agent sim in C++; (2) typed arrays avoid garbage-collection pauses, the classic JS killer; (3) the escape hatch: any profiled hot path (likely candidates: pathfinding, flow assignment) can be ported to Rust→WASM *without changing architecture*, since the sim core is already an isolated package. WASM runs near-native everywhere including browsers.
- iOS WebView has quirks (audio unlock, memory ceilings ~1.5GB). Capacitor's ecosystem exists precisely to paper over these; known territory.
- No engine editor — we build our own dev tools (debug overlays, sim inspectors) as web pages. For AI agents this is a feature: they can build and modify the tooling too.

#### Option B — Godot 4

Free, open source, good 2D renderer, text-based scene files that diff cleanly in git (AI-agent friendly, second only to pure code).

**The disqualifying problem for our platform matrix:** C# still cannot export to web in Godot 4 — confirmed as of mid-2026, it remains unsupported in official releases ([Godot forum](https://forum.godotengine.org/t/is-there-an-update-on-exporting-c-projects-to-web/128821), [4.2 platform-state article](https://godotengine.org/article/platform-state-in-csharp-for-godot-4-2/)). So for your browser version you'd be forced into GDScript — but GDScript is interpreted and substantially slower than C# for exactly the numeric, tight-loop work a deep sim does. You'd either split the codebase (C# sim for mobile, GDScript for web — a maintenance disaster) or accept GDScript everywhere and a lower sim ceiling than TypeScript would give you (modern JS JITs beat GDScript comfortably). Web export is also Godot's weakest, least-tested platform generally.

**Verdict:** A fine engine that's wrong for *this* platform matrix. If you dropped the browser requirement, it would be a real contender.

#### Option C — Unity 6

The maximalist option — it's what Cities: Skylines 1 and 2 are built in.

**Strengths:** the highest raw performance ceiling (Burst compiler + Job System + ECS can chew through millions of entities), the most mature iOS/Android export, and — credit where due — Unity 6 now officially supports mobile browsers for web builds, with WASM SIMD, multithreading, and a 4GB memory limit ([Unity web runtime updates](https://unity.com/blog/engine-platform/web-runtime-updates-enhance-browser-experience), [browser compatibility](https://docs.unity3d.com/6000.4/Documentation/Manual/webgl-browsercompatibility.html)). The web gap I'd have cited a year ago has narrowed.

**Why I still don't recommend it for you:**

- **AI-agent friction is structural.** Unity work lives in an editor: YAML scenes full of GUID cross-references, inspector-wired components, import settings, domain reloads. Claude Code can write C# beautifully, but a large fraction of Unity development *isn't C#* — it's editor state that agents can't see or verify. Your iteration loop becomes "agent writes code → you open editor → you wire things → you report back." You become the bottleneck in your own pipeline.
- **It's overkill that you pay for.** ECS/Burst's ceiling matters for C:S2-style 3D agent swarms. For isometric sprites + a hybrid sim (D2), TypeScript clears the bar — and Unity web builds, while now *supported* on mobile browsers, are still heavyweight downloads next to a Pixi bundle.
- **Cautionary tale, not endorsement:** C:S2 being on Unity didn't save it — it shipped in Oct 2023 with severe performance problems rooted in unbounded simulation ambition and unoptimized rendering. The lesson for Civitect: *the sim model and perf budgets (D2) determine performance; the engine does not.*

### Comparison

| Criterion (weighted for Civitect) | A: Web-first TS | B: Godot 4 | C: Unity 6 |
|---|---|---|---|
| AI-agent velocity (dominant) | ★★★★★ pure code, headless tests | ★★★☆☆ text scenes, but editor still in loop | ★★☆☆☆ editor-centric |
| Sim perf on mid phone | ★★★★☆ with SoA + worker; WASM escape hatch | ★★☆☆☆ GDScript ceiling (web forces it) | ★★★★★ Burst/ECS |
| Browser version quality | ★★★★★ it's the native platform | ★★☆☆☆ weakest platform, no C# | ★★★☆☆ supported but heavy |
| Mobile app quality | ★★★★☆ Capacitor; WebView quirks known | ★★★★☆ good export | ★★★★★ best in class |
| Sprite/2D asset pipeline | ★★★★★ PNG in, done | ★★★★☆ | ★★★☆☆ import pipeline overhead |
| Risk/longevity | Web platform: ~immortal | Small-team OSS | License-trust history (2023 runtime fee) |

**Recommendation: Option A**, with a standing escape-hatch ADR: if profiling shows a sim system blowing its frame budget and TS optimizations are exhausted, that system gets ported to Rust→WASM behind the same interface. The simulation's package isolation makes this cheap. I'd bet we need it for nothing, with pathfinding as the only maybe.

---

## D2 — Simulation Model (will become ADR-002)

### What a city sim actually computes

To choose intelligently you need to know what the machine does every tick. Any C:S-class sim runs these interlocking systems:

- **Demand (RCI):** how much residential/commercial/industrial growth pressure exists, driven by jobs↔workers balance, land value, taxes, unemployment.
- **Land value & desirability:** per-tile scoring from services coverage, pollution, noise, traffic, parks, crime.
- **Citizens:** who lives where, works where, ages, educates, sickens, dies. *The representation of citizens is the entire D2 question.*
- **Traffic:** how trips (home→work, freight, services) route over the road network, producing congestion, which feeds back into land value, demand, and service effectiveness.
- **Networks:** power, water, sewage as graph flow problems.
- **Services:** schools, hospitals, police, fire — coverage areas, capacity vs. demand.
- **Economy:** taxes in, budgets out, loans, building upkeep.

Everything above is just math at some resolution. The question is: **at what resolution do we track people and vehicles?**

### Option 1 — Full per-agent (the C:S approach)

Every citizen is an entity: a record with home, workplace, education, age, health, and a daily schedule. Every trip spawns a vehicle/pedestrian that *actually pathfinds* through the network and occupies road capacity. Traffic jams are literal: those specific cars chose that specific route.

**What you buy:** perfect causality and emergent storytelling. Tap any car: "Yusuf, 34, driving from Oakdale to the cannery." The jam on Main St exists because 412 identifiable citizens commute through it. This inspectability is *the* magic that makes C:S feel deep.

**What it costs:** pathfinding dominates everything. A* over a city road graph, called thousands of times per game-minute, plus per-agent state updates. C:S1 hard-capped concurrent moving agents (~65k) and quietly despawned vehicles stuck too long — even on desktop CPUs, full honesty was unaffordable in 2015. C:S2 raised the ambition and shipped with notorious performance problems. On a mid-range phone, a full-agent model realistically caps your city around **10–20k population** before the sim eats the frame budget. That's a village. It also consumes most of your engineering budget: schedule systems, despawn heuristics, agent pooling, LOD behaviors.

### Option 2 — Pure statistical (the SimCity 4 approach)

No individual people exist. Each building holds numbers: `residents: 240, employed: 180, avg_education: 2.1`. Commuting is solved in aggregate; traffic visuals are decorative animation keyed to computed volumes.

**What you buy:** near-unlimited scale (million-pop cities on a phone), simple to reason about, cheap to compute.

**What it costs:** the magic. Tap a car — it's nobody. Players probe these sims ("I demolished his house, where did he go?") and the illusion collapses; the game reads as a spreadsheet wearing a city costume. SC4 is still respected because its *aggregate math* was deep, but no one follows a citizen around in SC4, and modern players notice.

### Option 3 — Hybrid: statistical core + sampled live agents (recommended)

The aggregate layer is the **truth**; a bounded agent layer is a **live sample of it**.

- **Cohorts (truth):** every building tracks its population as small histograms — age bands × education × employment status. All demography, economy, land value, and demand math runs on cohorts. Cost is proportional to *buildings*, not people, so 500k population costs the same as 5k.
- **Traffic (truth):** trips aggregate into an origin–destination matrix each game-day; a **flow assignment** solver distributes trips over the road graph respecting capacity (iterative equilibrium assignment — congestion emerges because that's what equilibrium math produces; real transport planners model entire metros this way). Congestion per road segment is real, affects travel times, feeds back into land value and demand. Cost: one solve over a graph of ~10–50k edges per game-day plus incremental updates — milliseconds, scale-free in population.
- **Live agents (sample):** a fixed-size pool (e.g., 2,000–5,000 on phone, 10k+ on desktop, scaled to device) of citizens and vehicles *instantiated from the cohort distributions*. They pathfind for real along the flow field, are visible, tappable, followable. When you tap a cim, her story (name, age, home, job, commute) is sampled consistently from the cohorts she represents — and persists for as long as you watch her. The pool recycles agents far from camera.

**What you buy:** C:S-feel inspectability ("follow this citizen") + million-pop scalability + real congestion dynamics + a sim whose cost scales with *city geometry*, not population. Determinism is easy to keep (matters for D3 and for testing).

**The honest costs:**

1. **Two layers must agree.** If cohorts say Eastside is 40% unemployed, the sampled agents there must reflect that. This reconciliation is real engineering (the bug class is "visuals contradict the stats"), but it's bounded and testable.
2. **Persistence is partially illusion.** "Follow one citizen for her whole life" works while observed; an agent who leaves the pool and is later re-sampled is reconstructed from her cohort, not remembered individually. We can pin a small set (e.g., any cim you've named/favorited becomes permanently tracked — a few hundred permanently-tracked agents cost nothing). Worth knowing: C:S itself uses despawn/teleport tricks; full honesty was never on the table anywhere.
3. It requires designing two representations of one reality up front — this brief and the TDD are where we pay that cost.

**Rough phone budget to make it concrete** (written against a mid-range floor; the actual floor was later raised to iPhone 15 Pro-class, so treat these as the conservative bound — sim on its own worker thread, 10 sim-ticks/sec):

| System | Cost per tick (est.) |
|---|---|
| Cohort updates (10k buildings, staggered) | ~1–2 ms |
| Flow assignment (incremental, full solve 1×/game-day) | ~1–3 ms amortized |
| Live agent updates (3k agents, cached paths) | ~2–3 ms |
| Networks + services + economy | ~1 ms |
| **Total** | **~6–9 ms of a 100 ms tick** |

Comfortable headroom — which is what "performant" means as a design property rather than a hope.

**Recommendation: Option 3.** It's the only model that satisfies all three of your stated goals (fun = inspectable city, challenging = real congestion/economy feedback, performant = scale-free in population) on the platforms you chose.

---

## D3 — Online Scope (will become ADR-003)

You asked: *how much complexity does each level add?* In concrete engineering terms:

### Level 0 — Fully offline

No backend, no accounts, no ops, no privacy policy beyond boilerplate. Saves are local files; cross-device means manual export/import (share sheet → AirDrop/Drive). **Added complexity: zero.** Cost: phone↔desktop continuity — your stated reason for wanting a desktop version — becomes a chore players must perform.

### Level 1 — Offline + cloud save sync (recommended)

Everything plays offline; saves sync through a thin backend when online.

What it actually adds:

- **Auth:** Sign in with Apple + Google. Solved problem via BaaS (Supabase/Firebase) — days, not weeks.
- **Storage:** saves as compressed blobs (a city save will be ~1–5 MB). Trivial.
- **Conflict handling:** the only real design work. For single-player, last-writer-wins with a generation counter + "keep both" prompt on genuine forks is industry standard and fine. No CRDTs, no merging.
- **Compliance:** account deletion flow + privacy policy (app store requirements once accounts exist).

**Added complexity: roughly 3–5% of total project effort** — *if designed in from the start*. The save format must be versioned, deterministic, and compact — which we need anyway for testing and updates. Retrofitting later roughly triples the cost (auth touches UI everywhere; conflict edge cases multiply against an unversioned format).

### Level 2 — Cloud + community (sharing, leaderboards, challenges)

Adds: city upload/browse APIs, **moderation of user content** (names, city images — a permanent ops burden with legal edges, not a feature you ship once), leaderboards with anti-cheat, challenge content pipeline, server costs that scale with popularity.

**Added complexity: 15–25% of total effort, plus permanent operational load.** The good news: if the save format is deterministic and versioned (Level 1 work) and the sim is deterministic (D2 hybrid keeps this), then anti-cheat later is nearly free — a leaderboard entry is a replay the server re-simulates to verify. Nothing about deferring Level 2 forecloses it.

**Recommendation: Level 1 now, design formats so Level 2 is a later expansion, not a migration.**

---

## Pre-decided consequences (will become ADRs; no input needed unless you object)

These follow mechanically from the above and from the solo + AI-agent workflow:

- **Deterministic, fixed-timestep sim** (same inputs → bit-identical city). Enables: golden-master tests AI agents can run, replay-based anti-cheat, cloud-save integrity. Requires care with floats or fixed-point; policy set in the TDD.
- **Sim core as isolated package** — zero imports from rendering/UI. The escape hatch (Rust→WASM) and headless testing both depend on this wall staying intact.
- **AI division of labor:** Claude Code (Fable 5) = architecture, simulation systems, reviews, tests — the correctness-critical path. Codex = sprite/asset generation (its image gen via gpt-image-1.5 is now built into the agent workflow — [confirmed](https://developers.openai.com/codex/changelog)), parallelizable UI scaffolding, and second-opinion code reviews. Full protocol in the AI-workflow doc.
- **Monorepo, pnpm workspaces, strict TypeScript, Vitest** for the golden-master sim suite.

---

## Decide

1. **D1 Stack:** Web-first TS / Godot / Unity?
2. **D2 Sim model:** Hybrid / full-agent / statistical?
3. **D3 Online:** Offline-only / + cloud sync / + community?

Once locked, I build the full corpus: GDD at C:S depth, TDD, formal ADRs, chunked roadmap, and the AI workflow doc.
