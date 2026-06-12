/**
 * Phase 0 boot constants, shared by the main thread and the sim worker —
 * both sides import these, so no boot traffic crosses the worker boundary
 * at all (protocol v1 stays the complete vocabulary of what does cross).
 *
 * Real boot flows replace this: new-game params come from map selection
 * (ROADMAP Phase 1), loaded games from the .civ header (board PR 8/9).
 */
export const BOOT = {
  seed: 1234,
  mapWidth: 64,
  mapHeight: 64,
} as const;
