/**
 * Dynamic-layer frame budget planning (ADR-008).
 *
 * The stage can draw many cheap primitives today, but a large city needs
 * deterministic throttles before agent/overlay density grows. This helper is
 * pure and integer-based so tests can pin the policy before it is wired into
 * Pixi drawing.
 */

export const FrameLod = {
  far: "far",
  mid: "mid",
  near: "near",
} as const;
export type FrameLod = (typeof FrameLod)[keyof typeof FrameLod];

export interface DynamicLayerLoad {
  readonly zoom: number;
  readonly agentCount: number;
  readonly roadSegmentCount: number;
  readonly buildingCount: number;
  /** 60 Hz = 16.67 ms. 120 Hz = 8.33 ms. */
  readonly targetFrameMs?: number;
}

export interface FrameBudgetPlan {
  readonly lod: FrameLod;
  readonly agentSpriteBudget: number;
  readonly agentStride: number;
  readonly drawPedestrians: boolean;
  readonly trafficSegmentBudget: number;
  readonly trafficSegmentStride: number;
  readonly buildingLabelBudget: number;
  readonly buildingLabelStride: number;
}

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function safePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function frameScale(targetFrameMs: number): number {
  if (targetFrameMs <= 8.5) {
    return 0.55;
  }
  if (targetFrameMs <= 12) {
    return 0.75;
  }
  if (targetFrameMs >= 24) {
    return 1.35;
  }
  return 1;
}

function strideFor(total: number, budget: number): number {
  if (total <= 0 || budget <= 0 || total <= budget) {
    return 1;
  }
  return Math.ceil(total / budget);
}

export function frameLodForZoom(zoom: number): FrameLod {
  if (zoom >= 1.25) {
    return FrameLod.near;
  }
  if (zoom >= 0.5) {
    return FrameLod.mid;
  }
  return FrameLod.far;
}

export function planFrameBudget(load: DynamicLayerLoad): FrameBudgetPlan {
  const lod = frameLodForZoom(load.zoom);
  const scale = frameScale(safePositive(load.targetFrameMs, 1000 / 60));
  const agentCount = safeCount(load.agentCount);
  const roadSegmentCount = safeCount(load.roadSegmentCount);
  const buildingCount = safeCount(load.buildingCount);

  const agentBase = lod === FrameLod.near ? 2400 : lod === FrameLod.mid ? 900 : 180;
  const trafficBase = lod === FrameLod.near ? 2200 : lod === FrameLod.mid ? 1100 : 420;
  const labelBase = lod === FrameLod.near ? 480 : lod === FrameLod.mid ? 90 : 0;

  const agentSpriteBudget = Math.max(1, Math.floor(agentBase * scale));
  const trafficSegmentBudget = Math.max(1, Math.floor(trafficBase * scale));
  const buildingLabelBudget = Math.floor(labelBase * scale);
  const agentStride = strideFor(agentCount, agentSpriteBudget);

  return {
    lod,
    agentSpriteBudget,
    agentStride,
    drawPedestrians: lod !== FrameLod.far && agentStride <= 4,
    trafficSegmentBudget,
    trafficSegmentStride: strideFor(roadSegmentCount, trafficSegmentBudget),
    buildingLabelBudget,
    buildingLabelStride: strideFor(buildingCount, buildingLabelBudget),
  };
}
