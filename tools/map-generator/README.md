# @civitect/map-generator

Seeded terrain/resource generation for the launch map catalog (GDD §3, TDD §13).

The committed catalog is deterministic:

- source archetypes live in `src/generate.ts`
- binary maps live in `maps/*.civmap`
- 1 px-per-tile previews live in `previews/*.png`
- `src/generate.test.ts` verifies generated maps against the committed artifacts

Regenerate missing catalog artifacts after adding archetypes:

```sh
SEED_FIXTURES=1 pnpm exec vitest run tools/map-generator/src/generate.test.ts
```

Run the normal catalog gate:

```sh
pnpm exec vitest run tools/map-generator/src/generate.test.ts
```
