/**
 * Inspector queries, request/response with stable ids (TDD §7). Panels poll
 * at 4 Hz while open, not per-tick — this channel is for detail-on-demand,
 * never for frame-rate state (that's the snapshot's job).
 *
 * v1 inspected tiles only; v10 adds ROAD info for tile targets a road
 * covers (GDD §9.5 road inspector: volume, capacity, travel time).
 * Building/agent payloads arrive with their systems (each addition bumps
 * PROTOCOL_VERSION).
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { decodeEntityRef, type EntityRef, encodeEntityRef } from "./cause";
import { DecodeError } from "./errors";

export interface InspectorRequest {
  /** u32, echoes back in the response — panels may have several in flight. */
  readonly requestId: number;
  readonly target: EntityRef;
}

export interface TileInfo {
  /** Flat tile index (y * mapWidth + x) — the stable tile id (TDD §5). */
  readonly tileIdx: number;
  /** u8 terrain kind id. 0 = grass until the Phase 1 terrain table lands. */
  readonly terrainKind: number;
  /** u8 elevation terrace (TDD §5 tile grid). */
  readonly elevationTerrace: number;
  /** u8 zone kind. 0 = unzoned until Phase 2. */
  readonly zoneKind: number;
}

/** Road inspector payload (GDD §9.5) for the edge covering a tile target. */
export interface RoadInfo {
  readonly roadClass: number;
  /** MSA-averaged vehicle trips on the edge (last solve). */
  readonly volume: number;
  readonly capacity: number;
  /** Volume/capacity, permille, capped 3000 (BPR ratio cap). */
  readonly vcPermille: number;
  /** Travel times in cost micro-units (edgeCost scale). */
  readonly freeFlowCost: number;
  readonly congestedCost: number;
}

/**
 * Building inspector payload (v11). Service fields are zero for grown
 * buildings — `serviceId` 0 means "not a service building".
 */
export interface BuildingInfo {
  /** ZoneKind for grown buildings; 100+BuildingKind for ploppables. */
  readonly kind: number;
  readonly level: number;
  readonly status: number;
  /** ServiceId this building provides, 0 = none (GDD §7). */
  readonly serviceId: number;
  /** Capacity after the budget slider's scaling. */
  readonly capacityTotal: number;
  readonly capacityUsed: number;
  /** Jobs waiting on this building's service queue. */
  readonly queueLength: number;
  /** coverage × capacity-fill, permille (GDD §7 effectiveness). */
  readonly effectivenessPermille: number;
}

/** Per-tile environment readout (GDD §10), all 0–255 field samples. */
export interface EnvironInfo {
  readonly airPollution: number;
  readonly groundPollution: number;
  readonly noise: number;
  readonly waterPollution: number;
}

export interface InspectorResponse {
  readonly requestId: number;
  /** Tick the answer was computed on — stale answers are detectable. */
  readonly tick: number;
  /** Null = target not found / kind not inspectable in this protocol version. */
  readonly tile: TileInfo | null;
  /** Road covering the target tile, when there is one (v10). */
  readonly road: RoadInfo | null;
  /** Building on the target tile, when there is one (v11). */
  readonly building: BuildingInfo | null;
  /** Environment fields at the target tile (v11). */
  readonly environ: EnvironInfo | null;
}

export function encodeInspectorRequestBody(w: ByteWriter, req: InspectorRequest): void {
  w.u32(req.requestId);
  encodeEntityRef(w, req.target);
}

export function decodeInspectorRequestBody(r: ByteReader): InspectorRequest {
  return { requestId: r.u32(), target: decodeEntityRef(r) };
}

export function encodeInspectorResponseBody(w: ByteWriter, res: InspectorResponse): void {
  w.u32(res.requestId).u64(res.tick);
  if (res.tile === null) {
    w.u8(0);
  } else {
    w.u8(1);
    w.u32(res.tile.tileIdx);
    w.u8(res.tile.terrainKind).u8(res.tile.elevationTerrace).u8(res.tile.zoneKind);
  }
  if (res.road === null) {
    w.u8(0);
  } else {
    w.u8(1)
      .u8(res.road.roadClass)
      .u32(res.road.volume)
      .u32(res.road.capacity)
      .u16(res.road.vcPermille)
      .u32(res.road.freeFlowCost)
      .u32(res.road.congestedCost);
  }
  if (res.building === null) {
    w.u8(0);
  } else {
    w.u8(1)
      .u16(res.building.kind)
      .u8(res.building.level)
      .u8(res.building.status)
      .u8(res.building.serviceId)
      .u32(res.building.capacityTotal)
      .u32(res.building.capacityUsed)
      .u32(res.building.queueLength)
      .u16(res.building.effectivenessPermille);
  }
  if (res.environ === null) {
    w.u8(0);
  } else {
    w.u8(1)
      .u8(res.environ.airPollution)
      .u8(res.environ.groundPollution)
      .u8(res.environ.noise)
      .u8(res.environ.waterPollution);
  }
}

export function decodeInspectorResponseBody(r: ByteReader): InspectorResponse {
  const requestId = r.u32();
  const tick = r.u64();
  const found = r.u8();
  if (found > 1) {
    throw new DecodeError(`tile presence flag must be 0|1, got ${found}`);
  }
  let tile: TileInfo | null = null;
  if (found === 1) {
    tile = {
      tileIdx: r.u32(),
      terrainKind: r.u8(),
      elevationTerrace: r.u8(),
      zoneKind: r.u8(),
    };
  }
  const hasRoad = r.u8();
  if (hasRoad > 1) {
    throw new DecodeError(`road presence flag must be 0|1, got ${hasRoad}`);
  }
  let road: RoadInfo | null = null;
  if (hasRoad === 1) {
    road = {
      roadClass: r.u8(),
      volume: r.u32(),
      capacity: r.u32(),
      vcPermille: r.u16(),
      freeFlowCost: r.u32(),
      congestedCost: r.u32(),
    };
  }
  const hasBuilding = r.u8();
  if (hasBuilding > 1) {
    throw new DecodeError(`building presence flag must be 0|1, got ${hasBuilding}`);
  }
  let building: BuildingInfo | null = null;
  if (hasBuilding === 1) {
    building = {
      kind: r.u16(),
      level: r.u8(),
      status: r.u8(),
      serviceId: r.u8(),
      capacityTotal: r.u32(),
      capacityUsed: r.u32(),
      queueLength: r.u32(),
      effectivenessPermille: r.u16(),
    };
  }
  const hasEnviron = r.u8();
  if (hasEnviron > 1) {
    throw new DecodeError(`environ presence flag must be 0|1, got ${hasEnviron}`);
  }
  let environ: EnvironInfo | null = null;
  if (hasEnviron === 1) {
    environ = {
      airPollution: r.u8(),
      groundPollution: r.u8(),
      noise: r.u8(),
      waterPollution: r.u8(),
    };
  }
  return { requestId, tick, tile, road, building, environ };
}
