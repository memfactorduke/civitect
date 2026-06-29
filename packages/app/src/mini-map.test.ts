// @vitest-environment jsdom
import type { CameraState, DisplayState } from "@civitect/renderer";
import { describe, expect, it } from "vitest";
import { createMiniMap, createMiniMapProjection, type MiniMapRenderer } from "./mini-map";

function initialDisplayState(): DisplayState {
  return {
    tick: -1,
    speed: 1,
    highlight: null,
    hud: { population: 0, fundsCents: 0 },
    roadVersion: -1,
    roads: [],
    buildingVersion: -1,
    buildings: [],
    zoneVersion: -1,
    zones: null,
    agentCount: 0,
    congestionVersion: -1,
    congestion: null,
    coverageService: 0,
    coverageVersion: -1,
    coverage: null,
  };
}

function setRect(element: Element, rect: Partial<DOMRectReadOnly>): void {
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: rect.width ?? 0,
      bottom: rect.height ?? 0,
      x: 0,
      y: 0,
      width: rect.width ?? 0,
      height: rect.height ?? 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function renderer(state: DisplayState): MiniMapRenderer {
  const canvas = document.createElement("div");
  setRect(canvas, { width: 800, height: 600 });
  const camera: CameraState = {
    x: 0,
    y: 0,
    zoom: 1,
    renderedX: 0,
    renderedY: 0,
    renderedZoom: 1,
  };
  return {
    app: { canvas },
    camera,
    state: () => state,
    panBy(dxPx, dyPx): void {
      camera.x -= dxPx / camera.zoom;
      camera.y -= dyPx / camera.zoom;
    },
    screenToWorld(sx, sy) {
      return { wx: sx, wy: sy };
    },
  };
}

describe("mini-map overview", () => {
  it("round-trips world coordinates through the mini-map projection", () => {
    const projection = createMiniMapProjection({ mapWidth: 64, mapHeight: 64 });
    const world = { wx: 256, wy: 512 };
    const mini = projection.projectWorld(world);
    const roundTrip = projection.unprojectWorld(mini);

    expect(roundTrip.wx).toBeCloseTo(world.wx, 5);
    expect(roundTrip.wy).toBeCloseTo(world.wy, 5);
  });

  it("renders the map outline, roads, buildings, viewport, and camera center", () => {
    const state: DisplayState = {
      ...initialDisplayState(),
      tick: 7,
      roads: [{ ax: 1, ay: 2, bx: 5, by: 2, roadClass: 1 }],
      buildings: [{ x: 3, y: 4, kind: 1, level: 1, status: 0 }],
    };
    const host = document.createElement("div");

    createMiniMap(host, renderer(state), { mapWidth: 64, mapHeight: 64 });

    const svg = host.querySelector<SVGSVGElement>('[data-testid="mini-map"]');
    expect(svg?.dataset.tick).toBe("7");
    expect(svg?.dataset.roadCount).toBe("1");
    expect(svg?.dataset.buildingCount).toBe("1");
    expect(
      host.querySelector('[data-testid="mini-map-outline"]')?.getAttribute("points"),
    ).toContain(",");
    expect(host.querySelector('[data-testid="mini-map-roads"]')?.getAttribute("d")).toContain("L");
    expect(host.querySelector('[data-testid="mini-map-buildings"]')?.getAttribute("d")).toContain(
      "h2.4",
    );
    expect(
      host.querySelector('[data-testid="mini-map-viewport"]')?.getAttribute("points"),
    ).toContain(",");
    expect(
      host.querySelector('[data-testid="mini-map-center"]')?.getAttribute("cx"),
    ).not.toBeNull();
  });

  it("clicks pan the renderer camera to the picked world point", () => {
    const host = document.createElement("div");
    const fakeRenderer = renderer(initialDisplayState());
    const projection = createMiniMapProjection({ mapWidth: 64, mapHeight: 64 });
    createMiniMap(host, fakeRenderer, { mapWidth: 64, mapHeight: 64 });
    const svg = host.querySelector<SVGSVGElement>('[data-testid="mini-map"]');
    if (svg === null) {
      throw new Error("mini-map svg missing");
    }
    setRect(svg, { width: projection.width, height: projection.height });
    const target = projection.projectWorld({ wx: 300, wy: 700 });

    svg.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: target.x,
        clientY: target.y,
      }),
    );

    expect(fakeRenderer.camera.x).toBeCloseTo(300, 5);
    expect(fakeRenderer.camera.y).toBeCloseTo(700, 5);
  });

  it("supports keyboard camera nudging for focused mini-map users", () => {
    const host = document.createElement("div");
    const fakeRenderer = renderer(initialDisplayState());
    createMiniMap(host, fakeRenderer, { mapWidth: 64, mapHeight: 64 });
    const svg = host.querySelector<SVGSVGElement>('[data-testid="mini-map"]');
    if (svg === null) {
      throw new Error("mini-map svg missing");
    }

    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(fakeRenderer.camera.x).toBeGreaterThan(0);
    expect(fakeRenderer.camera.y).toBeGreaterThan(0);
  });
});
