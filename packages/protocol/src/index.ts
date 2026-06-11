/**
 * @civitect/protocol — the contract: shared types + binary codecs for
 * commands, snapshots, inspector queries, and saves (TDD §7/§10, ADR-006/010).
 *
 * Placeholder shell: v1 codecs land per docs/board/phase-0.md PR 2
 * (commands/snapshots/inspector) and PR 8 (.civ save sections).
 *
 * Binding rules once real (CLAUDE.md): every layout change bumps the protocol
 * version and ships a symmetric encode∘decode property test; this package
 * depends on no other workspace package (dependency-cruiser enforced).
 */
export const PROTOCOL_PACKAGE = "@civitect/protocol";
