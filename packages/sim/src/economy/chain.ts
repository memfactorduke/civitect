/**
 * The goods chain (GDD §8 [chain structure LOCKED], board phase-5 task 3):
 * Raw (map-resource-gated) → Processed → Goods → retail C, with REAL
 * freight — every hop is a shipment whose arrival was priced on the
 * CONGESTED network at dispatch, and whose trucks load the hourly traffic
 * solve while en route. Outside connections at map-edge road anchors
 * import deficits (city cost, line 9) and buy exports (city income,
 * line 10) [TUNE — the C-profit coupling sharpens with tourism, task 4].
 *
 * Determinism: no RNG anywhere — production is occupancy math, supplier
 * choice is nearest-by-Chebyshev with tileIdx tie-breaks, every scan walks
 * aliveByTile order (the save/load slot-order lesson). All quantities are
 * integers; the conservation identity is EXACT by construction:
 *   produced ≡ consumed + exported − imported + Δstock + inTransit + lost
 * per commodity, where `lost` absorbs demolition of endpoints mid-flight.
 */
import { ChainRole, Commodity, ReportLineKind, ZoneKind } from "@civitect/protocol";
import { aliveByTile, BuildingStatus, type Buildings, capacityFor } from "../growth/buildings";
import type { RoadGraph } from "../roads/graph";
import { dijkstraTree } from "../roads/pathfind";
import { accumulate, type EconomyState } from "./budget";

export const COMMODITIES = 6;
/**
 * The cumulative conservation ledgers (produced/consumed/imported/exported/lost)
 * are Uint32Array and wrap at 2^32 — reachable only over very long games (~20+
 * game-years at metro scale). The conservation identity holds EXACTLY in modular
 * u32 arithmetic, so differences of these accumulators are reduced to their
 * canonical signed value: a balanced-but-wrapped ledger yields 0, while a genuine
 * (always-small) leak still shows. The cumulative totals are internal-only — no
 * gameplay/UI reads them (reports use per-period deltas) — so u32-cyclic storage
 * is fine; widen to u64 only if lifetime totals are ever surfaced.
 */
const LEDGER_MODULUS = 0x1_0000_0000; // 2^32
// Reduce x to its canonical signed representative in (-2^31, 2^31]. Genuine
// residuals/deficits are bounded FAR below 2^31: total live stock per commodity
// is at most buildingCount * STOCK_OUT_CAP (tens of millions of units), so a
// balanced-but-wrapped ledger reduces to 0 while a real leak keeps its true
// small value. `>=` at the fold makes the (physically unreachable) exact-2^31
// case skip rather than book a phantom. LIMITATION: a true leak of EXACTLY a
// multiple of 2^32 reduces to 0 (invisible) — accepted, since real leaks are
// tiny and this avoids widening the ledgers (which would change the save format
// + FNV state hash and force a golden re-bless).
function modSignedLedger(x: number): number {
  const m = ((x % LEDGER_MODULUS) + LEDGER_MODULUS) % LEDGER_MODULUS;
  return m >= LEDGER_MODULUS / 2 ? m - LEDGER_MODULUS : m;
}
export const TICKS_PER_HOUR = 60;
export const TICKS_PER_DAY = 1440;

/** Throughput per level per day, units [TUNE]. */
export const RAW_OUTPUT_PER_DAY = 6;
export const PROCESS_THROUGHPUT_PER_DAY = 6;
export const RETAIL_SALES_DIVISOR = 8; // residents served per unit-day
/** Stock geometry [TUNE]: reorder when low, ship in lots, cap the shelves. */
export const REORDER_POINT = 8;
export const ORDER_LOT = 24;
export const STOCK_IN_CAP = 64;
export const STOCK_OUT_CAP = 192;
export const EXPORT_THRESHOLD = 160;
export const EXPORT_KEEP = 96;
/** A truck carries this many units (freight trips = ceil(units/this)). */
export const TRUCK_UNITS = 8;
/** Congested cost units per tick of travel [TUNE]; floor + cap below. */
export const COST_PER_TICK = 10;
export const MIN_TRANSIT_TICKS = 60;
export const MAX_TRANSIT_TICKS = 4320; // 3 game-days — congestion can hurt, not hang
/** City's border prices, cents per unit [TUNE]. */
export const IMPORT_COST_CENTS: readonly number[] = [60, 40, 40, 80, 90, 120]; // per Commodity−1
export const EXPORT_PRICE_CENTS: readonly number[] = [30, 20, 20, 40, 50, 70];

