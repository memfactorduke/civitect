# ADR-004 — Isometric 2.5D, fixed orientation

**Status:** Accepted · 2026-06-11

## Context
Camera/style determines renderer, art pipeline, and performance envelope. The art department is AI image generation (Codex/gpt-image — produces excellent 2D sprites, not game-ready 3D models). Mobile-first readability and battery matter.

## Decision
Fixed-orientation isometric 2.5D (2:1 ratio, 64×32 px tile at 1×). No camera rotation at v1. Stepped 5-terrace elevation. Day/night via grading + emissive layers. Sprite-based buildings with state variants (construction/abandoned/fire/etc.). Direction codified in the style bible (`docs/art/STYLE-BIBLE.md`, produced with the first asset batch).

## Consequences
- Asset pipeline = PNG sprites → directly compatible with AI image generation at scale (the only viable solo art strategy at this content volume: GDD §18).
- Excellent mobile perf (sprite batching, baked chunks — TDD §8); depth must come from simulation, which is the design thesis anyway.
- We accept: no rotation (occlusion handled by zoom + transparency-on-tap), no freeform road curves (grid + 45° diagonals — GDD §5), stepped rather than smooth terrain.
- Rotation later would require 4-view sprite sets — possible (regenerate via pipeline) but a major content op; not promised.

## Alternatives
- **Full 3D free camera:** rejected — needs a 3D asset pipeline we don't have a solo path for; heavy on mobile.
- **3D fixed camera:** rejected — pays 3D pipeline costs without gaining the iso sprite pipeline's AI-gen advantage.
