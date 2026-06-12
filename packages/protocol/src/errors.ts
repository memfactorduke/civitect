/** Base class for every protocol failure — catchable as one family at the worker boundary. */
export class ProtocolError extends Error {}

/**
 * Encoding rejected out-of-range input (e.g. a non-integer where a u16 belongs).
 * Loud failure here is deliberate: DataView would silently wrap, and silent
 * wrapping is exactly the corruption class the determinism contract forbids.
 */
export class EncodeError extends ProtocolError {}

/** Malformed or truncated bytes. Protocol messages are never "best effort" — hard error. */
export class DecodeError extends ProtocolError {}

/**
 * Version stamp mismatch. TDD §7: mismatch = hard error at boot — no silent
 * drift between a deployed web sim worker and a cached shell.
 */
export class ProtocolVersionMismatchError extends ProtocolError {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(
      `protocol version mismatch: this build speaks v${expected}, peer message is v${actual} ` +
        "— hard error at boot (TDD §7)",
    );
    this.expected = expected;
    this.actual = actual;
  }
}
