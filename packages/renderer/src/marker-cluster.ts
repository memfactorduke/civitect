export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface MarkerCandidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly priority: number;
  readonly weight?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly clusterable?: boolean;
}

export interface MarkerClusterOptions {
  readonly viewport: ScreenRect;
  readonly zoom: number;
  readonly cellSizePx?: number;
  readonly maxItems?: number;
  readonly minClusterSize?: number;
  readonly viewportMarginPx?: number;
}

export type MarkerRejectReason = "invalid" | "duplicate" | "zoom" | "offscreen" | "budget";

export interface MarkerItem {
  readonly kind: "marker";
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly priority: number;
  readonly weight: number;
}

interface PlannedMarker extends MarkerItem {
  readonly clusterable: boolean;
}

export interface ClusterItem {
  readonly kind: "cluster";
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly priority: number;
  readonly weight: number;
  readonly count: number;
  readonly markerIds: readonly string[];
  readonly bounds: ScreenRect;
}

export type MarkerClusterItem = MarkerItem | ClusterItem;

export interface MarkerRejection {
  readonly id: string;
  readonly reason: MarkerRejectReason;
}

export interface MarkerClusterPlan {
  readonly items: readonly MarkerClusterItem[];
  readonly rejected: readonly MarkerRejection[];
  readonly totalCandidates: number;
  readonly visibleCandidates: number;
  readonly clusteredMarkerCount: number;
}

const DEFAULT_CELL_SIZE_PX = 48;
const DEFAULT_MAX_ITEMS = 128;
const DEFAULT_MIN_CLUSTER_SIZE = 2;

export function planMarkerClusters(
  candidates: readonly MarkerCandidate[],
  options: MarkerClusterOptions,
): MarkerClusterPlan {
  assertRect(options.viewport, "viewport");
  assertFinite(options.zoom, "zoom");
  const cellSizePx = options.cellSizePx ?? DEFAULT_CELL_SIZE_PX;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const minClusterSize = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const viewportMarginPx = options.viewportMarginPx ?? 0;
  assertPositiveFinite(cellSizePx, "cellSizePx");
  assertNonNegativeInteger(maxItems, "maxItems");
  assertMinClusterSize(minClusterSize);
  assertNonNegativeFinite(viewportMarginPx, "viewportMarginPx");

  const rejected: MarkerRejection[] = [];
  const visible: PlannedMarker[] = [];
  const seenIds = new Set<string>();

  for (const candidate of candidates) {
    const marker = toMarker(candidate);
    if (!marker) {
      rejected.push({ id: candidate.id, reason: "invalid" });
      continue;
    }
    if (seenIds.has(marker.id)) {
      rejected.push({ id: marker.id, reason: "duplicate" });
      continue;
    }
    seenIds.add(marker.id);
    if (!passesZoom(candidate, options.zoom)) {
      rejected.push({ id: marker.id, reason: "zoom" });
      continue;
    }
    if (!pointInRect(marker, expandRect(options.viewport, viewportMarginPx))) {
      rejected.push({ id: marker.id, reason: "offscreen" });
      continue;
    }
    visible.push(marker);
  }

  const planned = groupVisibleMarkers(visible, cellSizePx, minClusterSize).sort(compareItems);
  const items: MarkerClusterItem[] = [];
  for (const item of planned) {
    if (items.length >= maxItems) {
      for (const id of itemMarkerIds(item)) {
        rejected.push({ id, reason: "budget" });
      }
      continue;
    }
    items.push(item);
  }

  return {
    items,
    rejected: rejected.sort(compareRejections),
    totalCandidates: candidates.length,
    visibleCandidates: visible.length,
    clusteredMarkerCount: items.reduce(
      (total, item) => total + (item.kind === "cluster" ? item.count : 0),
      0,
    ),
  };
}

function groupVisibleMarkers(
  markers: readonly PlannedMarker[],
  cellSizePx: number,
  minClusterSize: number,
): MarkerClusterItem[] {
  const singles: MarkerItem[] = [];
  const groups = new Map<string, PlannedMarker[]>();

  for (const marker of markers) {
    if (!isClusterable(marker)) {
      singles.push(toPublicMarker(marker));
      continue;
    }
    const key = markerCellKey(marker, cellSizePx);
    const group = groups.get(key);
    if (group) {
      group.push(marker);
    } else {
      groups.set(key, [marker]);
    }
  }

  const items: MarkerClusterItem[] = [...singles];
  for (const [key, group] of groups.entries()) {
    const members = [...group].sort(compareMarkers);
    if (members.length < minClusterSize) {
      items.push(...members.map(toPublicMarker));
    } else {
      items.push(toCluster(key, members));
    }
  }
  return items;
}

