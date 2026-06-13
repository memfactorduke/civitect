/**
 * The sim worker (TDD §1 runtime topology): the ENTIRE simulation lives
 * here; the main thread renders and dispatches. Every byte in or out wears
 * the protocol envelope — decodeMessage's version check makes protocol
 * mismatch a hard boot error (TDD §7), with the first snapshot acting as
 * the handshake.
 *
 * Tick scheduling:
 * - Scheduled ticks: every TICK_MS, run `world.speed` ticks (0 = none).
 * - Command ticks: an arriving command is stamped to the current tick and
 *   applied by ONE immediate tick. This is what makes tap→highlight beat
 *   the 50 ms input→visual budget (TDD §2) — waiting for the next scheduled
 *   tick would cost up to 100 ms before the sim even saw the tap. Replay
 *   determinism is untouched: time is the tick counter, not the wall clock,
 *   and the log records the applied tick (ADR-005 §6).
 *
 * Typing note: the package compiles under the DOM lib (main thread is the
 * bulk of it); TS's DOM and WebWorker libs can't coexist in one project, so
 * the few worker globals used here are typed structurally.
 */
import {
  AGENT_FLOATS,
  type Command,
  decodeCiv,
  decodeMessage,
  EntityKind,
  encodeCiv,
  encodeMessage,
  MessageKind,
  type ServiceId,
  type Snapshot,
  SnapshotKind,
} from "@civitect/protocol";
import {
  createWorld,
  edgeAtTile,
  edgeCost,
  landValueAtTile,
  pollutionAt,
  runTick,
  scaledCapacity,
  serviceCoverage,
  specForTableKind,
  toSnapshot,
} from "@civitect/sim";
import { BOOT } from "./boot-config";
import { civToWorld, worldToCiv } from "./save-codec";

const ctx = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, options?: { transfer?: ArrayBuffer[] }): void;
};

const TICK_MS = 100; // 10 Hz (ADR-005)

let world = createWorld(BOOT.seed, BOOT.mapWidth, BOOT.mapHeight);

/**
 * Authoritative session command log, in applied (re-stamped) form — the
 * save command-tail and the bug-report repro (seed + log, ADR-005 §6).
 * Loading replaces the world wholesale, so the log resets with it.
 */
let commandLog: Command[] = [];

function post(bytes: Uint8Array): void {
  ctx.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
}

let lastSentRoadVersion = -1;
let lastSentBuildingVersion = -1;
let lastSentZoneVersion = -1;
let lastSentCostHash = "";
/** Active coverage overlay (0 = none) — worker-held, never sim state. */
let activeOverlay: ServiceId | 0 = 0;
let lastSentCoverageDigest = -1;

/**
 * The agent transform rider (TDD §7): [id, kind, x, y, headingMilli] per
 * live agent, floats, transferred zero-copy ALONGSIDE the encoded snapshot
 * — agentCount in the codec is the validated contract. atan2 lives HERE
 * (the boundary), not in the sim (ADR-005 keeps transcendentals out).
 */
function agentRider(): Float32Array | null {
  const pool = world.agents;
  if (pool.liveCount === 0) {
    return null;
  }
  const out = new Float32Array(pool.liveCount * AGENT_FLOATS);
  let at = 0;
  for (let s = 0; s < pool.count; s++) {
    if (pool.alive[s] !== 1) {
      continue;
    }
    out[at++] = pool.id[s] as number;
    out[at++] = pool.kind[s] as number;
    out[at++] = (pool.xMilli[s] as number) / 1000;
    out[at++] = (pool.yMilli[s] as number) / 1000;
    out[at++] = Math.round(Math.atan2(pool.dyMilli[s] as number, pool.dxMilli[s] as number) * 1000);
  }
  return out;
}

function postSnapshot(kind: Snapshot["kind"]): void {
  // Full lists ride keyframes and the first snapshot after a change;
  // otherwise deltas say "unchanged" (null) — TDD §7 delta semantics.
  const includeRoads =
    kind === SnapshotKind.keyframe || world.roads.version !== lastSentRoadVersion;
  const includeBuildings =
    kind === SnapshotKind.keyframe || world.buildings.version !== lastSentBuildingVersion;
  const includeZones = kind === SnapshotKind.keyframe || world.zoneVersion !== lastSentZoneVersion;
  const includeCongestion =
    kind === SnapshotKind.keyframe || world.traffic.costHash !== lastSentCostHash;
  const coverageDigest = activeOverlay === 0 ? -1 : serviceCoverage(world, activeOverlay).digestU32;
  const includeCoverage =
    activeOverlay !== 0 &&
    (kind === SnapshotKind.keyframe || coverageDigest !== lastSentCoverageDigest);
  const bytes = encodeMessage({
    kind: MessageKind.snapshot,
    body: toSnapshot(
      world,
      kind,
      includeRoads,
      includeBuildings,
      includeZones,
      includeCongestion,
      activeOverlay,
      includeCoverage,
    ),
  });
  const agents = agentRider();
  const transfer: ArrayBuffer[] = [bytes.buffer as ArrayBuffer];
  if (agents !== null) {
    transfer.push(agents.buffer as ArrayBuffer);
  }
  ctx.postMessage({ bytes, agents }, { transfer });
  lastSentRoadVersion = world.roads.version;
  lastSentBuildingVersion = world.buildings.version;
  lastSentZoneVersion = world.zoneVersion;
  lastSentCostHash = world.traffic.costHash;
  lastSentCoverageDigest = coverageDigest;
}

function applyBatch(batch: readonly Command[]): void {
  const rejections = runTick(world, batch);
  for (const rejection of rejections) {
    post(encodeMessage({ kind: MessageKind.commandRejection, body: rejection }));
  }
}

