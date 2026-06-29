# @civitect/assets

Atlas manifests + generated sprite metadata (TDD §1). Binary atlases live in
CDN/app bundle, never in git; `atlases/` is gitignored.

Content enters **only** via the `tools/sprite-intake` gates (ADR-012):
packer-validated sidecars, palette-linted against the master 64-swatch ramp
set.

The runtime manifest helper gives the app/tooling side a cheap readiness check:
accepted assets must have a JSON sidecar, a normal PNG state, complete building
states, valid footprints/anchors, and no duplicate category/id pairs. Placeholder
assets and missing runtime categories stay visible as warnings so a build can
tell the difference between "playable with placeholders" and "ready to ship".
