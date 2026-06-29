/**
 * Deterministic integer value noise for map generation (TDD §13).
 * All-integer pipeline: a 32-bit avalanche hash over (seed, x, y) gives
 * lattice values; bilinear blending in fixed-point Q8 gives smooth fields;
 * octaves sum with halving amplitude. Same seed ⇒ same map, every platform
 * (maps are reproducible artifacts — GDD §3 catalog).
 */

/** 32-bit avalanche hash (xxhash-style finalizer) over lattice coords. */
export function latticeHash(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Lattice value in [0, 255]. */
function latticeValue(seed: number, x: number, y: number): number {
  return latticeHash(seed, x, y) & 0xff;
}

function assertPositiveInt(name: string, value: number, min = 1): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`);
  }
}

/**
 * Smooth value noise at integer tile coords for a given cell size, Q8
 * fixed-point bilinear blend. Returns [0, 255].
 */
export function valueNoise(seed: number, x: number, y: number, cellSize: number): number {
  assertPositiveInt("cellSize", cellSize);

  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  const fx = Math.floor(((x - cx * cellSize) * 256) / cellSize); // Q8
  const fy = Math.floor(((y - cy * cellSize) * 256) / cellSize);
  const v00 = latticeValue(seed, cx, cy);
  const v10 = latticeValue(seed, cx + 1, cy);
  const v01 = latticeValue(seed, cx, cy + 1);
  const v11 = latticeValue(seed, cx + 1, cy + 1);
  const top = v00 * (256 - fx) + v10 * fx; // Q8
  const bottom = v01 * (256 - fx) + v11 * fx;
  return (top * (256 - fy) + bottom * fy) >> 16;
}

/** Octave sum (halving amplitude/cell size), normalized to [0, 255]. */
export function fractalNoise(
  seed: number,
  x: number,
  y: number,
  baseCellSize: number,
  octaves: number,
): number {
  assertPositiveInt("baseCellSize", baseCellSize, 2);
  assertPositiveInt("octaves", octaves);

  let sum = 0;
  let amplitude = 256;
  let total = 0;
  let cell = baseCellSize;
  for (let o = 0; o < octaves && cell >= 2; o++) {
    sum += valueNoise((seed + o * 0x1000_19) >>> 0, x, y, cell) * amplitude;
    total += amplitude;
    amplitude >>= 1;
    cell >>= 1;
  }
  return Math.floor(sum / total);
}
