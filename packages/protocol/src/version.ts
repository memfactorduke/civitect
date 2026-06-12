/**
 * Stamped into every message envelope (TDD §7) and checked before any body
 * byte is read.
 *
 * Hard rule (CLAUDE.md, ADR-006/010): ANY wire-layout change bumps this —
 * the fixed-vector tests in envelope.test.ts exist to make a layout change
 * impossible to miss. Wire ids (message kinds, command types, entity kinds,
 * reason codes) are append-only; never renumber.
 */
// v2: save/load message kinds (board PR 9). v3: road command vocabulary
// — buildRoad/bulldozeRoad/upgradeRoad/undo/redo (phase-1 board task 5).
export const PROTOCOL_VERSION = 3;
