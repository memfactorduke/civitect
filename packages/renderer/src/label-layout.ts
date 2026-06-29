export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface LabelCandidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly priority: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /** Critical labels may overlap others, but still count against the budget. */
  readonly allowOverlap?: boolean;
}

export interface LabelLayoutOptions {
  readonly viewport: ScreenRect;
  readonly zoom: number;
  readonly maxLabels?: number;
  readonly paddingPx?: number;
  readonly viewportMarginPx?: number;
}

export type LabelRejectReason = "invalid" | "zoom" | "offscreen" | "overlap" | "budget";

export interface LabelPlacement {
  readonly id: string;
  readonly rect: ScreenRect;
  readonly priority: number;
  readonly allowOverlap: boolean;
}

export interface LabelRejection {
  readonly id: string;
  readonly reason: LabelRejectReason;
}

export interface LabelLayoutPlan {
  readonly placed: readonly LabelPlacement[];
  readonly rejected: readonly LabelRejection[];
  readonly totalCandidates: number;
  readonly visibleCandidates: number;
}

const DEFAULT_MAX_LABELS = 128;

export function planLabelLayout(
  candidates: readonly LabelCandidate[],
  options: LabelLayoutOptions,
): LabelLayoutPlan {
  assertRect(options.viewport, "viewport");
  assertFinite(options.zoom, "zoom");
  const maxLabels = options.maxLabels ?? DEFAULT_MAX_LABELS;
  const paddingPx = options.paddingPx ?? 4;
  const viewportMarginPx = options.viewportMarginPx ?? 0;
  assertNonNegativeInteger(maxLabels, "maxLabels");
  assertNonNegativeFinite(paddingPx, "paddingPx");
  assertNonNegativeFinite(viewportMarginPx, "viewportMarginPx");

  const rejected: LabelRejection[] = [];
  const visible: LabelPlacement[] = [];
  for (const candidate of candidates) {
    const placement = toPlacement(candidate);
    if (!placement) {
      rejected.push({ id: candidate.id, reason: "invalid" });
      continue;
    }
    if (!passesZoom(candidate, options.zoom)) {
      rejected.push({ id: candidate.id, reason: "zoom" });
      continue;
    }
    if (!rectsIntersect(expandRect(options.viewport, viewportMarginPx), placement.rect)) {
      rejected.push({ id: candidate.id, reason: "offscreen" });
      continue;
    }
    visible.push(placement);
  }

  const placed: LabelPlacement[] = [];
  for (const placement of visible.sort(comparePlacements)) {
    if (placed.length >= maxLabels) {
      rejected.push({ id: placement.id, reason: "budget" });
      continue;
    }
    if (
      !placement.allowOverlap &&
      placed.some(
        (accepted) =>
          !accepted.allowOverlap &&
          rectsIntersect(expandRect(accepted.rect, paddingPx), placement.rect),
      )
    ) {
      rejected.push({ id: placement.id, reason: "overlap" });
      continue;
    }
    placed.push(placement);
  }

  return {
    placed,
    rejected: rejected.sort(compareRejections),
    totalCandidates: candidates.length,
    visibleCandidates: visible.length,
  };
}

export function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function expandRect(rect: ScreenRect, padding: number): ScreenRect {
  return {
    x0: rect.x0 - padding,
    y0: rect.y0 - padding,
    x1: rect.x1 + padding,
    y1: rect.y1 + padding,
  };
}

function toPlacement(candidate: LabelCandidate): LabelPlacement | null {
  if (
    candidate.id.length === 0 ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    !Number.isFinite(candidate.priority) ||
    candidate.width <= 0 ||
    candidate.height <= 0
  ) {
    return null;
  }
  const halfWidth = candidate.width / 2;
  const halfHeight = candidate.height / 2;
  return {
    id: candidate.id,
    rect: {
      x0: candidate.x - halfWidth,
      y0: candidate.y - halfHeight,
      x1: candidate.x + halfWidth,
      y1: candidate.y + halfHeight,
    },
    priority: candidate.priority,
    allowOverlap: candidate.allowOverlap === true,
  };
}

function passesZoom(candidate: LabelCandidate, zoom: number): boolean {
  if (candidate.minZoom !== undefined && zoom < candidate.minZoom) {
    return false;
  }
  if (candidate.maxZoom !== undefined && zoom > candidate.maxZoom) {
    return false;
  }
  return true;
}

function comparePlacements(a: LabelPlacement, b: LabelPlacement): number {
  return (
    b.priority - a.priority ||
    a.rect.y0 - b.rect.y0 ||
    a.rect.x0 - b.rect.x0 ||
    a.id.localeCompare(b.id)
  );
}

function compareRejections(a: LabelRejection, b: LabelRejection): number {
  return a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason);
}

function assertRect(rect: ScreenRect, name: string): void {
  for (const [field, value] of Object.entries(rect)) {
    assertFinite(value, `${name}.${field}`);
  }
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) {
    throw new Error(`${name} must have positive width and height`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite, got ${value}`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new Error(`${name} must be non-negative, got ${value}`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  assertNonNegativeFinite(value, name);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got ${value}`);
  }
}
