# Civitect asset prompt templates

Production prompt templates for Codex sprite batches live here. This directory
is the source-controlled bridge between the style-discovery notes in
`docs/art/PROMPT-LIBRARY.md` and runtime assets accepted by
`tools/sprite-intake`.

Use these templates only after Mem has chosen the style-bible references for
the batch. A reviewed image is not runtime-ready until it has matching PNG
state files, a JSON sidecar, and a clean sprite-intake gate.

## Batch inputs

Every production batch needs:

- Style-bible reference images attached to the generation prompt.
- One atlas category from `packages/protocol/src/sprite.ts`.
- One zoom-consistent subject set, usually 30-60 sprites.
- A footprint plan in tiles, where one tile at 3x is 192 x 96 px.
- State requirements before generation starts.

Building categories (`residential`, `commercial`, `industrial`, `office`, and
`services`) must produce these four states:

- `normal`
- `construction`
- `abandoned`
- `emissive-mask`

Other categories still need `normal`, and may add schema-approved states only.

## Files

- `building-sprite.md`: production template for growables, services, offices,
  and other placed buildings.
- `terrain-road-piece.md`: production template for roads, terrain-adjacent
  pieces, stops, portals, and similar footprint-locked infrastructure sprites.
- `batch-checklist.md`: handoff checklist for batch planning, generation,
  sidecars, gate runs, and Mem review.

## Output contract

A submitted sprite is one sidecar plus sibling PNG state files. The sidecar
must match the protocol schema and the intake validator:

```json
{
  "id": "suburban-house-l1-a",
  "category": "residential",
  "footprint": { "w": 1, "d": 1 },
  "canvas": { "w": 192, "h": 240 },
  "anchor": { "x": 96, "y": 240 },
  "states": {
    "normal": "suburban-house-l1-a.png",
    "construction": "suburban-house-l1-a-construction.png",
    "abandoned": "suburban-house-l1-a-abandoned.png",
    "emissive-mask": "suburban-house-l1-a-emissive-mask.png"
  }
}
```

The expected canvas width is `(footprint.w + footprint.d) * 96` pixels at 3x.
The anchor is the center-bottom point of the footprint: horizontal canvas
center, canvas bottom. Keep alpha transparent at the canvas corners.

## Verification

After files are placed under `packages/assets/sprites/<category>/`, run:

```sh
pnpm gate:assets
```

Regenerate or fix any gate failure before handing the batch to Mem. Do not
argue with the gate: it is the mechanical part of the art contract.

Accepted prompt variants should be appended to the relevant template file under
an "Accepted variants" section with the date, sprite ids, and notes.
