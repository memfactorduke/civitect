/**
 * Service coverage verification (board phase-4 task 2).
 *
 * The headline is the ROADMAP Phase 4 exit criterion 2: "each service's
 * coverage overlay matches network-distance ground truth (property test)".
 * The oracle below recomputes coverage per STATION with naive loops over
 * the per-station dijkstraField — structurally independent of the
 * implementation's grouped multi-anchor fold + cache fencing.
 */
import { BuildingKind, SERVICE_ID_LIST, type ServiceId } from "@civitect/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Buildings, createBuildings, spawnBuilding } from "../growth/buildings";
import { supercoverTiles } from "../roads/geometry";
import { addEdge, addNode, createRoadGraph, edgeBetween, RoadClass, type RoadGraph } from "../roads/graph";
import { dijkstraField, edgeCost } from "../roads/pathfind";
import {
  anchorNode,
  computeCoverageField,
  decay,
  SERVICE_REACH,
  type ServiceFieldInputs,
} from "./coverage";
import {
  budgetScalePermille,
  SERVICE_BUILDING_SPECS,
  STREET_TILE_COST,
  scaledRadius,
  specForTableKind,
} from "./registry";

const INF = 0xffffffff;

/** Independent per-station oracle: max over stations of decayed distance. */
function oracleField(service: ServiceId, inputs: ServiceFieldInputs): Uint8Array {
  const { roads: g, buildings, budgetsPermille, mapWidth, mapHeight } = inputs;
  const tiles = mapWidth * mapHeight;
  const out = new Uint8Array(tiles);
  const budget = budgetsPermille[SERVICE_ID_LIST.indexOf(service)] as number;
  for (let bi = 0; bi < buildings.count; bi++) {
    if (buildings.alive[bi] !== 1) {
      continue;
    }
    const spec = specForTableKind(buildings.kind[bi] as number);
    if (spec === null || spec.service !== service) {
      continue;
    }
    const anchor = anchorNode(g, buildings.tileIdx[bi] as number, mapWidth, mapHeight);
    if (anchor === -1) {
      continue;
    }
    const radius = scaledRadius(spec, budget);
    const nodeDist = dijkstraField(g, anchor);
    // Naive per-road-tile distance for THIS station only.
    const roadDist = new Uint32Array(tiles).fill(INF);
    for (let e = 0; e < g.edgeCount; e++) {
      if (g.edgeAlive[e] !== 1) {
        continue;
      }
      const a = g.edgeA[e] as number;
      const b = g.edgeB[e] as number;
      const da = nodeDist[a] as number;
      const db = nodeDist[b] as number;
      if (da === INF && db === INF) {
        continue;
      }
      const cost = edgeCost(g, e);
      const walk = supercoverTiles(
        g.nodeX[a] as number,
        g.nodeY[a] as number,
        g.nodeX[b] as number,
        g.nodeY[b] as number,
      );
      const steps = walk.length - 1;
      for (let i = 0; i < walk.length; i++) {
        const t = walk[i] as { x: number; y: number };
        const idx = t.y * mapWidth + t.x;
        const viaA = da === INF ? INF : da + (steps === 0 ? 0 : Math.floor((cost * i) / steps));
        const viaB =
          db === INF ? INF : db + (steps === 0 ? 0 : Math.floor((cost * (steps - i)) / steps));
        const d = Math.min(viaA, viaB);
        if (d < (roadDist[idx] as number)) {
          roadDist[idx] = d;
        }
      }
    }
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        let min = INF;
        for (let dy = -SERVICE_REACH; dy <= SERVICE_REACH; dy++) {
          for (let dx = -SERVICE_REACH; dx <= SERVICE_REACH; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) {
              continue;
            }
            const d = roadDist[ny * mapWidth + nx] as number;
            if (d < min) {
              min = d;
            }
          }
        }
        if (min === INF) {
          continue;
        }
        const c = decay(min, radius);
        const idx = y * mapWidth + x;
        if (c > (out[idx] as number)) {
          out[idx] = c;
        }
      }
    }
  }
  return out;
}

