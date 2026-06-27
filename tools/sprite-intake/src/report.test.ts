import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMasterPalette, type Rgb } from "./palette";
import { encodePng, type RawImage } from "./png";
import { auditSpriteSidecars } from "./report";

function blankImage(width: number, height: number): RawImage & { pixels: Uint8Array } {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}

function paintBlob(image: RawImage & { pixels: Uint8Array }, color: Rgb): void {
  const cx = image.width / 2;
  const cy = image.height * 0.65;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (Math.abs(x - cx) / (image.width / 3) + Math.abs(y - cy) / (image.height / 4) <= 1) {
        const i = (y * image.width + x) * 4;
        image.pixels[i] = color.r;
        image.pixels[i + 1] = color.g;
        image.pixels[i + 2] = color.b;
        image.pixels[i + 3] = 255;
      }
    }
  }
}

async function writePng(path: string, width: number, height: number, color: Rgb): Promise<void> {
  const image = blankImage(width, height);
  paintBlob(image, color);
  writeFileSync(path, await encodePng(image));
}

describe("sprite-intake exploration report", () => {
  it("projects road sidecars while blocking unresolved icons and props", async () => {
    const palette = loadMasterPalette();
    const color = palette[20];
    if (color === undefined) {
      throw new Error("test palette missing index 20");
    }

    const dir = mkdtempSync(join(tmpdir(), "sprite-report-"));
    const roads = join(dir, "roads");
    const icons = join(dir, "icons");
    const props = join(dir, "props");
    mkdirSync(roads);
    mkdirSync(icons);
    mkdirSync(props);

    writeFileSync(join(dir, "final-picks.json"), JSON.stringify({ picks: [] }));

    writeFileSync(
      join(roads, "road-avenue-straight-ne-sw.json"),
      JSON.stringify({
        id: "road-avenue-straight-ne-sw",
        category: "roads/avenue",
        sourceScale: 3,
        footprint: { w: 2, d: 2, unit: "tile" },
        tileMetricPxAt3x: { w: 192, h: 96 },
        canvas: { w: 384, h: 192 },
        anchor: { x: 192, y: 192, rule: "center-bottom of footprint" },
        states: { normal: "road-avenue-straight-ne-sw.png" },
      }),
    );
    await writePng(join(roads, "road-avenue-straight-ne-sw.png"), 384, 192, color);

    writeFileSync(
      join(icons, "icon-tool-roads.json"),
      JSON.stringify({
        id: "icon-tool-roads",
        category: "icons/overlay-tool",
        sourceScale: 3,
        footprint: { w: 0, d: 0, unit: "ui" },
        tileMetricPxAt3x: { w: 192, h: 96 },
        canvas: { w: 144, h: 144 },
        anchor: { x: 72, y: 72, rule: "center" },
        states: { normal: "icon-tool-roads.png" },
      }),
    );
    await writePng(join(icons, "icon-tool-roads.png"), 144, 144, color);

    writeFileSync(
      join(props, "prop-bench.json"),
      JSON.stringify({
        id: "prop-bench",
        category: "props",
        sourceScale: 3,
        footprint: { w: 1, d: 1, unit: "tile" },
        tileMetricPxAt3x: { w: 192, h: 96 },
        canvas: { w: 192, h: 192 },
        anchor: { x: 96, y: 192, rule: "center-bottom of footprint" },
        states: { normal: "prop-bench.png" },
      }),
    );
    await writePng(join(props, "prop-bench.png"), 192, 192, color);

    const summary = await auditSpriteSidecars([dir], palette);

    expect(summary.jsonFiles).toBe(4);
    expect(summary.skippedJsonFiles).toBe(1);
    expect(summary.counts["normalized-pass"]).toBe(1);
    expect(summary.counts.blocked).toBe(2);

    const road = summary.sidecars.find((sidecar) => sidecar.id === "road-avenue-straight-ne-sw");
    expect(road?.status).toBe("normalized-pass");
    expect(road?.projectedCategory).toBe("terrain-roads");

    const icon = summary.sidecars.find((sidecar) => sidecar.id === "icon-tool-roads");
    expect(icon?.status).toBe("blocked");
    expect(icon?.issues.some((issue) => /tile footprints only/.test(issue.message))).toBe(true);

    const prop = summary.sidecars.find((sidecar) => sidecar.id === "prop-bench");
    expect(prop?.status).toBe("blocked");
    expect(prop?.issues.some((issue) => /no runtime SpriteCategory/.test(issue.message))).toBe(
      true,
    );
  });
});
