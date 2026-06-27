# Runtime Sprite Sources

This tree is the only checked-in landing zone for runtime-eligible sprite
sources. Every sprite must be a 3x PNG batch plus an ADR-012 JSON sidecar that
passes `pnpm --filter @civitect/assets gate`.

Keep one sprite per folder under its protocol category. Do not store generated
atlases here; `packages/assets/atlases/` is gitignored because atlases are build
artifacts.