/** One in-flight shipment (canonical — hashed and saved, v9). */
export interface Shipment {
  fromKind: number; // 0 building, 1 edge anchor
  fromTile: number;
  toKind: number;
  toTile: number;
  commodity: number;
  units: number;
  dispatchTick: number;
  arriveTick: number;
}

/** Canonical chain state on the world. All fields are hashed and saved (v9). */
export interface ChainState {
  /** Dispatch order — stable, canonical. */
  shipments: Shipment[];
  readonly produced: Uint32Array;
  readonly consumed: Uint32Array;
  readonly imported: Uint32Array;
  readonly exported: Uint32Array;
  readonly lost: Uint32Array;
}

export function createChain(): ChainState {
  return {
    shipments: [],
    produced: new Uint32Array(COMMODITIES),
    consumed: new Uint32Array(COMMODITIES),
    imported: new Uint32Array(COMMODITIES),
    exported: new Uint32Array(COMMODITIES),
    lost: new Uint32Array(COMMODITIES),
  };
}

/**
 * Role for a NEWLY SPAWNED industrial building (GDD §8): a resource tile
 * makes a raw extractor of that resource — specialized industry never sites
 * off-resource (the board's rejection guarantee, held as a spawn invariant).
 *
 * The processed/goods split is a DETERMINISTIC FUNCTION OF THE TILE (a
 * Knuth-multiplicative hash parity), NOT a running counter: a counter would
 * drift above the true count on mid-day demolition, and a load (which can
 * only recount the survivors) would then assign the next spawn a different
 * role — a save/load hash divergence (found by adversarial review). Keying
 * on the canonical tile makes live and loaded worlds agree forever, ~50/50
 * across the map with no state to keep.
 */
export function chainRoleForSpawn(
  resourceAtTile: number,
  tileIdx: number,
): (typeof ChainRole)[keyof typeof ChainRole] {
  if (resourceAtTile >= 1 && resourceAtTile <= 4) {
    return resourceAtTile as (typeof ChainRole)[keyof typeof ChainRole];
  }
  // Low bit of the multiplicative hash — construction-history-free, balanced.
  return ((Math.imul(tileIdx, 2654435761) >>> 31) & 1) === 0
    ? ChainRole.processed
    : ChainRole.goods;
}

function isWorking(b: Buildings, i: number): boolean {
  const status = b.status[i] as number;
  return (
    b.alive[i] === 1 &&
    status !== BuildingStatus.abandoned &&
    status !== BuildingStatus.ruin &&
    (b.fireTicks[i] as number) === 0
  );
}

/** Input commodity a working consumer needs, or 0. */
export function inputCommodityOf(b: Buildings, i: number): number {
  const role = b.chainRole[i] as number;
  if (role === ChainRole.processed) {
    // Processing accepts ANY raw — the nearest raw supplier decides which;
    // the books stay per-commodity via the shipment's commodity field.
    return -1; // sentinel: any of 1–4
  }
  if (role === ChainRole.goods) {
    return Commodity.processed;
  }
  const kind = b.kind[i] as number;
  if (kind === ZoneKind.commercialLow || kind === ZoneKind.commercialHigh) {
    return Commodity.goods;
  }
  return 0;
}

/** Output commodity a working producer offers, or 0. */
export function outputCommodityOf(b: Buildings, i: number): number {
  const role = b.chainRole[i] as number;
  if (role >= ChainRole.rawOre && role <= ChainRole.rawOil) {
    return role; // raw roles share commodity values
  }
  if (role === ChainRole.processed) {
    return Commodity.processed;
  }
  if (role === ChainRole.goods) {
    return Commodity.goods;
  }
  return 0;
}

/**
 * The DAILY pass (midnight tick): produce, transform, sell — and reset
 * thriveDays on starved consumers (GDD §6 de-level pressure). Walks
 * canonical tile order; pure integer math; returns the day's starved
 * building indices (for the advisor layer — capped there, not here).
 *
 * `chainActive` gates the de-level pressure: a city with NO outside
 * connection and no internal supplier can't possibly feed its industry, so
 * penalizing it for empty shelves would be perverse (and would destabilize
 * the isolated traffic exit-criteria scenarios, which level industry on
 * occupancy alone). Connected cities — every golden, every archetype — get
 * the real pressure.
 */
