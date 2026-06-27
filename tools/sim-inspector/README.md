# @civitect/sim-inspector

Read-only inspection helpers for Civitect artifacts (TDD §13).

The inspector decodes files through `@civitect/protocol` only:

- `.civmap` files summarize terrain, water, zones, districts, and resources.
- `.civ` saves summarize header/world state, terrain, roads, buildings, traffic,
  services, economy, goods-chain, districts, pins, and command-tail counts.

Run the CLI against one or more artifacts:

```sh
pnpm --filter @civitect/sim-inspector inspect -- tools/map-generator/maps/river-valley.civmap
pnpm --filter @civitect/sim-inspector inspect -- packages/protocol/fixtures/saves/v10/empty-world-y1.civ
```

Run the tests:

```sh
pnpm --filter @civitect/sim-inspector test
```
