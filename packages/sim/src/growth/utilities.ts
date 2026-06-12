/**
 * Power & water v1 (GDD §7, TDD §5): lines/pipes run under roads [LOCKED],
 * so the distribution network IS the road network. A consumer is served
 * when some plant/pump shares its road-connected component and that
 * component's supply covers demand; over capacity, consumers brown out in
 * deterministic tile order (priority queues arrive with Phase 4 services).
 *
 * Everything here is DERIVED state recomputed when the road graph or
 * building set changes — never hashed, never saved (ADR-005-safe because
 * the recompute is deterministic and tick-scheduled).
 */
import { ZoneKind } from "@civitect/protocol";
import { supercoverTiles } from "../roads/geometry";
import { edgesOf, type RoadGraph } from "../roads/graph";
import { type Buildings, capacityFor, PLOPPABLE_KIND_OFFSET } from "./buildings";

export const PLANT_SUPPLY = 12000; // units per plant/pump [TUNE]

/** Per-building utility demand by kind/level [TUNE]. */
export function utilityDemand(kind: number, level: number): number {
  if (kind >= PLOPPABLE_KIND_OFFSET) {
    return 0;
  }
  const heavy = kind === ZoneKind.industrial || kind === ZoneKind.commercialHigh;
  return (heavy ? 4 : 2) * level;
}

export interface UtilityState {
  /** tile index → road component id (-1 off-network). */
  readonly componentOf: Int32Array;
  /** Served flags per building index. */
  readonly powered: Uint8Array;
  readonly watered: Uint8Array;
}

/** Union-find over road tiles, then supply/demand per component. */
export function computeUtilities(
  g: RoadGraph,
  buildings: Buildings,
  mapWidth: number,
  mapHeight: number,
  serviceRadius = 4, // consumers reach the grid within zoning depth [TUNE]
): UtilityState {
  const tiles = mapWidth * mapHeight;
  const componentOf = new Int32Array(tiles).fill(-1);

  // Road tiles via each edge's supercover; union by flood order.
  const parent = new Int32Array(tiles).fill(-1);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root] as number;
    }
    let cur = i;
    while (parent[cur] !== cur) {
      const next = parent[cur] as number;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[Math.max(ra, rb)] = Math.min(ra, rb); // deterministic root
    }
  };

  const roadTiles: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const ax = g.nodeX[g.edgeA[e] as number] as number;
    const ay = g.nodeY[g.edgeA[e] as number] as number;
    const bx = g.nodeX[g.edgeB[e] as number] as number;
    const by = g.nodeY[g.edgeB[e] as number] as number;
    let prev = -1;
    for (const t of supercoverTiles(ax, ay, bx, by)) {
      const idx = t.y * mapWidth + t.x;
      if (parent[idx] === -1) {
        parent[idx] = idx;
        roadTiles.push(idx);
      }
      if (prev !== -1) {
        union(prev, idx);
      }
      prev = idx;
    }
  }
  // Shared nodes connect edges; touching tiles from different edges union
  // through the shared lattice tile automatically (same idx).
  for (const idx of roadTiles) {
    componentOf[idx] = find(idx);
  }

  // Nearest component within serviceRadius (Chebyshev) per building tile.
  const componentNear = (tileIdx: number): number => {
    const x = tileIdx % mapWidth;
    const y = Math.floor(tileIdx / mapWidth);
    for (let dy = -serviceRadius; dy <= serviceRadius; dy++) {
      for (let dx = -serviceRadius; dx <= serviceRadius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) {
          continue;
        }
        const c = componentOf[ny * mapWidth + nx] as number;
        if (c !== -1) {
          return c;
        }
      }
    }
    return -1;
  };

  // Supply per component from plants/pumps; demand lists in tile order.
  const powerSupply = new Map<number, number>();
  const waterSupply = new Map<number, number>();
  interface Consumer {
    readonly building: number;
    readonly tile: number;
    readonly component: number;
    readonly demand: number;
  }
  const consumers: Consumer[] = [];
  for (let i = 0; i < buildings.count; i++) {
    if (buildings.alive[i] !== 1) {
      continue;
    }
    const component = componentNear(buildings.tileIdx[i] as number);
    const kind = buildings.kind[i] as number;
    if (component === -1) {
      continue; // off-grid: handled as unserved below
    }
    if (kind === PLOPPABLE_KIND_OFFSET + 1) {
      powerSupply.set(component, (powerSupply.get(component) ?? 0) + PLANT_SUPPLY);
    } else if (kind === PLOPPABLE_KIND_OFFSET + 2) {
      waterSupply.set(component, (waterSupply.get(component) ?? 0) + PLANT_SUPPLY);
    } else {
      consumers.push({
        building: i,
        tile: buildings.tileIdx[i] as number,
        component,
        demand: utilityDemand(kind, buildings.level[i] as number),
      });
    }
  }
  consumers.sort((a, b) => a.tile - b.tile); // deterministic brownout order

  const powered = new Uint8Array(buildings.count);
  const watered = new Uint8Array(buildings.count);
  const powerLeft = new Map(powerSupply);
  const waterLeft = new Map(waterSupply);
  for (const c of consumers) {
    const p = powerLeft.get(c.component) ?? 0;
    if (p >= c.demand) {
      powerLeft.set(c.component, p - c.demand);
      powered[c.building] = 1;
    }
    const w = waterLeft.get(c.component) ?? 0;
    if (w >= c.demand) {
      waterLeft.set(c.component, w - c.demand);
      watered[c.building] = 1;
    }
  }
  return { componentOf, powered, watered };
}
