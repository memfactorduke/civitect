/**
 * Fire + dispatch (GDD §7/§14 core, board phase-4 task 5) — the Phase 4
 * exit-criterion-1 system: "fire on a congested street spreads
 * realistically because the truck is late (and the cause chain says so)".
 *
 * Model, hourly (the services slot, rng.events):
 * - IGNITION: each building visited by this hour's slice rolls a tiny
 *   daily chance (industry ×3). Draws are strictly per-eligible-building.
 * - BURNING: every burning building advances fireTicks hourly; at
 *   SPREAD_AFTER_HOURS it starts rolling spread against Chebyshev-1
 *   neighbors; at BURN_RUIN_HOURS it collapses to RUIN — residents flee
 *   (emigration outflow), the lot stays blocked until the ruin clears.
 * - RESPONSE is STATELESS per hour: a station with a free truck whose
 *   CONGESTED network travel time to the fire fits inside its
 *   budget-scaled coverage radius extinguishes it. Free-flow coverage
 *   says "protected"; the congested cost field decides "in time" — jams
 *   literally push a fire out of reach (GDD §9 congestion consequences
 *   [LOCKED]). Routing runs on the canonical twin (value-stable costs;
 *   the tranche-2 rule).
 * - The LATE advisor carries the chain: burning building → worst v/c
 *   edge on the truck's best path → the station it came from. Every link
 *   resolves (ADR-009).
 */
import { EntityKind, ServiceId, ZoneKind } from "@civitect/protocol";
import {
  aliveByTile,
  BuildingStatus,
  type Buildings,
  COHORT_BLOCK,
  demolishBuilding,
  PLOPPABLE_KIND_OFFSET,
  residentsOf,
} from "../growth/buildings";
import type { Pcg32 } from "../rng";
import { edgeBetween, nodeAt, otherEnd, type RoadGraph } from "../roads/graph";
import { dijkstraTree } from "../roads/pathfind";
import type { TrafficCore } from "../traffic/solver";
import {
  type AnchorSource,
  anchorSources,
  interpolateEdgeDistances,
  windowMin,
  windowVia,
} from "./coverage";
import { SERVICE_BUILDING_SPECS, scaledCapacity, scaledRadius, specForTableKind } from "./registry";

export interface FireCauseLink {
  kind: number;
  id: number;
  labelKey: string;
  weightPermille: number;
}

// ── rates, all [TUNE] ──────────────────────────────────────────────────────
/** Ignition chance per building per day, per 100k. */
export const IGNITION_PER_100K_DAY = 15;
export const INDUSTRY_IGNITION_MULT = 3;
/** Hours of unanswered burning before a fire jumps to ONE neighbor. */
export const SPREAD_AFTER_HOURS = 3;
/** Hours of burning before the building collapses to ruin. */
export const BURN_RUIN_HOURS = 12;
/** Game-days a ruin blocks its lot before clearing. */
export const RUIN_CLEAR_DAYS = 5;
/**
 * Secondary-fire marker in fireTicks' high bit: spread children do not
 * spread again. v1 is ONE-HOP — the first balance run with multi-hop
 * spread razed an unprotected 37k city to 2.9k in a year (exponential
 * chains through dense blocks). The full fire-spread core is ROADMAP
 * Phase 8 scope (disasters); Phase 4 needs response mechanics + enough
 * spread for exit criterion 1, which one deterministic hop provides.
 */
export const SECONDARY_FIRE_BIT = 0x80;

/** Burn progress in hours, marker bit masked off. */
export function burnHours(fireTicks: number): number {
  return fireTicks & 0x7f;
}

export interface FireFlows {
  ignitions: number;
  spreads: number;
  extinguished: number;
  ruins: number;
}

export function emptyFireFlows(): FireFlows {
  return { ignitions: 0, spreads: 0, extinguished: 0, ruins: 0 };
}

