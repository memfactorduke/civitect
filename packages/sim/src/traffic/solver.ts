/**
 * The sliced MSA traffic solver (TDD §6.3, Phase 3 tranche 2). Volumes are
 * PERSISTENT canonical state evolved by the Method of Successive Averages:
 *
 *   v_k = v_{k-1} + ⌊(aon_k − v_{k-1}) / k⌋        (integer, ADR-005)
 *
 * Full equilibrium solve daily at 04:00 (FULL_SOLVE_PASSES internal passes,
 * pass j blending with k = j+1 — pass 0 replaces, later passes refine);
 * incremental single-pass step hourly. msaK caps at MSA_K_CAP so an old
 * equilibrium never stops absorbing new demand.
 *
 * Canonical volumes are keyed by canonical edge IDENTITY (endpoints +
 * class), never by edge slot: slots are construction history (free-list
 * reuse, splits), and per-slot state would break the undo exit criterion
 * (build∘undo ≡ identity). Per-slot arrays here are DERIVED mirrors.
 *
 * A job freezes NOTHING: each tick it re-derives the OD table from live
 * buildings and routes on the live congested-cost field (constant within a
 * pass — it only changes at pass finalize or network edit), then processes
 * a FIXED number of origin cells (work-based slicing, no clocks, ADR-005)
 * sized to finish within JOB_BUDGET_TICKS (< the 60-tick hour). Because
 * nothing is frozen, job runtime state is tiny ({kind, passIndex, cursor,
 * aon, ledger}), rides the hash and the save, and a mid-job load resumes
 * bit-exactly — the continued-identity test depends on it.
 *
 * Network edits do NOT restart the solver (deviation from TDD §6.3's
 * event-driven step, recorded there: a mid-hour restart would make traffic
 * state depend on edit timing and break undo-identity); they re-derive the
 * cost field immediately, and demand shifts join at the next hourly step.
 */
import type { TrafficJobSave, TrafficSave } from "@civitect/protocol";
import type { Buildings } from "../growth/buildings";
import {
  addEdge,
  addNode,
  canonicalEdgeOrder,
  canonicalGraph,
  createRoadGraph,
  otherEnd,
  type RoadClass,
  type RoadGraph,
} from "../roads/graph";
import { dijkstraTree, edgeCost } from "../roads/pathfind";
import { buildTransitService } from "../transit/modechoice";
import type { TransitState } from "../transit/transit";
import {
  assignOriginCell,
  bprCost,
  buildCells,
  CELL_TILES,
  type Cell,
  type ConservationLedger,
  costFieldHash,
} from "./assignment";

export const FULL_SOLVE_HOUR = 4; // daily equilibrium at 04:00 (TDD §6.3)
export const FULL_SOLVE_PASSES = 4; // [TUNE]
export const MSA_K_CAP = 8; // [TUNE]
/**
 * Origin cells processed per tick — the per-tick WORK bound is fixed and
 * passes stretch with map size instead (an L map's incremental pass takes
 * ⌈cells/8⌉ ticks; metro maps solve at a slower cadence — the hourly step
 * becomes "as fast as the budget allows" past ~96 cells [TUNE; PERF:
 * sized against the 250k metro scenario, tranche 6]).
 */
export const ORIGINS_PER_TICK = 8;

/**
 * Rush-hour departure curve (GDD §9.5), permille of a cell's commuters
 * departing in each hour [TUNE]: AM peak 7–9, PM peak 17–19, quiet nights.
 */
export const DEPARTURE_CURVE_PERMILLE: readonly number[] = [
  50, 30, 30, 30, 60, 150, 500, 900, 1000, 700, 450, 400, 420, 400, 380, 420, 600, 900, 1000, 650,
  350, 200, 120, 80,
];

export const SolveKind = {
  incremental: 1,
  full: 2,
} as const;
export type SolveKind = (typeof SolveKind)[keyof typeof SolveKind];

export interface SolveJob {
  kind: SolveKind;
  passIndex: number;
  /** Next origin cell to process (cells re-derive each tick from live state). */
  cursor: number;
  /** This pass's all-or-nothing volumes, by canonical edge key. */
  aon: Map<string, number>;
  ledger: ConservationLedger;
}

