# ADR-010 — Versioned binary save format

**Status:** Accepted · 2026-06-11

## Context
Saves must be: compact (cloud blobs, ADR-003), fast to load (TDD §2), versioned across years of rule changes, and future-proof for sharing/replays (ADR-003 format-forward rule). JSON dumps fail compact+fast at SoA-table scale.

## Decision
Sectioned binary `.civ` (full spec TDD §10): header (magic, formatVersion, simVersion, seed, tick, per-section xxhash64 checksums) + independently compressed sections (terrain RLE, road graph, building tables, quantized cohorts, networks, economy, districts/policies, pinned agents, settings, command tail). Native `CompressionStream('deflate-raw')`, fflate fallback. **Migration framework [binding]:** every formatVersion bump ships a migration function tested against archived fixture saves of all prior versions; CI keeps the fixture corpus loading forever. Autosave: 3 rolling slots; checksum-verified crash recovery.

## Consequences
- L-map save ≈ 1–4 MB → trivial sync blobs, fast loads, lossless replays (snapshot + command tail).
- Saves survive every future rules change by construction; "old save broke" is a CI failure class, not a player experience.
- We accept: codec discipline (protocol package owns layouts), fixture-corpus maintenance, binary opacity (mitigated: `tools/` save-inspector dumps any section to JSON).

## Alternatives
- JSON(+gzip): rejected — 5–10× size, slow parse, no partial-section reads.
- SQLite-wasm: rejected — heavyweight dependency for write-once/read-once blobs.
- Protobuf/flatbuffers: viable; rejected to keep zero-codegen toolchain — hand codecs over SoA tables are simple and the protocol package already owns them.
