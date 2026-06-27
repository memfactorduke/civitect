// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createToolPalette, type ToolMode } from "./tool-palette";

describe("tool palette", () => {
  it("renders the active app tool as a pressed toolbar button", () => {
    const host = document.createElement("div");
    createToolPalette(host, { initialTool: "select", onSelect: () => {} });

    expect(host.getAttribute("role")).toBe("toolbar");
    expect(host.getAttribute("aria-label")).toBe("Tools");
    expect(host.querySelector('[data-tool="select"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-tool="road"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("notifies the app shell when a visible tool button is selected", () => {
    const host = document.createElement("div");
    const selected: ToolMode[] = [];
    const palette = createToolPalette(host, {
      initialTool: "select",
      onSelect: (tool) => selected.push(tool),
    });

    const road = host.querySelector<HTMLButtonElement>('[data-tool="road"]');
    road?.click();

    expect(selected).toEqual(["road"]);
    expect(palette.current()).toBe("road");
    expect(road?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-tool="select"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("lets keyboard shortcuts update visible state without re-dispatching", () => {
    const host = document.createElement("div");
    const selected: ToolMode[] = [];
    const palette = createToolPalette(host, {
      initialTool: "select",
      onSelect: (tool) => selected.push(tool),
    });

    palette.setTool("bulldoze");

    expect(selected).toEqual([]);
    expect(palette.current()).toBe("bulldoze");
    expect(host.querySelector('[data-tool="bulldoze"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});