export interface TrafficCore {
  /** Canonical MSA-averaged volumes, by canonical edge key. Hashed+saved. */
  canonVolumes: Map<string, number>;
  /** MSA steps since the last full solve, capped at MSA_K_CAP. Canonical. */
  msaK: number;
  /** Last completed pass's conservation ledger. Canonical (generated/assigned/
   *  walked/unroutable hashed+saved; `ridden` is derived from them, task 4). */
  generated: number;
  assigned: number;
  walked: number;
  ridden: number;
  unroutable: number;
  job: SolveJob | null;
  // ── derived (rebuilt on edit/finalize/load — never hashed or saved) ──
  /** Graph revision the derived fields describe (fence, like utilities'). */
  graphVersion: number;
  /**
   * The CANONICAL TWIN: the live network rebuilt from canonical segments,
   * so its node/edge indices are construction-history-free. All routing
   * (anchors, A* tie-breaks, adjacency order) runs on the twin — per-slot
   * decisions on the live graph would leak construction order into
   * canonical volumes and break save/load identity (caught by the
   * mid-solve save test).
   */
  twin: RoadGraph;
  /** Canonical key per alive TWIN slot (null = dead). */
  twinSlotKeys: (string | null)[];
  /** Routing cost field per TWIN slot: bprCost(freeFlow, volume, capacity). */
  twinCosts: Uint32Array;
  /** Path-cache key for the current twin cost field. */
  costHash: string;
  /** Per-LIVE-slot mirror of canonVolumes + freight (advisor, overlay, tests). */
  volumes: Uint32Array;
  /** Per-LIVE-slot congested costs (inspector/overlay surface). */
  congestedCost: Uint32Array;
  // ── freight (Phase 5 task 3): DERIVED from chain shipments, never hashed
  //    or saved (recomputed each hourly solve + on load). Keyed by canonical
  //    edge key like canonVolumes, so it survives the twin rebuild; routed
  //    on the TWIN (construction-history-free) so the commute costs it feeds
  //    reproduce after load. ───────────────────────────────────────────────
  /** Per canonical edge: trucks currently traversing it (all-day load). */
  freightVolumes: Map<string, number>;
  /** Freight conservation ledger this solve: generated ≡ assigned + unroutable. */
  freightGenerated: number;
  freightAssigned: number;
  freightUnroutable: number;
  /** Congestion charge (Phase 6 task 3): per canonical edge, a precomputed
   *  integer surcharge folded into twinCosts so driving through a charged
   *  district costs more (shifts commuters to transit). DERIVED — never hashed
   *  or saved (like freightVolumes); recomputed from the SAVED district layer +
   *  policyMask on load + on any policy/paint edit (the epoch fence below). */
  chargeByKey: Map<string, number>;
  /** Truck ban (Phase 6 task 3): per canonical edge, a FREIGHT-only surcharge —
   *  applyFreight adds it so trucks route around a banned district; NOT in the
   *  commute cost field. DERIVED (recomputed on load + on the epoch fence).
   *  Because it moves freightVolumes (hashed via twinCosts), the fence must
   *  recompute FREIGHT the tick a ban toggles (see world.ts). */
  banByKey: Map<string, number>;
  /** districts.policyEpoch the charge/ban were last reindexed against — the
   *  fence that re-applies them the SAME tick a policy/paint command lands. */
  chargeEpoch: number;
}

/** One freight movement to route on the network (trucks = OD volume unit). */
export interface FreightTrip {
  readonly fromTile: number;
  readonly toTile: number;
  readonly trucks: number;
}

/** Canonical edge identity — matches canonicalEdgeOrder's normalization. */
function edgeKey(g: RoadGraph, e: number): string {
  const a = g.edgeA[e] as number;
  const b = g.edgeB[e] as number;
  let ax = g.nodeX[a] as number;
  let ay = g.nodeY[a] as number;
  let bx = g.nodeX[b] as number;
  let by = g.nodeY[b] as number;
  if (ax > bx || (ax === bx && ay > by)) {
    [ax, ay, bx, by] = [bx, by, ax, ay];
  }
  return `${ax},${ay},${bx},${by},${g.edgeClass[e]}`;
}