function toMarker(candidate: MarkerCandidate): PlannedMarker | null {
  const weight = candidate.weight ?? 1;
  if (
    candidate.id.length === 0 ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.priority) ||
    !Number.isFinite(weight) ||
    weight <= 0
  ) {
    return null;
  }
  return {
    kind: "marker",
    id: candidate.id,
    x: candidate.x,
    y: candidate.y,
    priority: candidate.priority,
    weight,
    clusterable: candidate.clusterable !== false && candidate.id.startsWith("selected:") === false,
  };
}

function toPublicMarker(marker: PlannedMarker): MarkerItem {
  return {
    kind: "marker",
    id: marker.id,
    x: marker.x,
    y: marker.y,
    priority: marker.priority,
    weight: marker.weight,
  };
}

function toCluster(cellKey: string, members: readonly PlannedMarker[]): ClusterItem {
  const weight = members.reduce((total, marker) => total + marker.weight, 0);
  const priority = members.reduce(
    (highest, marker) => Math.max(highest, marker.priority),
    -Infinity,
  );
  const x = members.reduce((total, marker) => total + marker.x * marker.weight, 0) / weight;
  const y = members.reduce((total, marker) => total + marker.y * marker.weight, 0) / weight;
  const markerIds = members.map((marker) => marker.id).sort();
  return {
    kind: "cluster",
    id: `cluster:${cellKey}:${markerIds[0]}`,
    x,
    y,
    priority,
    weight,
    count: members.length,
    markerIds,
    bounds: members.reduce(
      (bounds, marker) => ({
        x0: Math.min(bounds.x0, marker.x),
        y0: Math.min(bounds.y0, marker.y),
        x1: Math.max(bounds.x1, marker.x),
        y1: Math.max(bounds.y1, marker.y),
      }),
      { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    ),
  };
}

function itemMarkerIds(item: MarkerClusterItem): readonly string[] {
  return item.kind === "cluster" ? item.markerIds : [item.id];
}

function markerCellKey(marker: PlannedMarker, cellSizePx: number): string {
  return `${Math.floor(marker.x / cellSizePx)}:${Math.floor(marker.y / cellSizePx)}`;
}

function isClusterable(marker: PlannedMarker): boolean {
  return marker.clusterable;
}

function passesZoom(candidate: MarkerCandidate, zoom: number): boolean {
  if (candidate.minZoom !== undefined && zoom < candidate.minZoom) {
    return false;
  }
  if (candidate.maxZoom !== undefined && zoom > candidate.maxZoom) {
    return false;
  }
  return true;
}

function pointInRect(marker: MarkerItem, rect: ScreenRect): boolean {
  return marker.x >= rect.x0 && marker.x <= rect.x1 && marker.y >= rect.y0 && marker.y <= rect.y1;
}

function expandRect(rect: ScreenRect, padding: number): ScreenRect {
  return {
    x0: rect.x0 - padding,
    y0: rect.y0 - padding,
    x1: rect.x1 + padding,
    y1: rect.y1 + padding,
  };
}

function compareItems(a: MarkerClusterItem, b: MarkerClusterItem): number {
  return b.priority - a.priority || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

function compareMarkers(a: PlannedMarker, b: PlannedMarker): number {
  return b.priority - a.priority || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

function compareRejections(a: MarkerRejection, b: MarkerRejection): number {
  return a.id.localeCompare(b.id) || rejectReasonRank(a.reason) - rejectReasonRank(b.reason);
}

function rejectReasonRank(reason: MarkerRejectReason): number {
  switch (reason) {
    case "invalid":
      return 0;
    case "duplicate":
      return 1;
    case "zoom":
      return 2;
    case "offscreen":
      return 3;
    case "budget":
      return 4;
  }
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

function assertPositiveFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new Error(`${name} must be positive, got ${value}`);
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

function assertMinClusterSize(value: number): void {
  assertNonNegativeInteger(value, "minClusterSize");
  if (value < 2) {
    throw new Error(`minClusterSize must be at least 2, got ${value}`);
  }
}
