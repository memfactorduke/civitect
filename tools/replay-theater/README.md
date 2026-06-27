# @civitect/replay-theater

Replay theater turns a human JSON replay into a deterministic timeline and an
optional static HTML scrubber. It is the TDD §13 bug-report view: same seed,
same terrain, same commands, same sampled frames.

## Usage

```sh
pnpm --filter @civitect/replay-theater render -- tools/replay-theater/fixtures/simple-replay.json
pnpm --filter @civitect/replay-theater render -- --sample-every 10 --html replay.html tools/replay-theater/fixtures/simple-replay.json
```

The JSON shape follows the golden scenario format, with commands carrying their
type by readable name or by numeric protocol id:

```json
{
  "name": "simple-replay",
  "seed": 20260627,
  "mapWidth": 32,
  "mapHeight": 32,
  "untilTick": 80,
  "startingFundsCents": 500000000,
  "terrainRects": [
    { "layer": "water", "x0": 0, "y0": 0, "x1": 1, "y1": 31, "value": 1 }
  ],
  "commands": [
    { "seq": 1, "tick": 0, "type": "buildRoad", "ax": 4, "ay": 8, "bx": 12, "by": 8, "roadClass": 1 }
  ]
}
```

The HTML output is self-contained and can be opened directly from disk. It
contains the sampled timeline JSON, a frame scrubber, state hash, money,
population, roads, buildings, demand, advisor count, and rejection count.