/**
 * Re-derive cost fields + mirrors from canonical volumes PLUS freight (twin
 * reused). Freight (Phase 5) adds to the BPR input and the live mirror so
 * trucks congest the road the same as commuters do — but it stays out of
 * canonVolumes (the hashed/saved commute state), so it's hash-invisible and
 * recomputed on load (GDD §9 [LOCKED]: freight loads the network all day).
 */
function retimeTraffic(core: TrafficCore, g: RoadGraph): void {
  const twin = core.twin;
  core.twinCosts = new Uint32Array(twin.edgeCount);
  for (let e = 0; e < twin.edgeCount; e++) {
    const key = core.twinSlotKeys[e] ?? null;
    if (key === null) {
      continue;
    }
    const load = (core.canonVolumes.get(key) ?? 0) + (core.freightVolumes.get(key) ?? 0);
    const base = bprCost(edgeCost(twin, e), load, twin.edgeCapacity_[e] as number);
    // Congestion charge (task 3): a precomputed surcharge on charged-district
    // edges. size===0 (no charge active) ⇒ base exactly — byte-identical, so
    // every charge-free city (all goldens) is unaffected.
    core.twinCosts[e] =
      core.chargeByKey.size === 0 ? base : base + (core.chargeByKey.get(key) ?? 0);
  }
  core.costHash = costFieldHash(twin, core.twinCosts);
  core.volumes = new Uint32Array(g.edgeCount);
  core.congestedCost = new Uint32Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const key = edgeKey(g, e);
    const v = (core.canonVolumes.get(key) ?? 0) + (core.freightVolumes.get(key) ?? 0);
    core.volumes[e] = v;
    core.congestedCost[e] = bprCost(edgeCost(g, e), v, g.edgeCapacity_[e] as number);
  }
}

/**
 * Route the current freight movements on the TWIN and refresh the derived
 * cost field to include them (Phase 5 task 3 — the deferred volume
 * injection). Grouped by origin twin-node: one shortest-path tree per
 * distinct origin over the freight-inclusive cost field, trucks accumulated
 * along each destination's path by canonical edge key. The freight ledger
 * conserves: generated ≡ assigned + unroutable (no walking — trucks always
 * drive). Endpoints map to the nearest alive twin node (Chebyshev, lowest
 * index tie-break — deterministic, construction-history-free).
 */
export function applyFreight(
  core: TrafficCore,
  freight: readonly FreightTrip[],
  g: RoadGraph,
  nodeForTile: (tile: number) => number,
): void {
  const twin = core.twin;
  const byOrigin = new Map<number, { to: number; trucks: number }[]>();
  let generated = 0;
  let unroutable = 0;
  for (const f of freight) {
    generated += f.trucks;
    const from = nodeForTile(f.fromTile);
    const to = nodeForTile(f.toTile);
    if (from === -1 || to === -1) {
      unroutable += f.trucks;
      continue;
    }
    let dests = byOrigin.get(from);
    if (dests === undefined) {
      dests = [];
      byOrigin.set(from, dests);
    }
    dests.push({ to, trucks: f.trucks });
  }

  const freightVolumes = new Map<string, number>();
  let assigned = 0;
  for (const from of [...byOrigin.keys()].sort((a, b) => a - b)) {
    const dests = byOrigin.get(from) as { to: number; trucks: number }[];
    // Freight routes on the BASE congestion (subtract the passenger charge, so
    // freight is charge-INDEPENDENT ⇒ load-invariant) PLUS the truck-ban
    // surcharge (task 3), so trucks route around a banned district. The ban DOES
    // move freightVolumes and thus the hashed cost field, so the epoch fence
    // recomputes freight the tick a ban toggles — matching the load recompute —
    // to stay load-invariant (world.ts).
    const tree = dijkstraTree(twin, from, (e) => {
      const key = core.twinSlotKeys[e] ?? null;
      const charge = key === null ? 0 : (core.chargeByKey.get(key) ?? 0);
      const ban = key === null ? 0 : (core.banByKey.get(key) ?? 0);
      return (core.twinCosts[e] as number) - charge + ban;
    });
    for (const { to, trucks } of dests) {
      if ((tree.dist[to] as number) === 0xffffffff) {
        unroutable += trucks;
        continue;
      }
      assigned += trucks;
      let node = to;
      while (node !== from) {
        const e = tree.cameFromEdge[node] as number;
        const key = core.twinSlotKeys[e] ?? null;
        if (key !== null) {
          freightVolumes.set(key, (freightVolumes.get(key) ?? 0) + trucks);
        }
        node = otherEnd(twin, e, node);
      }
    }
  }
  core.freightVolumes = freightVolumes;
  core.freightGenerated = generated;
  core.freightAssigned = assigned;
  core.freightUnroutable = unroutable;
  retimeTraffic(core, g);
}

