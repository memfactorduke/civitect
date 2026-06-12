/**
 * Exact integer segment geometry for road semantics (phase-1 12d/12e).
 * Everything is integer cross-products and exact divisibility — no floats
 * cross a decision boundary (ADR-005).
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export type SegmentRelation =
  | { readonly kind: "none" }
  /** Touch or cross at an exact integer lattice point. */
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  /** They cross, but not on the integer lattice — unbuildable junction. */
  | { readonly kind: "nonInteger" }
  /** Collinear with more than a point in common — forbidden overlap. */
  | { readonly kind: "collinearOverlap" };

function orient(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px);
}

function inBox(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  return (
    Math.min(ax, bx) <= px &&
    px <= Math.max(ax, bx) &&
    Math.min(ay, by) <= py &&
    py <= Math.max(ay, by)
  );
}

/** Is integer point p on segment [a, b] (inclusive)? */
export function pointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  return orient(ax, ay, bx, by, px, py) === 0 && inBox(px, py, ax, ay, bx, by);
}

/** Relation between closed segments A=[a1,a2] and B=[b1,b2]. */
export function segmentRelation(
  a1x: number,
  a1y: number,
  a2x: number,
  a2y: number,
  b1x: number,
  b1y: number,
  b2x: number,
  b2y: number,
): SegmentRelation {
  const d1 = orient(b1x, b1y, b2x, b2y, a1x, a1y);
  const d2 = orient(b1x, b1y, b2x, b2y, a2x, a2y);
  const d3 = orient(a1x, a1y, a2x, a2y, b1x, b1y);
  const d4 = orient(a1x, a1y, a2x, a2y, b2x, b2y);

  if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
    // Collinear. Count shared lattice extent via projection overlap.
    const horizontal = a1x !== a2x || b1x !== b2x;
    const [alo, ahi] = horizontal
      ? [Math.min(a1x, a2x), Math.max(a1x, a2x)]
      : [Math.min(a1y, a2y), Math.max(a1y, a2y)];
    const [blo, bhi] = horizontal
      ? [Math.min(b1x, b2x), Math.max(b1x, b2x)]
      : [Math.min(b1y, b2y), Math.max(b1y, b2y)];
    const lo = Math.max(alo, blo);
    const hi = Math.min(ahi, bhi);
    if (lo > hi) {
      return { kind: "none" };
    }
    if (lo === hi) {
      // Single shared point — endpoints kissing, which is a legal junction.
      const p = horizontal
        ? { x: lo, y: a1y + (a2y - a1y) * (a1x === a2x ? 0 : (lo - a1x) / (a2x - a1x)) }
        : { x: a1x, y: lo };
      // For axis/diagonal integer segments the kiss point is an endpoint of
      // one of them; recover it directly to stay integer-exact.
      for (const [px, py] of [
        [a1x, a1y],
        [a2x, a2y],
        [b1x, b1y],
        [b2x, b2y],
      ] as const) {
        if (
          pointOnSegment(px, py, a1x, a1y, a2x, a2y) &&
          pointOnSegment(px, py, b1x, b1y, b2x, b2y)
        ) {
          return { kind: "point", x: px, y: py };
        }
      }
      return { kind: "point", x: p.x, y: p.y };
    }
    return { kind: "collinearOverlap" };
  }

  const aStraddles = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || d1 === 0 || d2 === 0;
  const bStraddles = (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0) || d3 === 0 || d4 === 0;
  if (!aStraddles || !bStraddles) {
    return { kind: "none" };
  }
  // Touching cases (some orientation is zero): the contact point is an
  // endpoint lying on the other segment — integer by construction.
  if (d1 === 0 && inBox(a1x, a1y, b1x, b1y, b2x, b2y)) {
    return { kind: "point", x: a1x, y: a1y };
  }
  if (d2 === 0 && inBox(a2x, a2y, b1x, b1y, b2x, b2y)) {
    return { kind: "point", x: a2x, y: a2y };
  }
  if (d3 === 0 && inBox(b1x, b1y, a1x, a1y, a2x, a2y)) {
    return { kind: "point", x: b1x, y: b1y };
  }
  if (d4 === 0 && inBox(b2x, b2y, a1x, a1y, a2x, a2y)) {
    return { kind: "point", x: b2x, y: b2y };
  }
  if (d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0) {
    return { kind: "none" }; // zero orientation but outside the other's box
  }
  // Proper crossing: exact rational intersection; integer iff divisible.
  const dD = (a1x - a2x) * (b1y - b2y) - (a1y - a2y) * (b1x - b2x);
  const xN = (a1x * a2y - a1y * a2x) * (b1x - b2x) - (a1x - a2x) * (b1x * b2y - b1y * b2x);
  const yN = (a1x * a2y - a1y * a2x) * (b1y - b2y) - (a1y - a2y) * (b1x * b2y - b1y * b2x);
  if (xN % dD !== 0 || yN % dD !== 0) {
    return { kind: "nonInteger" };
  }
  return { kind: "point", x: xN / dD, y: yN / dD };
}

/**
 * Supercover walk: every tile the segment touches between integer
 * endpoints, inclusive. Exact-corner diagonal steps pass through the
 * corner without flooding side tiles [TUNE].
 */
export function supercoverTiles(ax: number, ay: number, bx: number, by: number): Pt[] {
  const tiles: Pt[] = [{ x: ax, y: ay }];
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const sx = bx > ax ? 1 : -1;
  const sy = by > ay ? 1 : -1;
  let x = ax;
  let y = ay;
  let ix = 0;
  let iy = 0;
  while (ix < dx || iy < dy) {
    const decision = (1 + 2 * ix) * dy - (1 + 2 * iy) * dx;
    if (decision === 0) {
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    tiles.push({ x, y });
  }
  return tiles;
}
