/**
 * Section compression for .civ (TDD §10): native
 * CompressionStream("deflate-raw"). Available across the entire device
 * floor (TDD §2) and Node 22 — the fflate fallback ADR-010 reserves is for
 * environments below that floor and slots in behind these two functions if
 * platform hardening (ROADMAP Phase 9) ever finds one.
 *
 * Typed structurally against globalThis: this package compiles DOM-free
 * (ES2023 lib only), and these are the only stream APIs it touches.
 */

interface ByteReadableStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  };
}

interface ByteWritableStream {
  getWriter(): {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
  };
}

interface TransformPair {
  readonly readable: ByteReadableStream;
  readonly writable: ByteWritableStream;
}

const g = globalThis as unknown as {
  CompressionStream?: new (format: "deflate-raw") => TransformPair;
  DecompressionStream?: new (format: "deflate-raw") => TransformPair;
};

async function pump(pair: TransformPair, input: Uint8Array): Promise<Uint8Array> {
  const writer = pair.writable.getWriter();
  // Fire the write before draining the readable — awaiting it first would
  // deadlock on inputs larger than the transform's internal buffers.
  const wrote = writer.write(input).then(() => writer.close());
  const reader = pair.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
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

export async function compressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (g.CompressionStream === undefined) {
    throw new Error("CompressionStream unavailable — below the TDD §2 device floor");
  }
  return pump(new g.CompressionStream("deflate-raw"), bytes);
}

export async function decompressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (g.DecompressionStream === undefined) {
    throw new Error("DecompressionStream unavailable — below the TDD §2 device floor");
  }
  return pump(new g.DecompressionStream("deflate-raw"), bytes);
}