export interface FireContext {
  readonly buildings: Buildings;
  readonly roads: RoadGraph;
  readonly traffic: TrafficCore;
  readonly budgetsPermille: Uint16Array;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly rng: Pcg32;
  readonly flows: FireFlows;
  /** Residents fleeing a collapsed building (GrowthFlows.emigrants). */
  readonly onFlee: (count: number) => void;
  readonly emit: (
    severity: "warning" | "alert",
    messageKey: string,
    summaryKey: string,
    links: FireCauseLink[],
  ) => void;
}

/** A fire station ready to dispatch: twin sources + budget-scaled reach. */
interface Station {
  readonly buildingIndex: number;
  readonly tile: number;
  readonly sources: readonly AnchorSource[];
  readonly radius: number;
  trucks: number;
}

function collectStations(ctx: FireContext): Station[] {
  const b = ctx.buildings;
  const budget = ctx.budgetsPermille[ServiceId.fire - 1] as number;
  const twin = ctx.traffic.twin;
  const stations: Station[] = [];
  for (const i of aliveByTile(b)) {
    const spec = specForTableKind(b.kind[i] as number);
    if (spec === null || spec.service !== ServiceId.fire) {
      continue;
    }
    const tile = b.tileIdx[i] as number;
    const sources = anchorSources(twin, tile, ctx.mapWidth, ctx.mapHeight);
    if (sources.length === 0) {
      continue; // island station: decor (pillar 2)
    }
    stations.push({
      buildingIndex: i,
      tile,
      sources,
      radius: scaledRadius(spec, budget),
      trucks: Math.max(1, scaledCapacity(spec, budget)),
    });
  }
  return stations;
}

/** The worst v/c LIVE edge along a twin shortest-path tree branch. */
function worstEdgeOnPath(
  ctx: FireContext,
  tree: { dist: Uint32Array; cameFromEdge: Int32Array },
  from: number,
  to: number,
): number {
  const twin = ctx.traffic.twin;
  const g = ctx.roads;
  let worstLive = -1;
  let worstRatio = -1;
  let node = to;
  while (node !== from) {
    const e = tree.cameFromEdge[node] as number;
    if (e === -1) {
      break;
    }
    const a = twin.edgeA[e] as number;
    const b = twin.edgeB[e] as number;
    // Twin → live by COORDINATES (canonical), never by slot arithmetic.
    const liveA = nodeAt(g, twin.nodeX[a] as number, twin.nodeY[a] as number);
    const liveB = nodeAt(g, twin.nodeX[b] as number, twin.nodeY[b] as number);
    if (liveA !== -1 && liveB !== -1) {
      const live = edgeBetween(g, liveA, liveB);
      if (live !== -1 && (g.edgeCapacity_[live] as number) > 0) {
        const ratio = Math.floor(
          ((ctx.traffic.volumes[live] as number) * 1000) / (g.edgeCapacity_[live] as number),
        );
        if (ratio > worstRatio) {
          worstRatio = ratio;
          worstLive = live;
        }
      }
    }
    node = otherEnd(twin, e, node);
  }
  return worstLive;
}

/**
 * One hourly fire pass: ignition over this hour's slice, then burning
 * progression / response / spread / collapse over ALL burning buildings
 * in canonical order. Ruins age daily and clear after RUIN_CLEAR_DAYS.
 */
