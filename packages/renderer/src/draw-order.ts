/**
 * Deterministic draw ordering for isometric stage content.
 *
 * The Pixi stage can keep its imperative containers, but dense-city features need
 * one pure place that answers "what draws above what?" before sprites are moved.
 */

export const DRAW_LAYERS = {
  terrain: 0,
  water: 5,
  zones: 10,
  roads: 20,
  buildings: 30,
  agents: 40,
  effects: 50,
  overlays: 60,
  labels: 70,
} as const;

export type DrawLayerName = keyof typeof DRAW_LAYERS;
export type DrawLayer = DrawLayerName | number;

export interface DrawOrderItem {
  readonly id: string;
  readonly layer: DrawLayer;
  /** Logical isometric tile position. Used for depth when world px are absent. */
  readonly tileX?: number;
  readonly tileY?: number;
  /** World-px anchor. Use this for animated agents between tiles. */
  readonly worldX?: number;
  readonly worldY?: number;
  /** Small local override inside the same layer/depth slot. Higher draws later. */
  readonly z?: number;
  /** Semantic priority inside an exact tie. Higher draws later. */
  readonly priority?: number;
  /** Adjacent entries with the same key can be submitted as one batch. */
  readonly batchKey?: string;
  /** Hidden entries never enter the order plan. */
  readonly hidden?: boolean;
}

export type DrawSortKey = readonly [
  layer: number,
  depthY: number,
  depthX: number,
  z: number,
  priority: number,
  id: string,
];

export interface OrderedDrawItem<T extends DrawOrderItem = DrawOrderItem> {
  readonly item: T;
  readonly drawIndex: number;
  readonly key: DrawSortKey;
  readonly batchKey: string;
}

export interface DrawBatch<T extends DrawOrderItem = DrawOrderItem> {
  readonly batchKey: string;
  /** Inclusive draw index in the ordered list. */
  readonly start: number;
  /** Exclusive draw index in the ordered list. */
  readonly end: number;
  readonly items: readonly OrderedDrawItem<T>[];
}

export function drawLayerRank(layer: DrawLayer): number {
  return typeof layer === "number" ? layer : DRAW_LAYERS[layer];
}

export function drawSortKey(item: DrawOrderItem): DrawSortKey {
  const hasTile = item.tileX !== undefined && item.tileY !== undefined;
  const fallbackDepthY = hasTile ? (item.tileX as number) + (item.tileY as number) : 0;
  const fallbackDepthX = hasTile ? (item.tileX as number) - (item.tileY as number) : 0;

  return [
    drawLayerRank(item.layer),
    item.worldY ?? fallbackDepthY,
    item.worldX ?? fallbackDepthX,
    item.z ?? 0,
    item.priority ?? 0,
    item.id,
  ];
}

export function compareDrawKeys(a: DrawSortKey, b: DrawSortKey): number {
  for (let i = 0; i < a.length - 1; i++) {
    const delta = (a[i] as number) - (b[i] as number);
    if (delta !== 0) {
      return delta;
    }
  }
  if (a[5] < b[5]) {
    return -1;
  }
  if (a[5] > b[5]) {
    return 1;
  }
  return 0;
}

export function planDrawOrder<T extends DrawOrderItem>(
  items: readonly T[],
): readonly OrderedDrawItem<T>[] {
  return items
    .filter((item) => !item.hidden)
    .map((item) => ({
      item,
      drawIndex: -1,
      key: drawSortKey(item),
      batchKey: item.batchKey ?? String(drawLayerRank(item.layer)),
    }))
    .sort((a, b) => compareDrawKeys(a.key, b.key))
    .map((entry, drawIndex) => ({ ...entry, drawIndex }));
}

export function planDrawBatches<T extends DrawOrderItem>(
  ordered: readonly OrderedDrawItem<T>[],
): readonly DrawBatch<T>[] {
  const batches: DrawBatch<T>[] = [];
  for (const entry of ordered) {
    const previous = batches.at(-1);
    if (previous?.batchKey === entry.batchKey) {
      batches[batches.length - 1] = {
        batchKey: previous.batchKey,
        start: previous.start,
        end: entry.drawIndex + 1,
        items: [...previous.items, entry],
      };
      continue;
    }

    batches.push({
      batchKey: entry.batchKey,
      start: entry.drawIndex,
      end: entry.drawIndex + 1,
      items: [entry],
    });
  }
  return batches;
}
