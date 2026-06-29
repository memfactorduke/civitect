import type { WorldPoint } from "./iso";

export interface AgentTrailSample {
  readonly agentId: string;
  readonly tick: number;
  readonly wx: number;
  readonly wy: number;
  readonly mode?: string;
}

export interface AgentTrailPlanOptions {
  readonly nowTick: number;
  readonly maxAgeTicks: number;
  readonly maxSegmentsPerAgent: number;
  readonly minSegmentLengthPx?: number;
  readonly minAlpha?: number;
  readonly maxAlpha?: number;
  readonly widthPx?: number;
}

export interface AgentTrailSegment {
  readonly agentId: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly startTick: number;
  readonly endTick: number;
  readonly ageTicks: number;
  readonly alpha: number;
  readonly widthPx: number;
  readonly mode?: string;
  readonly drawOrder: number;
}

interface NormalizedTrailSample extends AgentTrailSample {
  readonly mode: string;
}

const DEFAULT_MIN_ALPHA = 0.18;
const DEFAULT_MAX_ALPHA = 0.82;
const DEFAULT_WIDTH_PX = 2;

export function planAgentTrails(
  samples: readonly AgentTrailSample[],
  options: AgentTrailPlanOptions,
): AgentTrailSegment[] {
  const nowTick = Math.floor(options.nowTick);
  if (!Number.isFinite(nowTick)) {
    return [];
  }

  const maxAgeTicks = nonNegativeInteger(options.maxAgeTicks);
  const maxSegmentsPerAgent = nonNegativeInteger(options.maxSegmentsPerAgent);
  if (maxSegmentsPerAgent === 0) {
    return [];
  }

  const minSegmentLengthPx = nonNegativeNumber(options.minSegmentLengthPx ?? 0);
  const minSegmentLengthSq = minSegmentLengthPx * minSegmentLengthPx;
  const minAlpha = clamp01(options.minAlpha ?? DEFAULT_MIN_ALPHA);
  const maxAlpha = Math.max(minAlpha, clamp01(options.maxAlpha ?? DEFAULT_MAX_ALPHA));
  const widthPx = nonNegativeNumber(options.widthPx ?? DEFAULT_WIDTH_PX);
  const normalized = normalizeSamples(samples, nowTick);
  const segments: AgentTrailSegment[] = [];
  let drawOrder = 0;

  for (const agentId of [...normalized.keys()].sort(compareText)) {
    const agentSamples = normalized.get(agentId);
    if (!agentSamples) {
      continue;
    }

    const agentSegments: Omit<AgentTrailSegment, "drawOrder">[] = [];
    for (let index = 1; index < agentSamples.length; index++) {
      const previous = agentSamples[index - 1];
      const current = agentSamples[index];
      if (!previous || !current) {
        continue;
      }

      const ageTicks = nowTick - current.tick;
      if (ageTicks > maxAgeTicks) {
        continue;
      }

      const dx = current.wx - previous.wx;
      const dy = current.wy - previous.wy;
      if (dx * dx + dy * dy <= minSegmentLengthSq) {
        continue;
      }

      const freshness = maxAgeTicks === 0 ? 1 : clamp01(1 - ageTicks / maxAgeTicks);
      agentSegments.push({
        agentId,
        from: { wx: previous.wx, wy: previous.wy },
        to: { wx: current.wx, wy: current.wy },
        startTick: previous.tick,
        endTick: current.tick,
        ageTicks,
        alpha: round3(minAlpha + (maxAlpha - minAlpha) * freshness),
        widthPx: round3(widthPx * (0.75 + 0.25 * freshness)),
        mode: current.mode || undefined,
      });
    }

    for (const segment of agentSegments.slice(-maxSegmentsPerAgent)) {
      segments.push({ ...segment, drawOrder });
      drawOrder += 1;
    }
  }

  return segments;
}

function normalizeSamples(
  samples: readonly AgentTrailSample[],
  nowTick: number,
): Map<string, NormalizedTrailSample[]> {
  const normalized = samples
    .filter(isUsableSample)
    .map((sample) => ({
      agentId: sample.agentId,
      tick: Math.floor(sample.tick),
      wx: sample.wx,
      wy: sample.wy,
      mode: sample.mode ?? "",
    }))
    .filter((sample) => sample.tick <= nowTick)
    .sort(compareSamples);

  const byAgent = new Map<string, NormalizedTrailSample[]>();
  for (const sample of normalized) {
    const agentSamples = byAgent.get(sample.agentId) ?? [];
    const previous = agentSamples.at(-1);
    if (previous?.tick === sample.tick) {
      agentSamples[agentSamples.length - 1] = sample;
    } else {
      agentSamples.push(sample);
    }
    byAgent.set(sample.agentId, agentSamples);
  }
  return byAgent;
}

function isUsableSample(sample: AgentTrailSample): boolean {
  return (
    sample.agentId.length > 0 &&
    Number.isFinite(sample.tick) &&
    Number.isFinite(sample.wx) &&
    Number.isFinite(sample.wy)
  );
}

function compareSamples(a: NormalizedTrailSample, b: NormalizedTrailSample): number {
  return (
    compareText(a.agentId, b.agentId) ||
    a.tick - b.tick ||
    a.wx - b.wx ||
    a.wy - b.wy ||
    compareText(a.mode, b.mode)
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function nonNegativeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
