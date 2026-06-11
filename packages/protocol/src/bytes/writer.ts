/**
 * Growable little-endian byte writer. Little-endian everywhere — same
 * endianness as the .civ save format (TDD §10), one convention for the
 * whole project.
 *
 * Every write range-checks its input and throws EncodeError instead of
 * letting DataView silently wrap — wrapped values would still decode
 * "successfully" and corrupt state downstream.
 */
import { EncodeError } from "../errors";
import { utf8Encode } from "./utf8";

const TWO_POW_32 = 0x1_0000_0000;

function assertUint(value: number, bits: 8 | 16 | 32, label: string): void {
  const max = 2 ** bits - 1;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new EncodeError(`${label}: ${value} is not a u${bits}`);
  }
}

export class ByteWriter {
  #buf: Uint8Array;
  #view: DataView;
  #len = 0;

  constructor(initialCapacity = 256) {
    this.#buf = new Uint8Array(initialCapacity);
    this.#view = new DataView(this.#buf.buffer);
  }

  get length(): number {
    return this.#len;
  }

  #ensure(extra: number): void {
    const needed = this.#len + extra;
    if (needed <= this.#buf.length) {
      return;
    }
    let capacity = this.#buf.length * 2;
    while (capacity < needed) {
      capacity *= 2;
    }
    const next = new Uint8Array(capacity);
    next.set(this.#buf);
    this.#buf = next;
    this.#view = new DataView(next.buffer);
  }

  u8(value: number): this {
    assertUint(value, 8, "u8");
    this.#ensure(1);
    this.#view.setUint8(this.#len, value);
    this.#len += 1;
    return this;
  }

  u16(value: number): this {
    assertUint(value, 16, "u16");
    this.#ensure(2);
    this.#view.setUint16(this.#len, value, true);
    this.#len += 2;
    return this;
  }

  u32(value: number): this {
    assertUint(value, 32, "u32");
    this.#ensure(4);
    this.#view.setUint32(this.#len, value, true);
    this.#len += 4;
    return this;
  }

  /** Unsigned 64-bit as two u32s (low first). Exact for 0 … 2^53-1 — ticks fit for millennia. */
  u64(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new EncodeError(`u64: ${value} is not a non-negative safe integer`);
    }
    this.u32(value % TWO_POW_32);
    this.u32(Math.floor(value / TWO_POW_32));
    return this;
  }

  /** Signed 64-bit (two's complement, low u32 first). Money lives here: integer cents (ADR-005). */
  i64(value: number): this {
    if (!Number.isSafeInteger(value)) {
      throw new EncodeError(`i64: ${value} is not a safe integer`);
    }
    this.#ensure(8);
    // ToUint32 (>>> 0) yields the correct low 32 bits for any integer; floor
    // division yields the matching high word (negative for negative values,
    // which setUint32 wraps to two's complement).
    this.#view.setUint32(this.#len, value >>> 0, true);
    this.#view.setUint32(this.#len + 4, Math.floor(value / TWO_POW_32) >>> 0, true);
    this.#len += 8;
    return this;
  }

  /** Length-prefixed (u16, byte count) UTF-8 string. i18n keys, not prose — 64 KiB is plenty. */
  str(value: string): this {
    const bytes = utf8Encode(value);
    if (bytes.length > 0xffff) {
      throw new EncodeError(`str: ${bytes.length} bytes exceeds u16 length prefix`);
    }
    this.u16(bytes.length);
    this.bytes(bytes);
    return this;
  }

  bytes(value: Uint8Array): this {
    this.#ensure(value.length);
    this.#buf.set(value, this.#len);
    this.#len += value.length;
    return this;
  }

  /** Patch a previously written u32 (envelope body-length backfill). */
  patchU32(offset: number, value: number): void {
    assertUint(value, 32, "patchU32");
    if (!Number.isInteger(offset) || offset < 0 || offset + 4 > this.#len) {
      throw new EncodeError(`patchU32: offset ${offset} outside written range`);
    }
    this.#view.setUint32(offset, value, true);
  }

  /** Copy out the written bytes (the writer stays reusable until GC'd). */
  finish(): Uint8Array {
    return this.#buf.slice(0, this.#len);
  }
}
