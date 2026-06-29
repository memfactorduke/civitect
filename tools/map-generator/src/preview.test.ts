import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMap, flatTerrain } from "@civitect/protocol";
import { decodePng } from "@civitect/sprite-intake";
import { describe, expect, it } from "vitest";
import { MAP_ARCHETYPES } from "./generate";
import { renderPreview } from "./preview";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = (name: string): string => join(ROOT, "maps", `${name}.civmap`);
const previewPath = (name: string): string => join(ROOT, "previews", `${name}.png`);

function rgbAt(pixels: Uint8Array, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  return (
    ((pixels[i] as number) << 16) | ((pixels[i + 1] as number) << 8) | (pixels[i + 2] as number)
  );
}

describe("map catalog previews", () => {
  it("renders water, resource, and elevation colors with stable precedence", async () => {
    const terrain = flatTerrain(2, 2);
    terrain.layers.water[0] = 1;
    terrain.layers.resource[1] = 1;
    terrain.layers.elevation[2] = 0;
    terrain.layers.elevation[3] = 6;

    const preview = await decodePng(await renderPreview(terrain), "synthetic-preview.png");

    expect(preview.width).toBe(2);
    expect(preview.height).toBe(2);
    expect(rgbAt(preview.pixels, preview.width, 0, 0)).toBe(0x2b4a66);
    expect(rgbAt(preview.pixels, preview.width, 1, 0)).toBe(0x8a6f3c);
    expect(rgbAt(preview.pixels, preview.width, 0, 1)).toBe(0x2e4639);
    expect(rgbAt(preview.pixels, preview.width, 1, 1)).toBe(0x9cab72);
    for (let i = 3; i < preview.pixels.length; i += 4) {
      expect(preview.pixels[i]).toBe(255);
    }
  });

  it.each(
    MAP_ARCHETYPES.map((a) => [a] as const),
  )("committed %s preview matches its committed map content", async (archetype) => {
    const map = await decodeMap(new Uint8Array(readFileSync(mapPath(archetype))));
    const committed = await decodePng(
      new Uint8Array(readFileSync(previewPath(archetype))),
      `${archetype}.png`,
    );
    const regenerated = await decodePng(
      await renderPreview(map.terrain),
      `${archetype}-regenerated.png`,
    );

    expect(committed.width).toBe(map.terrain.width);
    expect(committed.height).toBe(map.terrain.height);
    expect(committed).toEqual(regenerated);
  });
});
