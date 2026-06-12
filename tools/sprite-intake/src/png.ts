/**
 * Minimal PNG codec for the intake gate (ADR-012): decode RGBA8/RGB8
 * non-interlaced PNGs to raw pixels, encode RGBA8 (test fixtures + future
 * contact sheets). Built on the platform's zlib (CompressionStream) — zero
 * dependencies, so the asset GATE stays inside the pinned toolchain.
 *
 * Deliberately narrow: bit depth 8, color types 2 (RGB) / 6 (RGBA),
 * no interlacing. Anything else fails with an actionable message — the
 * intake contract is "export RGBA8, non-interlaced" (every generator and
 * editor in the pipeline can). If coverage ever needs to widen, this
 * module is the single swap point for a real image library (that's a
 * dependency decision for Mem, parked in the board notes).
 */

export interface RawImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, 4 bytes/px. */
  readonly pixels: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ── zlib via platform streams ───────────────────────────────────────────────

interface StreamPair {
  readonly readable: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> };
  };
  readonly writable: {
    getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> };
  };
}

const g = globalThis as unknown as {
  CompressionStream: new (format: "deflate") => StreamPair;
  DecompressionStream: new (format: "deflate") => StreamPair;
};

async function pump(pair: StreamPair, input: Uint8Array): Promise<Uint8Array> {
  const writer = pair.writable.getWriter();
  const wrote = writer.write(input).then(() => writer.close());
  const reader = pair.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      total += value.length;
    }
  }
  await wrote;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// ── CRC32 (PNG chunk checksums) ─────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── decode ──────────────────────────────────────────────────────────────────

function u32be(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] as number) << 24) |
      ((bytes[at + 1] as number) << 16) |
      ((bytes[at + 2] as number) << 8) |
      (bytes[at + 3] as number)) >>>
    0
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export async function decodePng(bytes: Uint8Array, source: string): Promise<RawImage> {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error(`${source}: not a PNG file`);
    }
  }
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  let sawEnd = false;
  while (at + 8 <= bytes.length && !sawEnd) {
    const length = u32be(bytes, at);
    const type = String.fromCharCode(
      bytes[at + 4] as number,
      bytes[at + 5] as number,
      bytes[at + 6] as number,
      bytes[at + 7] as number,
    );
    const data = bytes.subarray(at + 8, at + 8 + length);
    switch (type) {
      case "IHDR": {
        width = u32be(data, 0);
        height = u32be(data, 4);
        const bitDepth = data[8] as number;
        colorType = data[9] as number;
        const interlace = data[12] as number;
        if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
          throw new Error(
            `${source}: unsupported PNG variant (bitDepth=${bitDepth}, colorType=${colorType}, ` +
              `interlace=${interlace}) — intake requires 8-bit RGB/RGBA, non-interlaced ` +
              "(re-export from the generator/editor with standard settings)",
          );
        }
        break;
      }
      case "IDAT":
        idat.push(data);
        break;
      case "IEND":
        sawEnd = true;
        break;
      default:
        break; // ancillary chunks are fine to ignore for gate purposes
    }
    at += 8 + length + 4; // length + type + data + crc
  }
  if (width === 0 || height === 0 || idat.length === 0) {
    throw new Error(`${source}: truncated or empty PNG`);
  }

  let compressed: Uint8Array;
  if (idat.length === 1) {
    compressed = idat[0] as Uint8Array;
  } else {
    const total = idat.reduce((n, c) => n + c.length, 0);
    compressed = new Uint8Array(total);
    let offset = 0;
    for (const chunk of idat) {
      compressed.set(chunk, offset);
      offset += chunk.length;
    }
  }
  const raw = await pump(new g.DecompressionStream("deflate"), compressed);

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`${source}: PNG payload size mismatch (corrupt?)`);
  }
  const pixels = new Uint8Array(width * height * 4);
  const prior = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart] as number;
    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + 1 + x] as number;
      const left = x >= bpp ? (line[x - bpp] as number) : 0;
      const up = prior[x] as number;
      const upLeft = x >= bpp ? (prior[x - bpp] as number) : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4:
          out = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`${source}: unknown PNG filter ${filter}`);
      }
      line[x] = out & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      const src = x * bpp;
      pixels[dst] = line[src] as number;
      pixels[dst + 1] = line[src + 1] as number;
      pixels[dst + 2] = line[src + 2] as number;
      pixels[dst + 3] = bpp === 4 ? (line[src + 3] as number) : 255;
    }
    prior.set(line);
  }
  return { width, height, pixels };
}

// ── encode (RGBA8, filter 0 — fixtures + contact sheets) ────────────────────

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePng(image: RawImage): Promise<Uint8Array> {
  const { width, height, pixels } = image;
  if (pixels.length !== width * height * 4) {
    throw new Error(
      `encodePng: pixel buffer is ${pixels.length} bytes, want ${width * height * 4}`,
    );
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // compression 0, filter 0, interlace 0

  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter: none
    filtered.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = await pump(new g.CompressionStream("deflate"), filtered);

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