/**
 * Reindex the two DISTRICT-AWARE traffic policies (Phase 6 task 3) and fold the
 * charge into the cost field. Both are free-flow-proportional per-edge addends
 * (load-independent ⇒ precompute to a constant per edge, never double-count the
 * BPR term), keyed by canonical edge id (survives the twin rebuild), DERIVED
 * (recomputed on load, like freight). An edge belongs to its MIDPOINT tile's
 * district.
 *   - CONGESTION CHARGE (chargedAt): folded into twinCosts ⇒ raises the CAR/
 *     commute cost (freight ignores it — see applyFreight). Passenger lever.
 *   - TRUCK BAN (bannedAt): a FREIGHT-only surcharge (applyFreight adds it, the
 *     commute cost field does NOT) ⇒ trucks route around the district.
 * chargePermille/banPermille 0 (or no tagged tile) leaves an empty map ⇒ retime
 * yields base costs, byte-identical to no policy.
 */
export function applyDistrictTrafficPolicies(
  core: TrafficCore,
  g: RoadGraph,
  mapWidth: number,
  chargedAt: (tileIdx: number) => boolean,
  chargePermille: number,
  bannedAt: (tileIdx: number) => boolean,
  banPermille: number,
): void {
  const twin = core.twin;
  const charge = new Map<string, number>();
  const ban = new Map<string, number>();
  const anyCharge = chargePermille > 0;
  const anyBan = banPermille > 0;
  if (anyCharge || anyBan) {
    for (let e = 0; e < twin.edgeCount; e++) {
      const key = core.twinSlotKeys[e] ?? null;
      if (key === null) {
        continue;
      }
      const midX =
        ((twin.nodeX[twin.edgeA[e] as number] as number) +
          (twin.nodeX[twin.edgeB[e] as number] as number)) >>
        1;
      const midY =
        ((twin.nodeY[twin.edgeA[e] as number] as number) +
          (twin.nodeY[twin.edgeB[e] as number] as number)) >>
        1;
      const tile = midY * mapWidth + midX;
      if (anyCharge && chargedAt(tile)) {
        charge.set(key, Math.floor((edgeCost(twin, e) * chargePermille) / 1000));
      }
      if (anyBan && bannedAt(tile)) {
        ban.set(key, Math.floor((edgeCost(twin, e) * banPermille) / 1000));
      }
    }
  }
  core.chargeByKey = charge;
  core.banByKey = ban;
  retimeTraffic(core, g);
}

/**
 * Rebuild every derived field from canonical state + the live graph: the
 * canonical twin, its cost field, the live mirrors. Also PRUNE canonical
 * maps to the alive key set: a stale key (edge that died) must not
 * resurrect its old volume if an undo re-creates the edge — a loaded world
 * (which never saw the stale entry) would diverge. Map DOMAIN never hashes
 * (reads are `get(key) ?? 0`), so pruning is hash-invisible.
 */
export function refreshTrafficDerived(core: TrafficCore, g: RoadGraph): void {
  core.graphVersion = g.version;
  const twin = createRoadGraph();
  for (const e of canonicalGraph(g).edges) {
    addEdge(twin, addNode(twin, e.ax, e.ay), addNode(twin, e.bx, e.by), e.roadClass as RoadClass);
  }
  core.twin = twin;
  core.twinSlotKeys = new Array<string | null>(twin.edgeCount).fill(null);
  const prunedVolumes = new Map<string, number>();
  const prunedAon = core.job === null ? null : new Map<string, number>();
  for (let e = 0; e < twin.edgeCount; e++) {
    const key = edgeKey(twin, e);
    core.twinSlotKeys[e] = key;
    const v = core.canonVolumes.get(key) ?? 0;
    if (v !== 0) {
      prunedVolumes.set(key, v);
    }
    if (prunedAon !== null && core.job !== null) {
      const a = core.job.aon.get(key) ?? 0;
      if (a !== 0) {
        prunedAon.set(key, a);
      }
    }
  }
  core.canonVolumes = prunedVolumes;
  if (prunedAon !== null && core.job !== null) {
    core.job.aon = prunedAon;
  }
  retimeTraffic(core, g);
}

