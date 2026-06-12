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
  type RoadClass,
  type RoadGraph,
} from "../roads/graph";
import { edgeCost } from "../roads/pathfind";
import {
  assignOriginCell,
  bprCost,
  buildCells,
  type Cell,
  type ConservationLedger,
  costFieldHash,
  pathfinderFor,
  pathsForCostField,
} from "./assignment";

export const FULL_SOLVE_HOUR = 4; // daily equilibrium at 04:00 (TDD §6.3)
export const FULL_SOLVE_PASSES = 4; // [TUNE]
export const MSA_K_CAP = 8; // [TUNE]
/**
 * Ticks per PASS — an incremental job spans 12 ticks, a full solve 48,
 * both inside the 60-tick hour. Shorter passes also bound the dominant
 * solver cost (the per-tick live-OD rebuild) [TUNE; PERF: 34-tick passes
 * put the year-long balance replay at 125 s — this is the lever].
 */
export const TICKS_PER_PASS = 12;
export const JOB_BUDGET_TICKS = TICKS_PER_PASS * FULL_SOLVE_PASSES;

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
  /** Last completed pass's conservation ledger. Canonical. */
  generated: number;
  assigned: number;
  walked: number;
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
  /** Per-LIVE-slot mirror of canonVolumes (advisor, overlay, tests). */
  volumes: Uint32Array;
  /** Per-LIVE-slot congested costs (inspector/overlay surface). */
  congestedCost: Uint32Array;
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

/** Re-derive cost fields + mirrors from canonical volumes (twin reused). */
function retimeTraffic(core: TrafficCore, g: RoadGraph): void {
  const twin = core.twin;
  core.twinCosts = new Uint32Array(twin.edgeCount);
  for (let e = 0; e < twin.edgeCount; e++) {
    const key = core.twinSlotKeys[e] ?? null;
    if (key === null) {
      continue;
    }
    core.twinCosts[e] = bprCost(
      edgeCost(twin, e),
      core.canonVolumes.get(key) ?? 0,
      twin.edgeCapacity_[e] as number,
    );
  }
  core.costHash = costFieldHash(twin, core.twinCosts);
  core.volumes = new Uint32Array(g.edgeCount);
  core.congestedCost = new Uint32Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const v = core.canonVolumes.get(edgeKey(g, e)) ?? 0;
    core.volumes[e] = v;
    core.congestedCost[e] = bprCost(edgeCost(g, e), v, g.edgeCapacity_[e] as number);
  }
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
    unroutable: 0,
    job: null,
    graphVersion: g.version,
    twin: createRoadGraph(),
    twinSlotKeys: [],
    twinCosts: new Uint32Array(0),
    costHash: "",
    volumes: new Uint32Array(0),
    congestedCost: new Uint32Array(0),
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
    ledger: { generated: 0, assigned: 0, walked: 0, unroutable: 0 },
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
  let totalJobs = 0;
  for (const cell of cells) {
    totalJobs += cell.jobs;
  }
  const passes = job.kind === SolveKind.full ? FULL_SOLVE_PASSES : 1;
  const sliceCells = Math.max(1, Math.ceil(cells.length / TICKS_PER_PASS));
  const pf = pathfinderFor(twin);
  const paths = pathsForCostField(twin, core.costHash);
  const addVolume = (slot: number, trips: number): void => {
    const key = core.twinSlotKeys[slot] ?? null;
    if (key !== null) {
      job.aon.set(key, (job.aon.get(key) ?? 0) + trips);
    }
  };
  const end = Math.min(cells.length, job.cursor + sliceCells);
  for (; job.cursor < end; job.cursor++) {
    assignOriginCell(
      twin,
      pf,
      paths,
      cells,
      cells[job.cursor] as Cell,
      totalJobs,
      core.twinCosts,
      addVolume,
      job.ledger,
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
  core.unroutable = job.ledger.unroutable;

  if (job.passIndex + 1 < passes) {
    job.passIndex++;
    job.cursor = 0;
    job.aon = new Map();
    job.ledger = { generated: 0, assigned: 0, walked: 0, unroutable: 0 };
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
    unroutable: saved.unroutable,
    job: null,
    graphVersion: g.version,
    twin: createRoadGraph(),
    twinSlotKeys: [],
    twinCosts: new Uint32Array(0),
    costHash: "",
    volumes: new Uint32Array(0),
    congestedCost: new Uint32Array(0),
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
        unroutable: j.unroutable,
      },
    };
  }
  return core;
}
