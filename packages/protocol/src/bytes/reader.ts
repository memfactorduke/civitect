/**
 * Bounds-checked little-endian reader over a Uint8Array view. Every read
 * validates remaining length first; truncated or oversized input is a
 * DecodeError, never a silent zero or an engine RangeError.
 */
import { DecodeError } from "../errors";
import { utf8Decode } from "./utf8";

const TWO_POW_32 = 0x1_0000_0000;

export class ByteReader {
  #bytes: Uint8Array;
  #view: DataView;
  #off = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.#off;
  }

  get remaining(): number {
    return this.#bytes.length - this.#off;
  }

  #need(n: number, label: string): void {
    if (this.#off + n > this.#bytes.length) {
      throw new DecodeError(
        `${label}: need ${n} bytes at offset ${this.#off}, only ${this.remaining} remain`,
      );
    }
  }

  u8(): number {
    this.#need(1, "u8");
    const v = this.#view.getUint8(this.#off);
    this.#off += 1;
    return v;
  }

  u16(): number {
    this.#need(2, "u16");
    const v = this.#view.getUint16(this.#off, true);
    this.#off += 2;
    return v;
  }

  u32(): number {
    this.#need(4, "u32");
    const v = this.#view.getUint32(this.#off, true);
    this.#off += 4;
    return v;
  }

  u64(): number {
    this.#need(8, "u64");
    const lo = this.#view.getUint32(this.#off, true);
    const hi = this.#view.getUint32(this.#off + 4, true);
    this.#off += 8;
    const v = hi * TWO_POW_32 + lo;
    if (!Number.isSafeInteger(v)) {
      throw new DecodeError(`u64: value exceeds Number.MAX_SAFE_INTEGER (hi=${hi}, lo=${lo})`);
    }
    return v;
  }

  i64(): number {
    this.#need(8, "i64");
    const lo = this.#view.getUint32(this.#off, true);
    const hi = this.#view.getInt32(this.#off + 4, true); // signed high word
    this.#off += 8;
    const v = hi * TWO_POW_32 + lo;
    if (!Number.isSafeInteger(v)) {
      throw new DecodeError(`i64: value outside safe-integer range (hi=${hi}, lo=${lo})`);
    }
    return v;
  }

  str(): string {
    const len = this.u16();
    this.#need(len, "str");
    const s = utf8Decode(this.#bytes.subarray(this.#off, this.#off + len));
    this.#off += len;
    return s;
  }

  bytes(n: number): Uint8Array {
    this.#need(n, "bytes");
    const out = this.#bytes.slice(this.#off, this.#off + n);
    this.#off += n;
    return out;
  }

  /** Codecs must consume exactly their bytes — trailing garbage means a layout disagreement. */
  expectEnd(): void {
    if (this.remaining !== 0) {
      throw new DecodeError(`expected end of input, ${this.remaining} trailing bytes`);
    }
  }
}
