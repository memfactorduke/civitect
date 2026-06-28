# Terrain and road-piece prompt template

Use for atlas category `terrain-roads`: road tiles, junctions, bridge portals,
transit stops, tunnel portals, pedestrian pieces, waterfront edges, and other
footprint-locked infrastructure sprites.

Attach style-bible references and any already-accepted nearby road/terrain
pieces before using this prompt. Infrastructure sprites must tile cleanly, so
consistency matters more than novelty.

## Prompt

```text
[STYLE]
Use the attached Civitect style-bible references exactly:
- True 2:1 isometric projection, fixed camera, no perspective convergence.
- Sun from northwest at about 45 degrees; shadows fall southeast and stay close
  to raised objects.
- Clean stylized city-builder atlas piece, readable at 50 percent zoom.
- Palette must stay close to the master 64-swatch ramps.
- Road markings and curb details must stay crisp after downscaling.

[SPEC]
Sprite id: {sprite-id}
Atlas category: terrain-roads
Piece type: {road segment, junction, bridge portal, stop, path, terrain edge}
Footprint: {w} x {d} tiles. One tile is 192 x 96 px at 3x.
Canvas: {canvas-w} x {canvas-h} px, transparent background.
Anchor: center-bottom of the footprint at ({anchor-x}, {anchor-y}) px.
Connectivity: {north/east/south/west/diagonal entries and exits}
Road class or mode: {street, avenue, boulevard, highway, tram, bus stop, etc.}

[CONTEXT]
This piece must tile against {neighboring piece ids or descriptions}. Preserve
lane width, curb height, median width, markings, pavement color, and shoulder
treatment across all pieces in the set.

[NEGATIVE]
No background. No perspective skew. No extra road stubs beyond the listed
connectivity. No vehicles unless the piece is explicitly a stop/portal marker.
No text labels. No large loose shadows that would overlap another tile.

[OUTPUT]
Return a transparent PNG for the normal state on the specified canvas. Do not
upscale. If the piece is not tileable against the references, say why instead
of inventing a different style.
```

## Sidecar checklist

- `id` names the geometry and variant, for example
  `street-straight-ns-a` or `avenue-fourway-signal-a`.
- `category` is `terrain-roads`.
- Use `normal` unless the protocol schema explicitly adds another state.
- Keep the anchor at center-bottom even for flat pieces; the renderer and atlas
  packer depend on it.

## Accepted variants

Append accepted prompt variants here after a batch passes `pnpm gate:assets`.
