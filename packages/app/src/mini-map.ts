import type { CameraState, DisplayState } from "@civitect/renderer";

const SVG_NS = "http://www.w3.org/2000/svg";
const TILE_W = 64;
const TILE_H = 32;
const DEFAULT_WIDTH = 184;
const DEFAULT_HEIGHT = 132;
const DEFAULT_PADDING = 10;
const MAX_MINIMAP_ROADS = 800;
const MAX_MINIMAP_BUILDINGS = 500;

interface MiniPoint {
  readonly x: number;
  readonly y: number;
}

interface WorldPoint {
  readonly wx: number;
  readonly wy: number;
}

interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function tileToWorld(x: number, y: number): WorldPoint {
  return {
    wx: ((x - y) * TILE_W) / 2,
    wy: ((x + y) * TILE_H) / 2,
  };
}

function tileCenterToWorld(x: number, y: number): WorldPoint {
  const top = tileToWorld(x, y);
  return { wx: top.wx, wy: top.wy + TILE_H / 2 };
}

export interface MiniMapOptions {
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
}

export interface MiniMapRenderer {
  readonly app: { readonly canvas: HTMLElement };
  readonly camera: CameraState;
  state(): DisplayState;
  panBy(dxPx: number, dyPx: number): void;
  screenToWorld(sx: number, sy: number): WorldPoint;
}

export interface MiniMapControl {
  refresh(): void;
  start(): void;
  centerOnWorld(wx: number, wy: number): void;
  destroy(): void;
}

export interface MiniMapProjection {
  readonly width: number;
  readonly height: number;
  readonly bounds: WorldBounds;
  projectWorld(point: WorldPoint): MiniPoint;
  unprojectWorld(point: MiniPoint): WorldPoint;
}

