# @civitect/assets

Atlas manifests + generated sprite metadata (TDD §1). Binary atlases live in
CDN/app bundle, never in git; `atlases/` is gitignored.

No code lives here. Runtime source sprites enter **only** under `sprites/` via
the `tools/sprite-intake` gates (ADR-012): 3x PNGs plus sidecars validated for
dimensions, anchor, footprint, required states, transparent background, and the
master 64-swatch ramp set.

## Runtime Sprite Tree

Use one category directory per protocol category:

- `sprites/terrain-roads/`
- `sprites/residential/`
- `sprites/commercial/`
- `sprites/industrial/`
- `sprites/office/`
- `sprites/services/`
- `sprites/agents/`
- `sprites/effects/`
- `sprites/ui-icons/`

Each accepted sprite gets its own folder under the category:

```text
sprites/terrain-roads/two-lane-straight/
  two-lane-straight.json
  normal.png
```

Building categories (`residential`, `commercial`, `industrial`, `office`, and
`services`) must also ship `construction`, `abandoned`, and `emissive-mask`
state PNGs in the sidecar.

Exploration art, contact sheets, prompt outputs, and failed generations do not
belong here. Keep them in the art-review workspace until the sidecar and PNGs
pass the intake gate.

## Gate

Run either command before handing off an accepted batch:

```sh
pnpm --filter @civitect/assets gate
pnpm gate:assets
```

An empty `sprites/` tree is allowed; it is still scanned by the same gate that
will validate the first runtime batch.
