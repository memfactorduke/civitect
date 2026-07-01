# Building sprite prompt template

Use for atlas categories `residential`, `commercial`, `industrial`, `office`,
and `services`.

Attach the current style-bible reference set before using this prompt. Replace
all `{placeholders}`. Keep one subject per generation request when the sprite is
important; use contact sheets only for quick candidate exploration.

## Prompt

```text
[STYLE]
Use the attached Civitect style-bible references exactly:
- True 2:1 isometric projection, fixed camera, no perspective convergence.
- Sun from northwest at about 45 degrees; shadows fall southeast and stay tight
  to the footprint.
- Clean stylized city-builder sprite, readable at 50 percent zoom.
- Palette must stay close to the master 64-swatch ramps; prefer controlled
  material colors over gradients.
- Line weight about 1 px at 3x, no outline glow, flat ambient occlusion only.

[SPEC]
Sprite id: {sprite-id}
Atlas category: {category}
Subject: {short subject name}
Zone/level/use: {zone, level, or service role}
Footprint: {w} x {d} tiles. One tile is 192 x 96 px at 3x.
Canvas: {canvas-w} x {canvas-h} px, transparent background.
Anchor: center-bottom of the footprint at ({anchor-x}, {anchor-y}) px.

Generate four matching state sprites on the same canvas:
1. normal - active, clean, game-ready.
2. construction - scaffold, partial structure, same footprint and anchor.
3. abandoned - desaturated, worn, readable as the same building.
4. emissive-mask - black transparent-compatible mask with only night-lit
   windows/signage/streetlights in white or warm light; no scene lighting.

[CONTEXT]
This sprite sits next to {adjacent reference subjects}. It must share their
camera, sun direction, material language, palette, and line weight. It should
remain identifiable when scaled to 50 percent.

[NEGATIVE]
No photorealism. No 3D render look. No perspective skew. No camera rotation.
No drop shadow outside the footprint. No background, skyline, ground plane,
text labels, people posing for the camera, or decorative effects that would not
belong in a tile atlas.

[OUTPUT]
Return separate transparent PNGs for the four states. Do not upscale. If a
state cannot be produced consistently, return the normal state only and say
which states need regeneration.
```

## Sidecar checklist

Write the sidecar after selecting the final PNGs:

- `id` is kebab-case and unique inside the category.
- `category` is one of the protocol atlas categories.
- `footprint.w` and `footprint.d` are integers from 1 to 8.
- `canvas.w` equals `(footprint.w + footprint.d) * 96`.
- `anchor.x` is the horizontal center of the canvas.
- `anchor.y` is the bottom of the canvas.
- `states` points to the exact sibling PNG filenames.

## Accepted variants

Append accepted prompt variants here after a batch passes `pnpm gate:assets`.
