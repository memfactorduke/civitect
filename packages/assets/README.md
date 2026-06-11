# @civitect/assets

Atlas manifests + generated sprite metadata (TDD §1). Binary atlases live in
CDN/app bundle, never in git; `atlases/` is gitignored.

No code lives here. Content enters **only** via the `tools/sprite-intake`
gates (ADR-012): packer-validated sidecars, palette-linted against the master
64-swatch ramp set. First content: the style-bible seed batch
(ROADMAP Phase 0, after board PR 11 lands the toolchain).
