/**
 * Stamped into every message envelope (TDD §7) and checked before any body
 * byte is read.
 *
 * Hard rule (CLAUDE.md, ADR-006/010): ANY wire-layout change bumps this —
 * the fixed-vector tests in envelope.test.ts exist to make a layout change
 * impossible to miss. Wire ids (message kinds, command types, entity kinds,
 * reason codes) are append-only; never renumber.
 */
// v2: save/load kinds. v3: road commands. v4: road snapshots.
// v5: path + bridge road classes (tasks 12d/12e).
export const PROTOCOL_VERSION = 5;