export function chainDailyPass(chain: ChainState, b: Buildings, chainActive = true): number[] {
  const starved: number[] = [];
  for (const i of aliveByTile(b)) {
    if (!isWorking(b, i)) {
      continue;
    }
    const role = b.chainRole[i] as number;
    const level = b.level[i] as number;
    if (role >= ChainRole.rawOre && role <= ChainRole.rawOil) {
      const made = Math.min(RAW_OUTPUT_PER_DAY * level, STOCK_OUT_CAP - (b.stockOut[i] as number));
      if (made > 0) {
        b.stockOut[i] = (b.stockOut[i] as number) + made;
        chain.produced[role - 1] = (chain.produced[role - 1] as number) + made;
      }
      continue;
    }
    if (role === ChainRole.processed || role === ChainRole.goods) {
      const want = PROCESS_THROUGHPUT_PER_DAY * level;
      const have = b.stockIn[i] as number;
      const room = STOCK_OUT_CAP - (b.stockOut[i] as number);
      const ran = Math.min(want, have, room);
      if (ran > 0) {
        b.stockIn[i] = have - ran;
        b.stockOut[i] = (b.stockOut[i] as number) + ran;
        const out = role === ChainRole.processed ? Commodity.processed : Commodity.goods;
        // Input was booked consumed at its delivery door (the book-at-door
        // model — see chainHourlyPass); transformation books only OUTPUT
        // production. stockIn is generic fuel, outside per-commodity stock.
        chain.produced[out - 1] = (chain.produced[out - 1] as number) + ran;
      }
      if (have === 0 && ran === 0) {
        if (chainActive) {
          b.thriveDays[i] = 0; // starved producer never levels (GDD §6)
        }
        starved.push(i);
      }
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind === ZoneKind.commercialLow || kind === ZoneKind.commercialHigh) {
      const shoppers = capacityFor(kind, level);
      const want = Math.max(1, Math.floor(shoppers / RETAIL_SALES_DIVISOR));
      const have = b.stockIn[i] as number;
      // Goods were booked consumed when they reached retail's door; the
      // sale just depletes the generic shelf buffer so it reorders.
      b.stockIn[i] = have - Math.min(want, have);
      if (have === 0) {
        if (chainActive) {
          b.thriveDays[i] = 0; // empty shelves never level (GDD §6)
        }
        starved.push(i);
      }
    }
  }
  return starved;
}

/** Map-edge road anchors (derived, cached on graph version). */
const anchorCache = new WeakMap<RoadGraph, { version: number; nodes: number[] }>();

export function edgeAnchors(g: RoadGraph, mapWidth: number, mapHeight: number): readonly number[] {
  let cached = anchorCache.get(g);
  if (cached === undefined || cached.version !== g.version) {
    const nodes: number[] = [];
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.nodeAlive[n] !== 1) {
        continue;
      }
      const x = g.nodeX[n] as number;
      const y = g.nodeY[n] as number;
      if (x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1) {
        nodes.push(n);
      }
    }
    cached = { version: g.version, nodes };
    anchorCache.set(g, cached);
  }
  return cached.nodes;
}

