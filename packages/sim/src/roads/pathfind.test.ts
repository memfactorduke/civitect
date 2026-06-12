import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addEdge, addNode, createRoadGraph, RoadClass, type RoadGraph, removeEdge } from "./graph";
import { createPathfinder, dijkstraField, edgeCost, findPath } from "./pathfind";

const INF = 0xffffffff;

const classArb = fc.constantFrom(RoadClass.street, RoadClass.avenue, RoadClass.highway);

/** Random network on a small grid; returns graph + alive node ids. */
const networkArb = fc
  .array(
    fc.record({
      ax: fc.nat({ max: 12 }),
      ay: fc.nat({ max: 12 }),
      bx: fc.nat({ max: 12 }),
      by: fc.nat({ max: 12 }),
      roadClass: classArb,
    }),
    { minLength: 1, maxLength: 60 },
  )
  .map((segments) => {
    const g = createRoadGraph();
    const nodes = new Set<number>();
    for (const s of segments) {
      if (s.ax === s.bx && s.ay === s.by) {
        continue;
      }
      const a = addNode(g, s.ax, s.ay);
      const b = addNode(g, s.bx, s.by);
      nodes.add(a);
      nodes.add(b);
      try {
        addEdge(g, a, b, s.roadClass);
      } catch {
        // duplicates fine
      }
    }
    return { g, nodes: [...nodes].sort((p, q) => p - q) };
  })
  .filter((net) => net.nodes.length >= 2);

function pickTwo(nodes: readonly number[], i: number, j: number): [number, number] {
  return [nodes[i % nodes.length] as number, nodes[j % nodes.length] as number];
}

describe("ALT pathfinding (TDD §5)", () => {
  it("matches the Dijkstra oracle cost on random graphs (property — exit criterion 2)", () => {
    fc.assert(
      fc.property(networkArb, fc.nat({ max: 999 }), fc.nat({ max: 999 }), (net, i, j) => {
        const [from, to] = pickTwo(net.nodes, i, j);
        const pf = createPathfinder();
        const result = findPath(net.g, pf, from, to);
        const oracle = dijkstraField(net.g, from)[to] as number;
        if (oracle === INF) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(result?.cost).toBe(oracle);
        }
      }),
      { numRuns: 120 },
    );
  });

  it("returned node paths are connected and cost what they claim (property)", () => {
    fc.assert(
      fc.property(networkArb, fc.nat({ max: 999 }), fc.nat({ max: 999 }), (net, i, j) => {
        const [from, to] = pickTwo(net.nodes, i, j);
        const result = findPath(net.g, createPathfinder(), from, to);
        if (result === null) {
          return;
        }
        expect(result.nodes[0]).toBe(from);
        expect(result.nodes[result.nodes.length - 1]).toBe(to);
        let total = 0;
        for (let k = 0; k + 1 < result.nodes.length; k++) {
          const edge = findEdge(net.g, result.nodes[k] as number, result.nodes[k + 1] as number);
          expect(edge).toBeGreaterThanOrEqual(0);
          total += edgeCost(net.g, edge);
        }
        expect(total).toBe(result.cost);
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic: same graph + query ⇒ identical path", () => {
    const { g, a, d } = diamond();
    const p1 = findPath(g, createPathfinder(), a, d);
    const p2 = findPath(g, createPathfinder(), a, d);
    expect(p1).toEqual(p2);
  });

  it("prefers fast roads over short ones (travel time, not distance)", () => {
    const g = createRoadGraph();
    const a = addNode(g, 0, 0);
    const b = addNode(g, 10, 0);
    const mid = addNode(g, 5, 3);
    addEdge(g, a, b, RoadClass.street); // direct but slow: 10 tiles @ 500
    addEdge(g, a, mid, RoadClass.highway); // detour but fast @ 1500
    addEdge(g, mid, b, RoadClass.highway);
    const path = findPath(g, createPathfinder(), a, b);
    expect(path?.nodes).toEqual([a, mid, b]);
  });

  it("invalidates the landmark cache when the graph mutates", () => {
    const { g, a, b, d } = diamond();
    const pf = createPathfinder();
    const before = findPath(g, pf, a, d);
    expect(before).not.toBeNull();
    expect(pf.refreshes).toBe(1);

    // Re-query without mutation: cache holds.
    findPath(g, pf, a, d);
    expect(pf.refreshes).toBe(1);

    // Sever the chosen path's first edge: version moves, cache refreshes,
    // and the new path is still oracle-correct.
    const edge = findEdge(g, before?.nodes[0] as number, before?.nodes[1] as number);
    removeEdge(g, edge);
    const after = findPath(g, pf, a, d);
    expect(pf.refreshes).toBe(2);
    expect(after?.cost).toBe(dijkstraField(g, a)[d] as number);
    expect(after?.nodes[1]).not.toBe(before?.nodes[1]);
    expect(b).toBeGreaterThanOrEqual(0); // (b participates via the rerouted side)
  });

  it("returns null between disconnected components, not a guess", () => {
    const g = createRoadGraph();
    const a = addNode(g, 0, 0);
    const b = addNode(g, 1, 0);
    addEdge(g, a, b, RoadClass.street);
    const c = addNode(g, 10, 10);
    const d = addNode(g, 11, 10);
    addEdge(g, c, d, RoadClass.street);
    expect(findPath(g, createPathfinder(), a, d)).toBeNull();
  });
});

/** a—b—d and a—c—d diamond with unequal sides. */
function diamond(): { g: RoadGraph; a: number; b: number; c: number; d: number } {
  const g = createRoadGraph();
  const a = addNode(g, 0, 0);
  const b = addNode(g, 4, 0);
  const c = addNode(g, 0, 6);
  const d = addNode(g, 4, 6);
  addEdge(g, a, b, RoadClass.street);
  addEdge(g, b, d, RoadClass.street);
  addEdge(g, a, c, RoadClass.street);
  addEdge(g, c, d, RoadClass.street);
  return { g, a, b, c, d };
}

function findEdge(g: RoadGraph, a: number, b: number): number {
  for (let e = 0; e < g.edgeCount; e++) {
    if (
      g.edgeAlive[e] === 1 &&
      ((g.edgeA[e] === a && g.edgeB[e] === b) || (g.edgeA[e] === b && g.edgeB[e] === a))
    ) {
      return e;
    }
  }
  return -1;
}
