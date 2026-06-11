/**
 * Hand-rolled UTF-8. Two reasons we don't use TextEncoder/TextDecoder:
 * this package compiles against the bare ES2023 lib (no DOM types — it runs
 * in worker, main thread, and Node alike), and owning the codec keeps byte
 * output engine-independent by construction.
 *
 * Semantics match TextEncoder: lone surrogates encode as U+FFFD. Decoding is
 * strict — overlong forms, surrogate code points, and values past U+10FFFF
 * are DecodeErrors, not replacement characters.
 */
import { DecodeError } from "../errors";

export function utf8Encode(value: string): Uint8Array {
  // Worst case is 3 bytes per UTF-16 code unit (astral pairs are 4 bytes per 2 units).
  const out = new Uint8Array(value.length * 3);
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    let cp = value.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      out[n++] = cp;
    } else if (cp < 0x800) {
      out[n++] = 0xc0 | (cp >> 6);
      out[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    } else {
      out[n++] = 0xf0 | (cp >> 18);
      out[n++] = 0x80 | ((cp >> 12) & 0x3f);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return out.slice(0, n);
}

function byteAt(bytes: Uint8Array, i: number): number {
  const b = bytes[i];
  if (b === undefined) {
    throw new DecodeError("utf-8: unexpected end of input");
  }
  return b;
}

function continuation(bytes: Uint8Array, i: number): number {
  const b = byteAt(bytes, i);
  if ((b & 0xc0) !== 0x80) {
    throw new DecodeError(`utf-8: expected continuation byte at ${i}, got 0x${b.toString(16)}`);
  }
  return b & 0x3f;
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = byteAt(bytes, i);
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = ((b0 & 0x1f) << 6) | continuation(bytes, i + 1);
      if (cp < 0x80) {
        throw new DecodeError("utf-8: overlong 2-byte sequence");
      }
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = ((b0 & 0x0f) << 12) | (continuation(bytes, i + 1) << 6) | continuation(bytes, i + 2);
      if (cp < 0x800) {
        throw new DecodeError("utf-8: overlong 3-byte sequence");
      }
      if (cp >= 0xd800 && cp <= 0xdfff) {
        throw new DecodeError("utf-8: surrogate code point");
      }
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp =
        ((b0 & 0x07) << 18) |
        (continuation(bytes, i + 1) << 12) |
        (continuation(bytes, i + 2) << 6) |
        continuation(bytes, i + 3);
      if (cp < 0x10000) {
        throw new DecodeError("utf-8: overlong 4-byte sequence");
      }
      if (cp > 0x10ffff) {
        throw new DecodeError("utf-8: code point past U+10FFFF");
      }
      i += 4;
    } else {
      throw new DecodeError(`utf-8: invalid lead byte 0x${b0.toString(16)}`);
    }
    s += String.fromCodePoint(cp);
  }
  return s;
}