function chebyshev(aTile: number, bTile: number, mapWidth: number): number {
  const ax = aTile % mapWidth;
  const ay = Math.floor(aTile / mapWidth);
  const bx = bTile % mapWidth;
  const by = Math.floor(bTile / mapWidth);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export interface DispatchInputs {
  readonly buildings: Buildings;
  /**
   * The routing graph MUST be the canonical TWIN (construction-history-free),
   * NOT the live graph: shipment arrival times feed fundsCents/report lines
   * (hashed), so routing on live node indices — which reshuffle on load —
   * would diverge a loaded world. Same reason commute and freight route on
   * the twin.
   */
  readonly graph: RoadGraph;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly tick: number;
  /** Per-twin-edge congested cost field (traffic core's twinCosts). */
  readonly costField: Uint32Array;
  /** Nearest alive TWIN node for a tile, or -1. */
  readonly nodeForTile: (tile: number) => number;
  readonly economy: EconomyState;
  /** Treasury mutation goes through the caller (one cash door). */
  readonly moveFunds: (cents: number) => void;
}

function transitTicks(distCost: number): number {
  if (distCost === 0xffffffff) {
    return -1; // unreachable on the network
  }
  return Math.min(
    MAX_TRANSIT_TICKS,
    Math.max(MIN_TRANSIT_TICKS, Math.floor(distCost / COST_PER_TICK)),
  );
}

/**
 * The HOURLY pass: deliver arrivals, then reorder — every working consumer
 * below REORDER_POINT with no inbound shipment picks the nearest stocked
 * supplier (Chebyshev, tileIdx tie-break); none ⇒ import from the nearest
 * map-edge anchor (city pays line 9); producers over EXPORT_THRESHOLD ship
 * surplus to the nearest anchor (city earns line 10 on arrival). Arrival
 * times ride ONE Dijkstra per distinct shipping origin per hour, on the
 * frozen congested field — congestion literally slows the supply chain.
 */
export function chainHourlyPass(chain: ChainState, inputs: DispatchInputs): void {
  const b = inputs.buildings;
  const { mapWidth, tick } = inputs;
  // NOTE: demolished-cargo reconciliation runs at the END of the tick (see
  // runTick), AFTER every demolish site including the fire ruin-clear, so the
  // identity holds at the hour boundary even for a producer burned this tick.

  // ── arrivals (and the lost-cargo book for dead endpoints) ──
  if (chain.shipments.length > 0) {
    const keep: Shipment[] = [];
    for (const s of chain.shipments) {
      if (s.arriveTick > tick) {
        keep.push(s);
        continue;
      }
      if (s.toKind === 1) {
        // Export arrived at the border: the city sells it.
        chain.exported[s.commodity - 1] = (chain.exported[s.commodity - 1] as number) + s.units;
        const cents = s.units * (EXPORT_PRICE_CENTS[s.commodity - 1] as number);
        inputs.moveFunds(cents);
        accumulate(inputs.economy, ReportLineKind.exports, cents);
        continue;
      }
      const at = b.byTile.get(s.toTile);
      if (at === undefined || !isWorking(b, at)) {
        chain.lost[s.commodity - 1] = (chain.lost[s.commodity - 1] as number) + s.units;
        continue;
      }
      const taken = Math.min(s.units, STOCK_IN_CAP - (b.stockIn[at] as number));
      b.stockIn[at] = (b.stockIn[at] as number) + taken;
      // Book-at-door (the model that keeps conservation exact without
      // per-commodity input buffers — a processed plant accepts ANY raw
      // into one counter): the delivered units are CONSUMED here, the
      // shelf is generic fuel outside any commodity's stock; overflow that
      // doesn't fit is lost cargo.
      chain.consumed[s.commodity - 1] = (chain.consumed[s.commodity - 1] as number) + taken;
      if (taken < s.units) {
        chain.lost[s.commodity - 1] = (chain.lost[s.commodity - 1] as number) + (s.units - taken);
      }
    }
    chain.shipments = keep;
  }

  // ── inbound tally so a pending order isn't re-placed every hour ──
  const inboundUnits = new Map<number, number>();
  for (const s of chain.shipments) {
    if (s.toKind === 0) {
      inboundUnits.set(s.toTile, (inboundUnits.get(s.toTile) ?? 0) + s.units);
    }
  }

  // ── gather suppliers (canonical order) ──
  const order = aliveByTile(b);
  const suppliers: { index: number; tile: number; commodity: number }[] = [];
  for (const i of order) {
    if (!isWorking(b, i)) {
      continue;
    }
    const out = outputCommodityOf(b, i);
    if (out !== 0 && (b.stockOut[i] as number) >= TRUCK_UNITS) {
      suppliers.push({ index: i, tile: b.tileIdx[i] as number, commodity: out });
    }
  }
  const anchors = edgeAnchors(inputs.graph, mapWidth, inputs.mapHeight);

  // ── orders: one batch per shipping origin → one Dijkstra each ──
  type Order = { fromTree: number; s: Shipment; importCents: number };
  const pending: Order[] = [];
  for (const i of order) {
    if (!isWorking(b, i)) {
      continue;
    }
    const need = inputCommodityOf(b, i);
    if (need === 0) {
      continue;
    }
    const tile = b.tileIdx[i] as number;
    const stock = (b.stockIn[i] as number) + (inboundUnits.get(tile) ?? 0);
    if (stock > REORDER_POINT) {
      continue;
    }
    // Nearest supplier with matching output (any raw for processing).
    let best = -1;
    let bestDist = 0x7fffffff;
    for (const sup of suppliers) {
      if (sup.index === i) {
        continue;
      }
      const matches = need === -1 ? sup.commodity <= Commodity.rawOil : sup.commodity === need;
      if (!matches || (b.stockOut[sup.index] as number) < TRUCK_UNITS) {
        continue;
      }
      const d = chebyshev(tile, sup.tile, mapWidth);
      if (
        d < bestDist ||
        (d === bestDist && best !== -1 && sup.tile < (b.tileIdx[best] as number))
      ) {
        best = sup.index;
        bestDist = d;
      }
    }
    if (best !== -1) {
      const units = Math.min(ORDER_LOT, b.stockOut[best] as number);
      b.stockOut[best] = (b.stockOut[best] as number) - units;
      const commodity = outputCommodityOf(b, best);
      pending.push({
        fromTree: inputs.nodeForTile(b.tileIdx[best] as number),
        importCents: 0,
        s: {
          fromKind: 0,
          fromTile: b.tileIdx[best] as number,
          toKind: 0,
          toTile: tile,
          commodity,
          units,
          dispatchTick: tick,
          arriveTick: 0, // priced below
        },
      });
      continue;
    }
    // No internal supplier: import through the nearest border anchor.
    if (anchors.length === 0) {
      continue; // landlocked and unsupplied — starvation will say why
    }
    let anchor = anchors[0] as number;
    let anchorDist = 0x7fffffff;
    for (const n of anchors) {
      const nTile =
        (inputs.graph.nodeY[n] as number) * mapWidth + (inputs.graph.nodeX[n] as number);
      const d = chebyshev(tile, nTile, mapWidth);
      if (d < anchorDist) {
        anchorDist = d;
        anchor = n;
      }
    }
    const commodity = need === -1 ? Commodity.rawOre : need;
    const units = ORDER_LOT;
    const cents = units * (IMPORT_COST_CENTS[commodity - 1] as number);
    pending.push({
      fromTree: anchor,
      importCents: cents,
      s: {
        fromKind: 1,
        fromTile:
          (inputs.graph.nodeY[anchor] as number) * mapWidth +
          (inputs.graph.nodeX[anchor] as number),
        toKind: 0,
        toTile: tile,
        commodity,
        units,
        dispatchTick: tick,
        arriveTick: 0,
      },
    });
  }

  // ── exports: producers dump surplus to the nearest border anchor ──
  if (anchors.length > 0) {
    for (const sup of suppliers) {
      if ((b.stockOut[sup.index] as number) < EXPORT_THRESHOLD) {
        continue;
      }
      const units = (b.stockOut[sup.index] as number) - EXPORT_KEEP;
      b.stockOut[sup.index] = EXPORT_KEEP;
      let anchor = anchors[0] as number;
      let anchorDist = 0x7fffffff;
      for (const n of anchors) {
        const nTile =
          (inputs.graph.nodeY[n] as number) * mapWidth + (inputs.graph.nodeX[n] as number);
        const d = chebyshev(sup.tile, nTile, mapWidth);
        if (d < anchorDist) {
          anchorDist = d;
          anchor = n;
        }
      }
      pending.push({
        fromTree: inputs.nodeForTile(sup.tile),
        importCents: 0,
        s: {
          fromKind: 0,
          fromTile: sup.tile,
          toKind: 1,
          toTile:
            (inputs.graph.nodeY[anchor] as number) * mapWidth +
            (inputs.graph.nodeX[anchor] as number),
          commodity: sup.commodity,
          units,
          dispatchTick: tick,
          arriveTick: 0,
        },
      });
    }
  }

  // ── price every pending shipment: one tree per distinct origin node ──
  const trees = new Map<number, { dist: Uint32Array }>();
  for (const order_ of pending) {
    const fromNode = order_.fromTree;
    // Both endpoints route through their covering graph node; for an export
    // the destination tile already IS the anchor node's tile.
    const toNode = inputs.nodeForTile(order_.s.toTile);
    let ticks = MAX_TRANSIT_TICKS;
    if (fromNode !== -1 && toNode !== -1) {
      let tree = trees.get(fromNode);
      if (tree === undefined) {
        tree = dijkstraTree(inputs.graph, fromNode, (e) => inputs.costField[e] as number);
        trees.set(fromNode, tree);
      }
      const t = transitTicks(tree.dist[toNode] as number);
      ticks = t === -1 ? MAX_TRANSIT_TICKS : t;
    }
    order_.s.arriveTick = tick + ticks;
    if (order_.importCents > 0) {
      // The city covers the deficit at the border, the moment it ships.
      inputs.moveFunds(-order_.importCents);
      accumulate(inputs.economy, ReportLineKind.imports, -order_.importCents);
      chain.imported[order_.s.commodity - 1] =
        (chain.imported[order_.s.commodity - 1] as number) + order_.s.units;
    }
    chain.shipments.push(order_.s);
  }
}

/** Trucks a shipment puts on the road (freight OD volume unit). */
export function trucksFor(units: number): number {
  return Math.max(1, Math.ceil(units / TRUCK_UNITS));
}

/** Σ producer output stock per commodity (the only stock the identity counts;
 *  input buffers were consumed at their door). */
export function chainStock(b: Buildings): Uint32Array {
  const stock = new Uint32Array(COMMODITIES);
  for (const i of aliveByTile(b)) {
    const out = outputCommodityOf(b, i);
    if (out !== 0) {
      stock[out - 1] = (stock[out - 1] as number) + (b.stockOut[i] as number);
    }
  }
  return stock;
}

/** Σ in-flight shipment units per commodity. */
export function chainInTransit(chain: ChainState): Uint32Array {
  const t = new Uint32Array(COMMODITIES);
  for (const s of chain.shipments) {
    t[s.commodity - 1] = (t[s.commodity - 1] as number) + s.units;
  }
  return t;
}

/**
 * Book stock that vanished by DEMOLITION (lifecycle clear, fire ruin,
 * bulldoze) as `lost`, restoring the exact identity without a hook at every
 * demolish site. Every legitimate stock change is already booked (produce →
 * +produced, ship → +inTransit, deliver → +consumed/+exported), so for each
 * commodity the booked-predicted stock minus the actual stock is exactly the
 * demolished cargo:
 *   predicted = produced + imported − consumed − exported − lost − inTransit
 *   lost += max(0, predicted − actualStock)
 * Run at the top of every hourly pass, so the conservation identity holds at
 * every hour boundary (the property test's checkpoint).
 */
export function reconcileLost(chain: ChainState, b: Buildings): void {
  const stock = chainStock(b);
  const inTransit = chainInTransit(chain);
  for (let c = 0; c < COMMODITIES; c++) {
    const predicted =
      (chain.produced[c] as number) +
      (chain.imported[c] as number) -
      (chain.consumed[c] as number) -
      (chain.exported[c] as number) -
      (chain.lost[c] as number) -
      (inTransit[c] as number);
    // Reduce the raw difference mod 2^32 (ledgers are Uint32Array): a wrap
    // boundary on the consumed/exported/lost side must not spuriously inflate,
    // nor a produced-side wrap suppress, the genuine demolished-cargo deficit
    // (always small relative to 2^31).
    const deficit = modSignedLedger(predicted - (stock[c] as number));
    if (deficit > 0) {
      chain.lost[c] = (chain.lost[c] as number) + deficit;
    }
  }
}

/** The per-commodity conservation residual (0 everywhere ⇒ books balance). */
export function chainConservationResidual(chain: ChainState, b: Buildings): number[] {
  const stock = chainStock(b);
  const inTransit = chainInTransit(chain);
  const residual: number[] = [];
  for (let c = 0; c < COMMODITIES; c++) {
    // Reduce mod 2^32 (ledgers are Uint32Array): the conservation identity holds
    // exactly in modular u32 arithmetic, so a balanced-but-wrapped ledger yields
    // 0 while a genuine leak (a small non-multiple-of-2^32 residual) still shows.
    residual.push(
      modSignedLedger(
        (chain.produced[c] as number) +
          (chain.imported[c] as number) -
          ((chain.consumed[c] as number) +
            (chain.exported[c] as number) +
            (chain.lost[c] as number) +
            (inTransit[c] as number) +
            (stock[c] as number)),
      ),
    );
  }
  return residual;
}