export function createTraffic(g: RoadGraph): TrafficCore {
  const core: TrafficCore = {
    canonVolumes: new Map(),
    msaK: 0,
    generated: 0,
    assigned: 0,
    walked: 0,
    ridden: 0,
    unroutable: 0,
    job: null,
    graphVersion: g.version,
    twin: createRoadGraph(),
    twinSlotKeys: [],
    twinCosts: new Uint32Array(0),
    costHash: "",
    volumes: new Uint32Array(0),
    congestedCost: new Uint32Array(0),
    freightVolumes: new Map(),
    chargeByKey: new Map(),
    banByKey: new Map(),
    chargeEpoch: 0,
    freightGenerated: 0,
    freightAssigned: 0,
    freightUnroutable: 0,
  };
  refreshTrafficDerived(core, g);
  return core;
}

export function startSolveJob(core: TrafficCore, kind: SolveKind): void {
  core.job = {
    kind,
    passIndex: 0,
    cursor: 0,
    aon: new Map(),
    ledger: { generated: 0, assigned: 0, walked: 0, ridden: 0, unroutable: 0 },
  };
}

/**
 * Process one tick's slice against LIVE state. Returns true when the JOB
 * finished this tick (volumes blended, costs re-timed — the advisor check
 * reads fresh state).
 */
export function stepSolveJob(
  core: TrafficCore,
  buildings: Buildings,
  g: RoadGraph,
  mapWidth: number,
  mapHeight: number,
  hourOfDay = 8, // peak default keeps direct-driven tests meaningful
  transit: TransitState | null = null,
): boolean {
  const job = core.job;
  if (job === null) {
    return false;
  }
  // Live OD over the CANONICAL TWIN: re-derived per tick (growth keeps
  // moving under a sliced solve; per-origin conservation holds because
  // each origin is processed once per pass).
  const twin = core.twin;
  const cells = buildCells(buildings, twin, mapWidth, mapHeight);
  // Transit reduced to cell-space once per slice (cheap: lines × stops).
  const service = transit === null ? null : buildTransitService(transit, mapWidth, CELL_TILES);
  let totalJobs = 0;
  for (const cell of cells) {
    totalJobs += cell.jobs;
  }
  const passes = job.kind === SolveKind.full ? FULL_SOLVE_PASSES : 1;
  const sliceCells = ORIGINS_PER_TICK;
  const addVolume = (slot: number, trips: number): void => {
    const key = core.twinSlotKeys[slot] ?? null;
    if (key !== null) {
      job.aon.set(key, (job.aon.get(key) ?? 0) + trips);
    }
  };
  const demandPermille = DEPARTURE_CURVE_PERMILLE[hourOfDay] ?? 1000;
  const end = Math.min(cells.length, job.cursor + sliceCells);
  for (; job.cursor < end; job.cursor++) {
    assignOriginCell(
      twin,
      cells,
      cells[job.cursor] as Cell,
      totalJobs,
      core.twinCosts,
      addVolume,
      job.ledger,
      demandPermille,
      service,
    );
  }
  if (job.cursor < cells.length) {
    return false;
  }

  // ── pass finalize: MSA blend (wholesale rebuild prunes stale keys),
  //    derived re-time, ledger ──────────────────────────────────────────
  const k = job.kind === SolveKind.full ? job.passIndex + 1 : Math.min(core.msaK + 1, MSA_K_CAP);
  const blended = new Map<string, number>();
  for (let e = 0; e < twin.edgeCount; e++) {
    const key = core.twinSlotKeys[e] ?? null;
    if (key === null) {
      continue;
    }
    const v = core.canonVolumes.get(key) ?? 0;
    blended.set(key, v + Math.floor(((job.aon.get(key) ?? 0) - v) / k));
  }
  core.canonVolumes = blended;
  retimeTraffic(core, g);
  core.generated = job.ledger.generated;
  core.assigned = job.ledger.assigned;
  core.walked = job.ledger.walked;
  core.ridden = job.ledger.ridden;
  core.unroutable = job.ledger.unroutable;

  if (job.passIndex + 1 < passes) {
    job.passIndex++;
    job.cursor = 0;
    job.aon = new Map();
    job.ledger = { generated: 0, assigned: 0, walked: 0, ridden: 0, unroutable: 0 };
    return false;
  }
  core.msaK = job.kind === SolveKind.full ? 1 : k;
  core.job = null;
  return true;
}

