import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, type RawImage } from "./png";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const TEST_CRC_TABLE = (() => {
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

function testCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (TEST_CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] as number) << 24) |
      ((bytes[at + 1] as number) << 16) |
      ((bytes[at + 2] as number) << 8) |
      (bytes[at + 3] as number)) >>>
    0
  );
}

function rewriteFirstChunkCrc(bytes: Uint8Array, chunkType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = u32be(bytes, at);
    const type = String.fromCharCode(
      bytes[at + 4] as number,
      bytes[at + 5] as number,
      bytes[at + 6] as number,
      bytes[at + 7] as number,
    );
    const chunkEnd = at + 8 + length;
    if (type === chunkType) {
      view.setUint32(chunkEnd, testCrc32(bytes.subarray(at + 4, chunkEnd)));
      return;
    }
    at = chunkEnd + 4;
  }
  throw new Error(`missing PNG chunk ${chunkType}`);
}

/** The exact 8×8 RGBA gradient the Python fixture generator wrote. */
function referenceGradient(): Uint8Array {
  const px = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4;
      px[i] = (x * 33) % 256;
      px[i + 1] = (y * 57) % 256;
      px[i + 2] = (x * 7 + y * 13) % 256;
      px[i + 3] = (x + y) % 3 ? 255 : 128;
    }
  }
  return px;
}

describe("png codec (gate-internal, zero-dependency)", () => {
  it.each([
    0, 1, 2, 3, 4,
  ])("decodes externally-encoded PNGs using filter type %d (cross-validated vs Python zlib)", async (filter) => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, `filter-${filter}.png`)));
    const image = await decodePng(bytes, `filter-${filter}.png`);
    expect(image.width).toBe(8);
    expect(image.height).toBe(8);
    expect(image.pixels).toEqual(referenceGradient());
  });

  it("encode∘decode is identity on random RGBA images (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 24 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        async (width, height, stream) => {
          const pixels = new Uint8Array(width * height * 4);
          let i = 0;
          for (const v of stream) {
            if (i >= pixels.length) break;
            pixels[i++] = v;
          }
          const image: RawImage = { width, height, pixels };
          const decoded = await decodePng(await encodePng(image), "roundtrip");
          expect(decoded).toEqual(image);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("rejects non-PNG bytes", async () => {
    await expect(decodePng(new TextEncoder().encode("JFIF whatever"), "x")).rejects.toThrow(
      /not a PNG/,
    );
  });

  it("rejects PNG chunks with bad CRCs before decoding pixels", async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "filter-0.png")));
    const tampered = Uint8Array.from(bytes);
    tampered[24] = 16; // IHDR bitDepth byte, CRC intentionally left stale.
    await expect(decodePng(tampered, "bad-crc.png")).rejects.toThrow(/CRC mismatch/);
  });

  it("rejects unsupported variants with re-export guidance", async () => {
    // 16-bit depth header: signature + IHDR with bitDepth 16.
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "filter-0.png")));
    const tampered = Uint8Array.from(bytes);
    tampered[24] = 16; // IHDR bitDepth byte
    rewriteFirstChunkCrc(tampered, "IHDR");
    await expect(decodePng(tampered, "deep.png")).rejects.toThrow(/re-export/);
  });
});
