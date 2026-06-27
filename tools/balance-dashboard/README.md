# @civitect/balance-dashboard

Read-only balance-report helpers for Civitect tuning data (TDD §13).

The first version is intentionally file-based: it accepts balance samples from
CI, experiments, or hand-exported runs and produces deterministic summaries that
can later feed a browser dashboard.

Input may be a JSON array of samples or an object with `samples` and optional
`bands`:

```json
{
  "samples": [
    { "scenario": "growth-city", "tick": 0, "metrics": { "population": 0 } },
    { "scenario": "growth-city", "tick": 1440, "metrics": { "population": 128 } }
  ],
  "bands": [
    { "scenario": "growth-city", "metric": "population", "min": 100, "max": 5000 }
  ]
}
```

Run the CLI:

```sh
pnpm --filter @civitect/balance-dashboard report -- tools/balance-dashboard/fixtures/balance-samples.json
pnpm --filter @civitect/balance-dashboard report -- --csv tools/balance-dashboard/fixtures/balance-samples.json
```

Run tests:

```sh
pnpm --filter @civitect/balance-dashboard test
```
