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
// v5: path + bridge classes. v6: zoning/building commands + demand &
// building snapshot blocks (Phase 2). v7: zone layer rides snapshots.
// v8: agent transform rider contract + pin commands (Phase 3 tranche 3).
// v9: viewportHint message — the camera-aware sampler's input (ADR-002).
// v10: snapshot congestion block + inspector road info (GDD §9.5).
export const PROTOCOL_VERSION = 10;