export function fireSlice(ctx: FireContext, tick: number): void {
  const b = ctx.buildings;
  const order = aliveByTile(b);
  if (order.length === 0) {
    return;
  }
  const slice = Math.floor(tick / 60) % 24;
  const hourOfDay = slice;

  // ── ignition rolls over this hour's visit share ──
  for (let p = slice; p < order.length; p += 24) {
    const i = order[p] as number;
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind >= PLOPPABLE_KIND_OFFSET) {
      continue; // ploppables are fireproof in v1 (board note)
    }
    const status = b.status[i] as number;
    if (status === BuildingStatus.abandoned || status >= BuildingStatus.onFire) {
      continue;
    }
    const chance =
      kind === ZoneKind.industrial
        ? IGNITION_PER_100K_DAY * INDUSTRY_IGNITION_MULT
        : IGNITION_PER_100K_DAY;
    if (ctx.rng.nextBounded(100_000) < chance) {
      b.status[i] = BuildingStatus.onFire;
      b.fireTicks[i] = 1;
      b.version++;
      ctx.flows.ignitions++;
      ctx.emit("warning", "advisor.fire", "cause.buildingOnFire", [
        {
          kind: EntityKind.building,
          id: b.tileIdx[i] as number,
          labelKey: "cause.ignition",
          weightPermille: 1000,
        },
      ]);
    }
  }

  // ── burning buildings: response → spread → collapse, canonical order ──
  const burning: number[] = [];
  for (const i of order) {
    if (b.alive[i] === 1 && (b.status[i] as number) === BuildingStatus.onFire) {
      burning.push(i);
    }
  }
  if (burning.length > 0) {
    const twin = ctx.traffic.twin;
    const stations = collectStations(ctx);
    // One CONGESTED shortest-path tree per station SOURCE, min-folded
    // with the source offsets and interpolated along edge interiors
    // exactly like coverage — response distance is "coverage distance
    // measured on the jammed network".
    const trees = stations.map((s) =>
      dijkstraTree(
        twin,
        (s.sources[0] as AnchorSource).node,
        (e) => ctx.traffic.twinCosts[e] as number,
      ),
    );
    const fields = stations.map((s, at) => {
      const primary = trees[at] as { dist: Uint32Array };
      const folded = new Uint32Array(primary.dist.length).fill(0xffffffff);
      for (const src of s.sources) {
        const tree =
          src.node === (s.sources[0] as AnchorSource).node
            ? primary
            : dijkstraTree(twin, src.node, (e) => ctx.traffic.twinCosts[e] as number);
        for (let n = 0; n < folded.length; n++) {
          const d = tree.dist[n] as number;
          if (d !== 0xffffffff && d + src.offset < (folded[n] as number)) {
            folded[n] = d + src.offset;
          }
        }
      }
      return interpolateEdgeDistances(
        twin,
        folded,
        ctx.mapWidth,
        ctx.mapHeight,
        (e) => ctx.traffic.twinCosts[e] as number,
      );
    });
    for (const i of burning) {
      const tile = b.tileIdx[i] as number;
      // Cheapest CONGESTED responder with a free truck.
      let bestStation = -1;
      let bestCost = 0xffffffff;
      for (let s = 0; s < stations.length; s++) {
        const st = stations[s] as Station;
        if (st.trucks === 0) {
          continue;
        }
        const field = fields[s] as { dist: Uint32Array };
        const cost = windowMin(field.dist, tile, ctx.mapWidth, ctx.mapHeight);
        if (cost < bestCost) {
          bestCost = cost;
          bestStation = s;
        }
      }
      const responder = bestStation === -1 ? null : (stations[bestStation] as Station);
      if (responder !== null && bestCost <= responder.radius) {
        // The truck makes it: fire out, truck spent for this hour.
        responder.trucks--;
        b.status[i] = BuildingStatus.normal;
        b.fireTicks[i] = 0;
        b.version++;
        ctx.flows.extinguished++;
        continue;
      }
      // Nobody arrives in time. Say WHY, with resolving links (ADR-009) —
      // once per PRIMARY fire, at the moment it turns dangerous.
      const ticksNow = burnHours(b.fireTicks[i] as number);
      const isSecondary = ((b.fireTicks[i] as number) & SECONDARY_FIRE_BIT) !== 0;
      if (ticksNow === SPREAD_AFTER_HOURS && !isSecondary) {
        const links: FireCauseLink[] = [
          {
            kind: EntityKind.building,
            id: tile,
            labelKey: "cause.fireRagingUnanswered",
            weightPermille: 1000,
          },
        ];
        if (responder !== null) {
          const field = fields[bestStation] as { dist: Uint32Array; via: Int32Array };
          const viaNode = windowVia(field.dist, field.via, tile, ctx.mapWidth, ctx.mapHeight);
          const worst =
            viaNode === -1
              ? -1
              : worstEdgeOnPath(
                  ctx,
                  trees[bestStation] as { dist: Uint32Array; cameFromEdge: Int32Array },
                  (responder.sources[0] as AnchorSource).node,
                  viaNode,
                );
          if (worst !== -1) {
            links.push({
              kind: EntityKind.edge,
              id: worst,
              labelKey: "cause.truckDelayedByTraffic",
              weightPermille: 1000,
            });
          }
          links.push({
            kind: EntityKind.building,
            id: responder.tile,
            labelKey: "cause.respondingStation",
            weightPermille: 1000,
          });
          ctx.emit("alert", "advisor.fireSpreading", "cause.truckLate", links);
        } else {
          ctx.emit("alert", "advisor.fireSpreading", "cause.noFireService", links);
        }
      }
      // Burn on (marker bit preserved).
      b.fireTicks[i] =
        ((b.fireTicks[i] as number) & SECONDARY_FIRE_BIT) | Math.min(0x7f, ticksNow + 1);
      // ONE-HOP spread: an unanswered PRIMARY fire deterministically takes
      // its first eligible neighbor with it (fixed scan order) — exactly
      // once, the hour it turns dangerous. Multi-hop chains are Phase 8.
      if (ticksNow + 1 === SPREAD_AFTER_HOURS + 1 && !isSecondary) {
        const x = tile % ctx.mapWidth;
        const y = Math.floor(tile / ctx.mapWidth);
        let jumped = false;
        for (let dy = -1; dy <= 1 && !jumped; dy++) {
          for (let dx = -1; dx <= 1 && !jumped; dx++) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= ctx.mapWidth || ny >= ctx.mapHeight) {
              continue;
            }
            const n = b.byTile.get(ny * ctx.mapWidth + nx);
            if (n === undefined || b.alive[n] !== 1) {
              continue;
            }
            const nStatus = b.status[n] as number;
            const nKind = b.kind[n] as number;
            if (nStatus >= BuildingStatus.onFire || nKind >= PLOPPABLE_KIND_OFFSET) {
              continue;
            }
            b.status[n] = BuildingStatus.onFire;
            b.fireTicks[n] = SECONDARY_FIRE_BIT | 1;
            b.version++;
            ctx.flows.spreads++;
            jumped = true;
          }
        }
      }
      // Collapse.
      if (burnHours(b.fireTicks[i] as number) >= BURN_RUIN_HOURS) {
        const fleeing = residentsOf(b, i);
        if (fleeing > 0) {
          b.cohorts.fill(0, i * COHORT_BLOCK, (i + 1) * COHORT_BLOCK);
          ctx.onFlee(fleeing);
        }
        b.status[i] = BuildingStatus.ruin;
        b.fireTicks[i] = 0;
        b.failDays[i] = 0;
        b.sick[i] = 0;
        b.corpses[i] = 0;
        b.version++;
        ctx.flows.ruins++;
      }
    }
  }

  // ── ruins age once a day and clear (lot freed for regrowth) ──
  if (hourOfDay === 5) {
    for (const i of order) {
      if (b.alive[i] !== 1 || (b.status[i] as number) !== BuildingStatus.ruin) {
        continue;
      }
      b.failDays[i] = Math.min(255, (b.failDays[i] as number) + 1);
      if ((b.failDays[i] as number) >= RUIN_CLEAR_DAYS) {
        demolishBuilding(b, i);
      }
    }
  }
}

/** Every fire-service spec is dispatchable (sanity surface for tests). */
export function fireStationSpecs(): number[] {
  const kinds: number[] = [];
  for (const [kind, spec] of SERVICE_BUILDING_SPECS) {
    if (spec.service === ServiceId.fire) {
      kinds.push(kind);
    }
  }
  return kinds;
}