const MAP = 24;

/** Random axis-aligned street network + random service buildings. */
interface Scene {
  readonly g: RoadGraph;
  readonly buildings: Buildings;
}

const sceneArb: fc.Arbitrary<Scene> = fc
  .record({
    segments: fc.array(
      fc.record({
        x: fc.integer({ min: 1, max: MAP - 2 }),
        y: fc.integer({ min: 1, max: MAP - 2 }),
        len: fc.integer({ min: 2, max: 10 }),
        horizontal: fc.boolean(),
      }),
      { minLength: 1, maxLength: 6 },
    ),
    stations: fc.array(
      fc.record({
        kind: fc.constantFrom(...SERVICE_BUILDING_SPECS.keys()),
        x: fc.integer({ min: 0, max: MAP - 1 }),
        y: fc.integer({ min: 0, max: MAP - 1 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  })
  .map(({ segments, stations }) => {
    const g = createRoadGraph();
    for (const s of segments) {
      const bx = s.horizontal ? Math.min(MAP - 1, s.x + s.len) : s.x;
      const by = s.horizontal ? s.y : Math.min(MAP - 1, s.y + s.len);
      if (bx === s.x && by === s.y) {
        continue;
      }
      const a = addNode(g, s.x, s.y);
      const b = addNode(g, bx, by);
      // The raw graph REJECTS parallel edges (addEdge throws) — a rare
      // fast-check seed generated two identical segments and CI caught it.
      // Duplicates carry no coverage information; skip them.
      if (edgeBetween(g, a, b) !== -1) {
        continue;
      }
      addEdge(g, a, b, RoadClass.street);
    }
    const buildings = createBuildings();
    const used = new Set<number>();
    for (const st of stations) {
      const tileIdx = st.y * MAP + st.x;
      if (used.has(tileIdx)) {
        continue;
      }
      used.add(tileIdx);
      spawnBuilding(buildings, tileIdx, 100 + st.kind);
    }
    return { g, buildings };
  });

function inputsFor(scene: Scene, budgets?: Uint16Array): ServiceFieldInputs {
  return {
    roads: scene.g,
    buildings: scene.buildings,
    budgetsPermille: budgets ?? new Uint16Array(9).fill(1000),
    mapWidth: MAP,
    mapHeight: MAP,
  };
}

describe("coverage ≡ network-distance ground truth (ROADMAP Phase 4 exit criterion 2)", () => {
  it("the full field equals the per-station oracle, every tile, every service (property)", () => {
    fc.assert(
      fc.property(
        sceneArb,
        fc.constantFrom(...SERVICE_ID_LIST),
        fc.integer({ min: 500, max: 1500 }),
        (scene, service, budget) => {
          const budgets = new Uint16Array(9).fill(1000);
          budgets[SERVICE_ID_LIST.indexOf(service)] = budget;
          const inputs = inputsFor(scene, budgets);
          expect(computeCoverageField(service, inputs)).toEqual(oracleField(service, inputs));
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("coverage is network distance, never euclidean (GDD §7 [LOCKED], pillar 2)", () => {
  it("a euclid-near tile on a disconnected road gets nothing; the network-near tile is covered", () => {
    const g = createRoadGraph();
    // Two parallel streets, 10 tiles apart — far beyond SERVICE_REACH —
    // and NOT connected to each other.
    addEdge(g, addNode(g, 2, 2), addNode(g, 22, 2), RoadClass.street);
    addEdge(g, addNode(g, 2, 12), addNode(g, 22, 12), RoadClass.street);
    const buildings = createBuildings();
    // Fire station beside the y=2 street.
    spawnBuilding(buildings, 3 * MAP + 3, 100 + BuildingKind.fireStation);
    const field = computeCoverageField(1 as ServiceId, {
      roads: g,
      buildings,
      budgetsPermille: new Uint16Array(9).fill(1000),
      mapWidth: MAP,
      mapHeight: MAP,
    });
    const onNetwork = field[2 * MAP + 12] as number; // on the y=2 street, mid-span
    const offNetwork = field[12 * MAP + 12] as number; // on the y=12 street
    expect(onNetwork).toBeGreaterThan(0);
    expect(offNetwork).toBe(0); // euclid distance 10 — but no road CONNECTS it
  });

  it("an off-network station covers nothing at all (island fire house is decor)", () => {
    const g = createRoadGraph();
    addEdge(g, addNode(g, 2, 2), addNode(g, 10, 2), RoadClass.street);
    const buildings = createBuildings();
    // Station 8+ tiles from the only road — beyond ANCHOR_REACH.
    spawnBuilding(buildings, 20 * MAP + 20, 100 + BuildingKind.fireStation);
    const field = computeCoverageField(1 as ServiceId, {
      roads: g,
      buildings,
      budgetsPermille: new Uint16Array(9).fill(1000),
      mapWidth: MAP,
      mapHeight: MAP,
    });
    expect(field.every((v) => v === 0)).toBe(true);
  });

  it("coverage reaches the interior of one long edge (no interior nodes needed)", () => {
    const g = createRoadGraph();
    addEdge(g, addNode(g, 1, 2), addNode(g, 22, 2), RoadClass.street);
    const buildings = createBuildings();
    spawnBuilding(buildings, 3 * MAP + 1, 100 + BuildingKind.fireStationLarge);
    const field = computeCoverageField(1 as ServiceId, {
      roads: g,
      buildings,
      budgetsPermille: new Uint16Array(9).fill(1000),
      mapWidth: MAP,
      mapHeight: MAP,
    });
    const nearStation = field[2 * MAP + 2] as number;
    const midSpan = field[2 * MAP + 11] as number;
    const farEnd = field[2 * MAP + 21] as number;
    expect(nearStation).toBeGreaterThan(midSpan);
    expect(midSpan).toBeGreaterThan(farEnd);
    expect(farEnd).toBeGreaterThan(0); // 21 street-tiles < the 48-tile radius
  });
});

describe("budget sliders scale coverage (GDD §7: 50–150%, diminishing returns)", () => {
  it("budgetScalePermille: linear to 100%, half-rate above", () => {
    expect(budgetScalePermille(500)).toBe(500);
    expect(budgetScalePermille(1000)).toBe(1000);
    expect(budgetScalePermille(1250)).toBe(1125);
    expect(budgetScalePermille(1500)).toBe(1250);
  });

  it("a starved budget shrinks reach; a lavish one extends it sublinearly", () => {
    const g = createRoadGraph();
    addEdge(g, addNode(g, 1, 2), addNode(g, 22, 2), RoadClass.street);
    const buildings = createBuildings();
    spawnBuilding(buildings, 3 * MAP + 1, 100 + BuildingKind.clinic); // radius 28 tiles
    const at = (budget: number): number => {
      const budgets = new Uint16Array(9).fill(1000);
      budgets[2] = budget; // health is ServiceId 3 → index 2
      const field = computeCoverageField(3 as ServiceId, {
        roads: g,
        buildings,
        budgetsPermille: budgets,
        mapWidth: MAP,
        mapHeight: MAP,
      });
      // The reach window takes the NEAREST road tile within 4 — from
      // x=22 that's (18,2), 17 street-tiles from the anchor at (1,2).
      return field[2 * MAP + 22] as number;
    };
    const starved = at(500); // radius 14 tiles → 17 tiles out is dark
    const normal = at(1000);
    const lavish = at(1500); // radius 35 tiles
    expect(starved).toBe(0);
    expect(normal).toBeGreaterThan(0);
    expect(lavish).toBeGreaterThan(normal);
    // Diminishing returns: +50% budget must buy LESS than +50% coverage.
    expect(lavish - normal).toBeLessThan(Math.floor(normal / 2) + 1);
  });

  it("registry radii read as street-tiles of travel (cost-unit sanity)", () => {
    const spec = SERVICE_BUILDING_SPECS.get(BuildingKind.fireStation);
    expect(spec).toBeDefined();
    expect((spec as { radiusCost: number }).radiusCost).toBe(30 * STREET_TILE_COST);
  });
});
