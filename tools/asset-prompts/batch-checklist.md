# Asset batch checklist

Use this checklist for every Codex asset-production batch. The goal is to hand
Mem a taste-reviewable batch that is also mechanically close to runtime
acceptance.

## 1. Plan the batch

- Choose exactly one atlas category.
- Keep the batch zoom-consistent and visually adjacent in game.
- List every sprite id before generating images.
- Decide footprint, canvas, and anchor for each sprite up front.
- Attach the current style-bible references to every generation prompt.
- Read the relevant prompt template and use it verbatim except for placeholders.

## 2. Generate candidates

- Generate normal-state candidates first.
- Compare candidates at 50 percent scale.
- Compare candidates beside accepted style-bible references.
- Reject wrong camera, wrong sun direction, perspective convergence, or a style
  that reads as a different game.
- Do not AI-upscale. Generate at the required 3x source size or regenerate.

## 3. Produce required files

For each accepted sprite:

- Write one JSON sidecar next to the PNGs.
- Use the exact filenames listed in the sidecar.
- Building categories must include `normal`, `construction`, `abandoned`, and
  `emissive-mask`.
- Non-building categories must include `normal` and only schema-approved extra
  states.
- Keep all state PNGs on the same canvas.
- Keep all canvas corners transparent.

## 4. Run mechanical gates

Place the batch under:

```text
packages/assets/sprites/<category>/
```

Then run:

```sh
pnpm gate:assets
```

Gate failures belong to the batch owner. Fix or regenerate until the gate is
clean. Typical failures:

- Missing state file.
- Wrong canvas width for the footprint.
- Anchor not at center-bottom.
- Non-transparent background corner.
- Palette drift from the master 64-swatch ramps.

## 5. Handoff

Hand off only after the gate passes:

- Batch category and sprite id list.
- Contact sheet for Mem taste review.
- Gate command output.
- Any accepted prompt variants appended to the relevant template file.
- Any known style risks or repeated failure modes.

Do not call a batch runtime-ready until it passes `pnpm gate:assets`.