// ── persistence (one canonical form, two consumers: stateHash + .civ) ──────

/**
 * Canonical serialized form: per-edge values in canonicalEdgeOrder — the
 * roads section's order — so identical networks serialize identically and
 * loads remap onto the rebuilt graph by position.
 */
export function trafficToSave(core: TrafficCore, g: RoadGraph): TrafficSave {
  const order = canonicalEdgeOrder(g);
  const mapValues = (src: ReadonlyMap<string, number>): Uint32Array => {
    const out = new Uint32Array(order.length);
    for (let i = 0; i < order.length; i++) {
      out[i] = src.get(edgeKey(g, order[i] as number)) ?? 0;
    }
    return out;
  };
  let job: TrafficJobSave | null = null;
  if (core.job !== null) {
    const j = core.job;
    job = {
      kind: j.kind,
      passIndex: j.passIndex,
      cursor: j.cursor,
      generated: j.ledger.generated,
      assigned: j.ledger.assigned,
      walked: j.ledger.walked,
      unroutable: j.ledger.unroutable,
      aon: mapValues(j.aon),
    };
  }
  return {
    msaK: core.msaK,
    generated: core.generated,
    assigned: core.assigned,
    walked: core.walked,
    unroutable: core.unroutable,
    volumes: mapValues(core.canonVolumes),
    job,
  };
}

export function trafficFromSave(saved: TrafficSave, g: RoadGraph): TrafficCore {
  const order = canonicalEdgeOrder(g);
  if (saved.volumes.length !== order.length) {
    throw new Error(
      `traffic save covers ${saved.volumes.length} edges, rebuilt graph has ${order.length}`,
    );
  }
  const unmapValues = (src: Uint32Array): Map<string, number> => {
    const out = new Map<string, number>();
    for (let i = 0; i < order.length; i++) {
      const v = src[i] as number;
      if (v !== 0) {
        out.set(edgeKey(g, order[i] as number), v);
      }
    }
    return out;
  };
  const core: TrafficCore = {
    canonVolumes: unmapValues(saved.volumes),
    msaK: saved.msaK,
    generated: saved.generated,
    assigned: saved.assigned,
    walked: saved.walked,
    // Derived from the saved four (task 4) — never persisted separately.
    ridden: saved.generated - saved.assigned - saved.walked - saved.unroutable,
    unroutable: saved.unroutable,
    job: null,
    graphVersion: g.version,
    twin: createRoadGraph(),
    twinSlotKeys: [],
    twinCosts: new Uint32Array(0),
    costHash: "",
    volumes: new Uint32Array(0),
    congestedCost: new Uint32Array(0),
    // Freight is derived — recomputed at the first hourly solve after load.
    freightVolumes: new Map(),
    chargeByKey: new Map(),
    banByKey: new Map(),
    chargeEpoch: 0,
    freightGenerated: 0,
    freightAssigned: 0,
    freightUnroutable: 0,
  };
  refreshTrafficDerived(core, g);
  if (saved.job !== null) {
    const j = saved.job;
    core.job = {
      kind: j.kind === SolveKind.full ? SolveKind.full : SolveKind.incremental,
      passIndex: j.passIndex,
      cursor: j.cursor,
      aon: unmapValues(j.aon),
      ledger: {
        generated: j.generated,
        assigned: j.assigned,
        walked: j.walked,
        ridden: j.generated - j.assigned - j.walked - j.unroutable,
        unroutable: j.unroutable,
      },
    };
  }
  return core;
}
