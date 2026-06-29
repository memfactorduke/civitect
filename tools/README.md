# tools/

Developer tooling — all web apps, AI agents can extend them (TDD §13).

Implemented residents:

| Tool | Spec | Notes |
|---|---|---|
| `replay-theater/` | TDD §13 | Bug-report replay JSON to deterministic timeline + static HTML scrubber. |

Planned residents (each arrives with the phase that needs it):

| Tool | Spec | Arrives |
|---|---|---|
| `sprite-intake/` + atlas packer + palette linter | ADR-012, TDD §11 | Phase 0 (board PR 11) |
| `asset-prompts/` (Codex prompt library) | AI-WORKFLOW §5 | Phase 0, with the style bible |
| Sim inspector | TDD §13 | Phase 2+ |
| Balance dashboard | TDD §13 | Phase 2 |
| Map generator | TDD §13 | Phase 1 |
| Replay theater | TDD §13 | Phase 3+ |
