# ADR-012 — AI-generated sprite pipeline with mechanical gates

**Status:** Accepted · 2026-06-11

## Context
GDD §18 needs ~250+ building/infrastructure sprites with state variants — far beyond solo hand-pixeling. Codex now generates images in-workflow (gpt-image-1.5). The #1 risk of AI art at volume is **style drift** across batches; the #2 is spec violations (size/anchor/footprint). Both must be caught mechanically, not by eyeballing.

## Decision
- **Style bible first:** before mass production, one curated seed set (~12 hero sprites) defines palette, line weight, sun direction (NW), material rendering; every generation prompt conditions on style-bible reference images + a standard prompt template (AI-WORKFLOW §Codex).
- **Spec contract:** sprites delivered as 3× PNG + JSON sidecar (footprint, anchor, states, emissive mask); schema lives in `packages/protocol`.
- **Mechanical gates in CI [binding]:** atlas packer validates dimensions/anchor/footprint against sidecar; palette linter quantizes and rejects deviation beyond threshold from the master 64-swatch ramp set; missing state variants fail the build. Human review is for *taste*, machines check *consistency*.
- Post-process toolchain (`tools/`): background removal, palette snap, shadow normalization, 3×→2×/1× downscale (fixed kernel; never AI upscaling), atlas packing per category.

## Consequences
- Art scales with prompt iterations, not artist hours; coherence is enforced where it's enforceable.
- We accept: generation iteration cost (some sprites take many attempts), hero/landmark sprites may need manual touch-up, style bible is a hard dependency of every content phase (sequenced first in ROADMAP phase 0/1).

## Alternatives
- Commissioned artist: highest coherence; rejected as primary path (cost/iteration speed; remains an option for hero landmarks later).
- Purchased asset packs: rejected — generic look, license tangles, never matches a custom catalog of this breadth.
- Hand pixel art: rejected — content volume makes it a multi-year solo project by itself.
