# @civitect/sprite-intake

ADR-012 mechanical gates for source sprites: strict sidecar schema, PNG
dimension/anchor checks, transparent-corner background checks, and the
64-swatch palette lint.

## Commands

```sh
pnpm --filter @civitect/sprite-intake gate
pnpm --filter @civitect/sprite-intake report /path/to/art-exploration/cel-shaded
```

`gate` is the runtime acceptance check. It scans `packages/assets/sprites`, and
only a passing gate means an asset is runtime-eligible.

`report` is a read-only audit for exploration folders. It checks strict ADR-012
sidecars first, then applies mechanical in-memory mappings for known exploration
sidecar shapes so a stale art checkout can be triaged without copying or
editing its files.

## Exploration mappings

| Exploration category | Runtime category | Current status |
|---|---|---|
| `roads/*` | `terrain-roads` | Closest path: tile footprint and center-bottom anchor already match the runtime contract; normalize sidecars, then fix any pixel-gate failures. |
| `icons/*` | `ui-icons` | Blocked by the current strict footprint schema: exploration icons use UI-space `0x0` footprints and center anchors. |
| `props` | none | Blocked until `protocol` gets an explicit runtime category or the art is assigned to an existing category by Claude Code. |
| `buildings/growable/*` | zone category | Blocked until every building has construction, abandoned, and emissive-mask states plus gate-sized canvases. |

Do not treat `normalized-pass` report rows as imported content. They are only a
safe next-batch shortlist; runtime acceptance still means normalized files live
under `packages/assets/sprites` and `pnpm gate:assets` passes.
