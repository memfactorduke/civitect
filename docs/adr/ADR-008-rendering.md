# ADR-008 — PixiJS v8 rendering architecture

**Status:** Accepted · 2026-06-11

## Context
Iso sprite city, 60fps on iPhone 15 Pro-class, big static world + thousands of moving agents + data overlays. PixiJS v8 is the mature WebGL/WebGPU 2D batch renderer; its own guidance: WebGL for production, WebGPU still stabilizing.

## Decision
PixiJS v8 on **WebGL** (WebGPU behind a flag, adopt when stable across WebViews). Architecture (TDD §8): baked 32×32-tile chunk render-textures for static world; atlas-batched building sprites with precomputed iso sort keys; instanced agent layer fed by transferable/SAB transform buffers; paletted-texture data overlays; budget-capped particle effects; 3-tier zoom LOD (far: chunks + flow particles · mid: full buildings · near: full detail); day/night = LUT grade + emissive layer; chunk frustum culling; DPR cap 2.

## Consequences
- Render cost scales with *visible* complexity, not city size; static world costs ~zero per frame after bake.
- 120Hz ProMotion: camera interpolation only (sim view at 60) — smoothness where users feel it, no doubled sim/render load.
- We accept: re-bake cost on edits (amortized, dirty-chunk only), atlas memory management (lazy category pages, TDD §11), WebGL feature floor (no compute — overlays generated CPU-side, fine at our sizes).

## Alternatives
- Three.js (2D-in-3D): rejected — pays 3D scene-graph costs without benefit for sprites.
- Custom WebGL renderer: rejected — Pixi's batcher is the hard part and it's excellent; we'd reinvent it worse.
- Canvas2D fallback tier: rejected — device floor (TDD §2) makes WebGL universal.