export function createMiniMapProjection(options: MiniMapOptions): MiniMapProjection {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const padding = options.padding ?? DEFAULT_PADDING;
  const bounds = {
    minX: (-options.mapHeight * TILE_W) / 2,
    minY: 0,
    maxX: (options.mapWidth * TILE_W) / 2,
    maxY: ((options.mapWidth + options.mapHeight) * TILE_H) / 2,
  };
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;
  const scale = Math.min(
    (width - padding * 2) / boundsWidth,
    (height - padding * 2) / boundsHeight,
  );
  const offsetX = (width - boundsWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (height - boundsHeight * scale) / 2 - bounds.minY * scale;

  return {
    width,
    height,
    bounds,
    projectWorld(point: WorldPoint): MiniPoint {
      return {
        x: point.wx * scale + offsetX,
        y: point.wy * scale + offsetY,
      };
    },
    unprojectWorld(point: MiniPoint): WorldPoint {
      return {
        wx: (point.x - offsetX) / scale,
        wy: (point.y - offsetY) / scale,
      };
    },
  };
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function points(points: readonly MiniPoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function stepped<T>(items: readonly T[], max: number): readonly T[] {
  if (items.length <= max) {
    return items;
  }
  const step = Math.ceil(items.length / max);
  return items.filter((_, index) => index % step === 0);
}

function roadPath(state: DisplayState, projection: MiniMapProjection): string {
  return stepped(state.roads, MAX_MINIMAP_ROADS)
    .map((road) => {
      const a = projection.projectWorld(tileCenterToWorld(road.ax, road.ay));
      const b = projection.projectWorld(tileCenterToWorld(road.bx, road.by));
      return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    })
    .join("");
}

function buildingPath(state: DisplayState, projection: MiniMapProjection): string {
  return stepped(state.buildings, MAX_MINIMAP_BUILDINGS)
    .map((building) => {
      const p = projection.projectWorld(tileCenterToWorld(building.x, building.y));
      return `M${(p.x - 1.2).toFixed(1)} ${(p.y - 1.2).toFixed(1)}h2.4v2.4h-2.4z`;
    })
    .join("");
}

function viewportPoints(renderer: MiniMapRenderer, projection: MiniMapProjection): string {
  const rect = renderer.app.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return "";
  }
  return points([
    projection.projectWorld(renderer.screenToWorld(0, 0)),
    projection.projectWorld(renderer.screenToWorld(rect.width, 0)),
    projection.projectWorld(renderer.screenToWorld(rect.width, rect.height)),
    projection.projectWorld(renderer.screenToWorld(0, rect.height)),
  ]);
}

function clientPointToSvg(
  svg: SVGSVGElement,
  event: Pick<PointerEvent, "clientX" | "clientY">,
): MiniPoint {
  const rect = svg.getBoundingClientRect();
  const width = rect.width || Number(svg.getAttribute("width"));
  const height = rect.height || Number(svg.getAttribute("height"));
  return {
    x: ((event.clientX - rect.left) / width) * Number(svg.getAttribute("width")),
    y: ((event.clientY - rect.top) / height) * Number(svg.getAttribute("height")),
  };
}

export function createMiniMap(
  host: HTMLElement,
  renderer: MiniMapRenderer,
  options: MiniMapOptions,
): MiniMapControl {
  const projection = createMiniMapProjection(options);
  let frame = 0;

  host.replaceChildren();
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "City overview map");

  const svg = svgEl("svg");
  svg.dataset.testid = "mini-map";
  svg.setAttribute("width", `${projection.width}`);
  svg.setAttribute("height", `${projection.height}`);
  svg.setAttribute("viewBox", `0 0 ${projection.width} ${projection.height}`);
  svg.setAttribute("focusable", "true");
  svg.tabIndex = 0;

  const outline = svgEl("polygon");
  outline.dataset.testid = "mini-map-outline";
  outline.setAttribute(
    "points",
    points([
      projection.projectWorld(tileToWorld(0, 0)),
      projection.projectWorld(tileToWorld(options.mapWidth, 0)),
      projection.projectWorld(tileToWorld(options.mapWidth, options.mapHeight)),
      projection.projectWorld(tileToWorld(0, options.mapHeight)),
    ]),
  );

  const roads = svgEl("path");
  roads.dataset.testid = "mini-map-roads";

  const buildings = svgEl("path");
  buildings.dataset.testid = "mini-map-buildings";

  const viewport = svgEl("polygon");
  viewport.dataset.testid = "mini-map-viewport";

  const center = svgEl("circle");
  center.dataset.testid = "mini-map-center";
  center.setAttribute("r", "2.8");

  svg.append(outline, roads, buildings, viewport, center);
  host.append(svg);

  const centerOnWorld = (wx: number, wy: number): void => {
    const { camera } = renderer;
    renderer.panBy((camera.x - wx) * camera.zoom, (camera.y - wy) * camera.zoom);
  };

  const refresh = (): void => {
    const state = renderer.state();
    roads.setAttribute("d", roadPath(state, projection));
    buildings.setAttribute("d", buildingPath(state, projection));
    viewport.setAttribute("points", viewportPoints(renderer, projection));
    const c = projection.projectWorld({ wx: renderer.camera.x, wy: renderer.camera.y });
    center.setAttribute("cx", c.x.toFixed(1));
    center.setAttribute("cy", c.y.toFixed(1));
    svg.dataset.tick = `${state.tick}`;
    svg.dataset.roadCount = `${state.roads.length}`;
    svg.dataset.buildingCount = `${state.buildings.length}`;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const p = projection.unprojectWorld(clientPointToSvg(svg, event));
    centerOnWorld(p.wx, p.wy);
    refresh();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const spanX = projection.bounds.maxX - projection.bounds.minX;
    const spanY = projection.bounds.maxY - projection.bounds.minY;
    const stepX = spanX * 0.08;
    const stepY = spanY * 0.08;
    let wx = renderer.camera.x;
    let wy = renderer.camera.y;
    if (event.key === "ArrowLeft") {
      wx -= stepX;
    } else if (event.key === "ArrowRight") {
      wx += stepX;
    } else if (event.key === "ArrowUp") {
      wy -= stepY;
    } else if (event.key === "ArrowDown") {
      wy += stepY;
    } else if (event.key === "Home") {
      wx = (projection.bounds.minX + projection.bounds.maxX) / 2;
      wy = (projection.bounds.minY + projection.bounds.maxY) / 2;
    } else {
      return;
    }
    event.preventDefault();
    centerOnWorld(wx, wy);
    refresh();
  };

  const loop = (): void => {
    refresh();
    frame = globalThis.requestAnimationFrame(loop);
  };

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("keydown", onKeyDown);
  refresh();

  return {
    refresh,
    start(): void {
      if (frame === 0) {
        frame = globalThis.requestAnimationFrame(loop);
      }
    },
    centerOnWorld,
    destroy(): void {
      if (frame !== 0) {
        globalThis.cancelAnimationFrame(frame);
        frame = 0;
      }
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("keydown", onKeyDown);
      host.replaceChildren();
    },
  };
}
