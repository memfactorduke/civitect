# e2e/

Playwright device-profile runs + the golden-city suite (TDD §1/§12).

Arrives in pieces (docs/board/phase-0.md):

- **PR 4** — golden harness + first golden `empty-city-01` (1 game-year replay,
  hash-stable) + perf measurement (TDD §2 gates).
- **PR 7** — boot smoke: tap → command → sim → snapshot → highlight, asserting
  the <50 ms input→visual budget.
- **PR 12** — determinism cross-check: same replays in Node/Chromium/WebKit
  must hash-agree (TDD §12.6).
