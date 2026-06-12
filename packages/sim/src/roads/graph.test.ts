import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addEdge,
  addNode,
  canonicalGraph,
  createRoadGraph,
  edgesOf,
  nodeAt,
  otherEnd,
  RoadClass,
  removeEdge,
  removeNode,
} from "./graph";

const classArb = fc.constantFrom(RoadClass.street, RoadClass.avenue, RoadClass.highway);

/** A small random network builder: returns the graph + the live edge ids. */
const networkArb = fc
  .array(
    fc.record({
      ax: fc.nat({ max: 24 }),
      ay: fc.nat({ max: 24 }),
      bx: fc.nat({ max: 24 }),
      by: fc.nat({ max: 24 }),
      roadClass: classArb,
    }),
    { maxLength: 40 },
  )
  .map((segments) => {
    const g = createRoadGraph();
    const edges: number[] = [];
    for (const s of segments) {
      if (s.ax === s.bx && s.ay === s.by) {
        continue;
      }
      const a = addNode(g, s.ax, s.ay);
      const b = addNode(g, s.bx, s.by);
      try {
        edges.push(addEdge(g, a, b, s.roadClass));
      } catch {
        // duplicate pair — fine, generators repeat themselves
      }
    }
    return { g, edges };
  });

describe("road graph mutations (TDD §5)", () => {
  it("addEdge∘removeEdge ≡ identity on the canonical form (property)", () => {
    fc.assert(
      fc.property(networkArb, classArb, (net, roadClass) => {
        const before = canonicalGraph(net.g);
        const a = addNode(net.g, 30, 30);
        const b = addNode(net.g, 31, 30);
        const e = addEdge(net.g, a, b, roadClass);
        removeEdge(net.g, e);
        removeNode(net.g, a);
        removeNode(net.g, b);
        expect(canonicalGraph(net.g)).toEqual(before);
      }),
    );
  });

  it("adjacency lists agree with a naive scan (property)", () => {
    fc.assert(
      fc.property(networkArb, (net) => {
        const g = net.g;
        for (let n = 0; n < g.nodeCount; n++) {
          if (g.nodeAlive[n] !== 1) {
            continue;
          }
          const fromList = [...edgesOf(g, n)].sort((p, q) => p - q);
          const naive: number[] = [];
          for (let e = 0; e < g.edgeCount; e++) {
            if (g.edgeAlive[e] === 1 && (g.edgeA[e] === n || g.edgeB[e] === n)) {
              naive.push(e);
            }
          }
          expect(fromList).toEqual(naive);
        }
      }),
    );
  });

  it("every mutation bumps the graph version (cache fence)", () => {
    const g = createRoadGraph();
    let last = g.version;
    const a = addNode(g, 0, 0);
    expect(g.version).toBeGreaterThan(last);
    last = g.version;
    const b = addNode(g, 1, 0);
    expect(g.version).toBeGreaterThan(last);
    last = g.version;
    const e = addEdge(g, a, b, RoadClass.street);
    expect(g.version).toBeGreaterThan(last);
    last = g.version;
    removeEdge(g, e);
    expect(g.version).toBeGreaterThan(last);
  });

  it("slot reuse changes the edge slot version (stale handles can't alias)", () => {
    const g = createRoadGraph();
    const a = addNode(g, 0, 0);
    const b = addNode(g, 1, 0);
    const c = addNode(g, 2, 0);
    const e1 = addEdge(g, a, b, RoadClass.street);
    const v1 = g.edgeSlotVersion[e1] as number;
    removeEdge(g, e1);
    const e2 = addEdge(g, b, c, RoadClass.avenue);
    expect(e2).toBe(e1); // free-list reused the slot...
    expect(g.edgeSlotVersion[e2] as number).toBeGreaterThan(v1); // ...but not the identity
  });

  it("node identity is stable through the tile index", () => {
    const g = createRoadGraph();
    const a = addNode(g, 5, 7);
    expect(addNode(g, 5, 7)).toBe(a); // dedup, not duplicate
    expect(nodeAt(g, 5, 7)).toBe(a);
    removeNode(g, a);
    expect(nodeAt(g, 5, 7)).toBe(-1);
  });

  it("rejects self-loops, duplicate edges, dead endpoints, connected-node removal", () => {
    const g = createRoadGraph();
    const a = addNode(g, 0, 0);
    const b = addNode(g, 3, 4);
    expect(() => addEdge(g, a, a, RoadClass.street)).toThrow(/self-loops/);
    const e = addEdge(g, a, b, RoadClass.street);
    expect(() => addEdge(g, b, a, RoadClass.avenue)).toThrow(/already connected/);
    expect(() => removeNode(g, a)).toThrow(/still has edges/);
    removeEdge(g, e);
    removeNode(g, a);
    expect(() => addEdge(g, a, b, RoadClass.street)).toThrow(/alive/);
  });

  it("computes integer milli-tile lengths (3-4-5 triangle)", () => {
    const g = createRoadGraph();
    const a = addNode(g, 0, 0);
    const b = addNode(g, 3, 4);
    const e = addEdge(g, a, b, RoadClass.street);
    expect(g.edgeLengthMilliTiles[e]).toBe(5000);
    expect(otherEnd(g, e, a)).toBe(b);
  });

  it("survives growth past initial capacity with intact adjacency", () => {
    const g = createRoadGraph();
    const nodes: number[] = [];
    for (let i = 0; i < 40; i++) {
      nodes.push(addNode(g, i, 0));
      if (i > 0) {
        addEdge(g, nodes[i - 1] as number, nodes[i] as number, RoadClass.street);
      }
    }
    expect(edgesOf(g, nodes[20] as number)).toHaveLength(2);
    expect(canonicalGraph(g).edges).toHaveLength(39);
  });
});
