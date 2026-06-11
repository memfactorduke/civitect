# Civitect — Art Prompt Library

**Status: style-discovery phase.** Per AI-WORKFLOW §5, this file is the art pipeline's source code: every prompt that produced an *accepted* image gets logged here verbatim. Production batch templates move to `tools/asset-prompts/` at Phase 0 scaffold; the style bible itself becomes `docs/art/STYLE-BIBLE.md` once Round 3 winners are curated (ADR-012).

---

## Shared constraints block (paste into every prompt)

```
- True 2:1 isometric (dimetric) projection, classic SimCity/Anno tile look.
  No perspective convergence, no camera variation between images.
- Sunlight from the northwest at ~45°; shadows fall southeast, tight to the
  building. Flat ambient occlusion only — no dramatic lighting.
- Single subject, transparent background, thin sidewalk apron only.
- Must read clearly at 50% scale: bold silhouette, no noisy micro-detail.
```

## Round 1 — direction exploration (one subject × 6 styles)

```
You're establishing the art style for Civitect, an isometric city builder.

Generate 6 images of the SAME building — a modest two-story corner shop,
ground-floor storefront with an apartment above — each in a different
style direction. Keep composition identical across all 6 so the styles
compare cleanly.

[SHARED CONSTRAINTS BLOCK]

The 6 directions:
1. Crisp vector-flat — solid fills, thin dark linework (modern board-game art)
2. Painterly stylized — soft hand-painted texture, warm (Anno 1800, toned down)
3. HD pixel-art-inspired — clean pixel clusters, limited dithering
4. Toy/miniature — rounded, saturated, slightly exaggerated (Townscaper warmth)
5. Muted realist — restrained palette, believable materials (SC4 modernized)
6. Bold cel-shaded — two-step shading, confident color blocking

Name them style-01.png … style-06.png, then add one line per style on how
well it would stay consistent across 250+ generated buildings.
```

## Round 2 — pressure test (winning style × 4 subjects + night)

```
Style direction locked: [PASTE WINNING DESCRIPTION + ATTACH WINNING IMAGE].

In exactly this style, generate 4 different buildings:
1. small detached suburban house with a fenced yard
2. 12-story glass-and-concrete apartment tower
3. small factory with a smokestack and loading dock
4. pocket park: trees, path, fountain (vegetation is the hard test)

[SHARED CONSTRAINTS BLOCK]

Then re-render image 1 as a NIGHT variant: same sprite, windows warmly lit,
a porch light, everything else darkened only slightly (the game darkens the
scene; the sprite supplies emissive windows).

Finally compose all images side by side on one contact sheet aligned to a
2:1 isometric grid — adjacency is where style incoherence shows.
```

Judge Round 2 hard: if the four subjects don't look like one game, iterate the direction before Round 3 — cheap now, expensive later.

## Round 3 — style-bible seed batch (12 heroes × 2–3 candidates)

The 12 heroes (spread across zones, materials, footprint scales):

| # | Subject | Covers |
|---|---|---|
| 1 | Small detached house | R-low, wood/siding, 1×1 |
| 2 | Suburban duplex | R-low upper level, 2×2 |
| 3 | Brownstone walk-up | R-high, brick, 2×2 |
| 4 | Modern apartment tower | R-high L4+, glass/concrete, 3×3 tall |
| 5 | Corner shop (Round 1 winner, regenerate clean) | C-low, mixed facade |
| 6 | Supermarket with parking apron | C-low L3, big footprint 4×3 |
| 7 | Glass office mid-rise | Office, curtain wall, 3×3 |
| 8 | Small factory, smokestack + dock | I-generic, steel/brick |
| 9 | Grain farm with silo | I-farming, vegetation + metal |
| 10 | Fire station with bay doors | Services, civic red |
| 11 | Elementary school with yard | Services, civic friendly |
| 12 | Pocket park with fountain | Parks, pure vegetation |

```
Style locked per attached references [ATTACH ROUND 2 SET].
Generate [SUBJECT N] in exactly this style, 3 distinct candidates
(vary architecture, not style).

[SHARED CONSTRAINTS BLOCK]
```

One subject per message; attach the running set of accepted images to each new prompt — the reference set is what holds style steady.

---

## Judging checklist (Mem's curation pass)

1. **The 50% test:** zoom every candidate to half size. If you can't tell what it is instantly, reject.
2. **The adjacency test:** view candidates on the contact sheet next to already-accepted heroes. Reject anything that reads as a different game.
3. **Judge style, not geometry.** Slightly-off angles, canvas size, background remnants — all fixed mechanically by sprite-intake later. Do NOT reject for those. DO reject perspective convergence (unfixable) and wrong sun direction (expensive).
4. **Palette gut-check:** colors should feel sampled from one ramp set. Mild drift is fixable (palette snap); a clashing color *language* is not.
5. **Keep everything accepted, verbatim-log the prompt that made it.** Winners become the conditioning references for all 250+ production sprites and the source of the master 64-swatch ramps (ADR-012).

## Accepted images log

| Date | Image | Prompt ref | Notes |
|---|---|---|---|
| — | — | — | populate as winners are accepted |
