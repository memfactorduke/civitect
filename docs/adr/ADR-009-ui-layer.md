# ADR-009 — React DOM overlay for game UI

**Status:** Accepted · 2026-06-11

## Context
City builders are panel-heavy (inspectors, budgets, line editors — text, tables, scrolling). Two render targets exist: in-canvas UI (Pixi) or DOM overlay. AI-agent fluency matters: React has the deepest agent competence of any UI tech.

## Decision
React 19 in a DOM layer above the canvas for all panels/HUD/menus; zustand for client state fed by snapshot scalars + 4 Hz inspector polling; commands dispatched via protocol only (no sim imports — ADR-006). In-world elements that must sit *in* the scene (building badges, placement ghosts) render in Pixi; the split rule: **if it scrolls or contains paragraphs, it's DOM; if it's anchored to a world position, it's Pixi.** Cause-chain inspector is a generic component over protocol `CauseChain` payloads; advisor events without cause chains fail typecheck (pillar-2 enforcement, TDD §9).

## Consequences
- Free: accessibility, text layout, scrolling physics, dynamic type, i18n, container-query responsive panels (one component set for phone sheet / desktop dock).
- Agents ship UI fast and correctly; React perf is irrelevant to frame rate (world is Pixi's).
- We accept: two rendering worlds with a clear boundary rule, careful z-index/input routing at the seam (solved once in app shell).

## Alternatives
- Pixi-native UI: rejected — rebuilding text layout/scrolling/accessibility by hand for panel-heavy UX.
- Svelte/Solid: fine technologies; rejected on agent-fluency + ecosystem grounds — this project optimizes for AI velocity (ADR-001 logic).