async function handleSaveRequest(slot: number): Promise<void> {
  try {
    // Capture synchronously (plain numbers + RNG state tuples), THEN compress
    // async — ticks that land mid-encode can't smear into the snapshot.
    const captured = worldToCiv(world, commandLog);
    const civ = await encodeCiv(captured);
    post(encodeMessage({ kind: MessageKind.saveResponse, body: { slot, civ } }));
  } catch (error) {
    // Empty civ = save failed (e.g. roads await save format v3). The
    // manager rejects; a hung promise or a dead worker would be worse.
    console.error("[sim] save failed:", error);
    post(encodeMessage({ kind: MessageKind.saveResponse, body: { slot, civ: new Uint8Array(0) } }));
  }
}

async function handleLoadRequest(civ: Uint8Array): Promise<void> {
  try {
    const save = await decodeCiv(civ); // checksum + version-header validation (TDD §10)
    world = civToWorld(save);
    commandLog = [];
    post(
      encodeMessage({
        kind: MessageKind.loadResponse,
        body: { ok: true, tick: world.tick, detail: "" },
      }),
    );
    postSnapshot(SnapshotKind.keyframe); // scene-jump: full re-prime
  } catch (error) {
    post(
      encodeMessage({
        kind: MessageKind.loadResponse,
        body: {
          ok: false,
          tick: world.tick,
          detail: error instanceof Error ? error.message : String(error),
        },
      }),
    );
  }
}

ctx.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  const message = decodeMessage(bytes);
  switch (message.kind) {
    case MessageKind.command: {
      // Re-stamp to the tick this command actually applies on (see header).
      const command = { ...message.body, tick: world.tick } as Command;
      commandLog.push(command);
      applyBatch([command]);
      postSnapshot(SnapshotKind.delta);
      break;
    }
    case MessageKind.saveRequest:
      void handleSaveRequest(message.body.slot);
      break;
    case MessageKind.loadRequest:
      void handleLoadRequest(message.body.civ);
      break;
    case MessageKind.inspectorRequest: {
      const target = message.body.target;
      let tile = null;
      let road = null;
      let building = null;
      if (target.kind === EntityKind.tile) {
        const tileIdx = target.id;
        tile = {
          tileIdx,
          terrainKind: 0, // terrain kind table joins with its phase
          elevationTerrace: 0,
          zoneKind: world.terrain.layers.zone[tileIdx] ?? 0,
          landValue: landValueAtTile(world, tileIdx),
        };
        const e = edgeAtTile(world, tileIdx);
        if (e !== -1) {
          const g = world.roads;
          const capacity = g.edgeCapacity_[e] as number;
          const volume = world.traffic.volumes[e] as number;
          road = {
            roadClass: g.edgeClass[e] as number,
            volume,
            capacity,
            vcPermille: capacity === 0 ? 0 : Math.min(3000, Math.floor((volume * 1000) / capacity)),
            freeFlowCost: edgeCost(g, e),
            congestedCost: world.traffic.congestedCost[e] as number,
          };
        }
        const b = world.buildings.byTile.get(tileIdx);
        if (b !== undefined && world.buildings.alive[b] === 1) {
          const kind = world.buildings.kind[b] as number;
          const spec = specForTableKind(kind);
          const budget =
            spec === null
              ? 1000
              : (world.services.budgetsPermille[
                  // SERVICE_ID_LIST is 1..9 in order — index is id-1.
                  spec.service - 1
                ] as number);
          // Effectiveness v1 = coverage at the building's own tile,
          // permille; the ×capacity-fill factor joins with the service
          // loops (board task 3).
          const effectiveness =
            spec === null
              ? 0
              : Math.floor(
                  ((serviceCoverage(world, spec.service).coverage[tileIdx] as number) * 1000) / 255,
                );
          building = {
            kind,
            level: world.buildings.level[b] as number,
            status: world.buildings.status[b] as number,
            serviceId: spec === null ? 0 : spec.service,
            capacityTotal: spec === null ? 0 : scaledCapacity(spec, budget),
            capacityUsed: 0, // queues join with the service loops (task 3)
            queueLength: 0,
            effectivenessPermille: effectiveness,
          };
        }
      }
      post(
        encodeMessage({
          kind: MessageKind.inspectorResponse,
          body: {
            requestId: message.body.requestId,
            tick: world.tick,
            tile,
            road,
            building,
            environ:
              tile === null
                ? null
                : (() => {
                    const p = pollutionAt(world, tile.tileIdx);
                    return {
                      airPollution: p.air,
                      groundPollution: p.ground,
                      noise: p.noise,
                      waterPollution: p.water,
                    };
                  })(),
          },
        }),
      );
      break;
    }
    case MessageKind.viewportHint:
      // Sampler input ONLY (ADR-002) — by construction it cannot move the
      // hash: the projection-purity test in sim holds that line.
      world.viewport = message.body;
      break;
    case MessageKind.overlayRequest:
      // Worker-held presentation state (viewportHint pattern): selects
      // which coverage layer rides snapshots. Never touches the world —
      // coverage is derived, so the hash cannot see this.
      activeOverlay = message.body.service as typeof activeOverlay;
      lastSentCoverageDigest = -1; // force the next snapshot to carry it
      postSnapshot(SnapshotKind.delta);
      break;
    default:
      throw new Error(`sim worker received unexpected MessageKind ${message.kind}`);
  }
};

setInterval(() => {
  const ticks = world.speed;
  if (ticks === 0) {
    return;
  }
  for (let i = 0; i < ticks; i++) {
    applyBatch([]);
  }
  postSnapshot(SnapshotKind.delta);
}, TICK_MS);

// Boot handshake: the first keyframe both proves protocol agreement
// (decodeMessage version-checks on the main thread) and primes the stage.
postSnapshot(SnapshotKind.keyframe);
