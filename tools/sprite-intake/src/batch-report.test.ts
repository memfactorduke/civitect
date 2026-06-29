import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inspectSpriteBatch } from "./batch-report";
import { loadMasterPalette, type Rgb } from "./palette";
import { encodePng, type RawImage } from "./png";

let dir: string;
let palette: readonly Rgb[];

function paletteColor(at: number): Rgb {
  const color = palette[at];
  if (color === undefined) {
    throw new Error(`palette entry ${at} is missing`);
  }
  return color;
}

function blankImage(width: number, height: number): RawImage & { pixels: Uint8Array } {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}

function paintBlob(image: RawImage & { pixels: Uint8Array }, color: Rgb): void {
  const cx = image.width / 2;
  const cy = image.height * 0.75;
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

async function writePng(path: string, color: Rgb): Promise<void> {
  const image = blankImage(192, 240);
  paintBlob(image, color);
  writeFileSync(path, await encodePng(image));
}

interface SpriteOptions {
  readonly pathName: string;
  readonly id: string;
  readonly category?: string;
  readonly omitState?: string;
}

async function writeSprite(options: SpriteOptions): Promise<string> {
  const sidecarPath = join(dir, options.pathName);
  const filePrefix = options.pathName.replace(/\.json$/, "");
  const states: Record<string, string> = {
    normal: `${filePrefix}.png`,
    construction: `${filePrefix}.construction.png`,
    abandoned: `${filePrefix}.abandoned.png`,
    "emissive-mask": `${filePrefix}.emissive.png`,
  };
  if (options.omitState !== undefined) {
    delete states[options.omitState];
  }
  writeFileSync(
    sidecarPath,
    JSON.stringify({
      id: options.id,
      category: options.category ?? "residential",
      footprint: { w: 1, d: 1 },
      canvas: { w: 192, h: 240 },
      anchor: { x: 96, y: 240 },
      states,
    }),
  );

  for (const file of Object.values(states)) {
    await writePng(join(dir, file), paletteColor(20));
  }
  return sidecarPath;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sprite-batch-report-"));
  palette = loadMasterPalette();
});

describe("sprite batch report", () => {
  it("summarizes category/state coverage and referenced PNGs", async () => {
    const house = await writeSprite({ pathName: "house.json", id: "good-house" });
    const road = await writeSprite({
      pathName: "road.json",
      id: "straight-road",
      category: "terrain-roads",
      omitState: "construction",
    });

    const report = await inspectSpriteBatch([road, house], palette);

    expect(report.byCategory).toEqual({ residential: 1, "terrain-roads": 1 });
    expect(report.byState).toEqual({
      abandoned: 2,
      construction: 1,
      "emissive-mask": 2,
      normal: 2,
    });
    expect(report.entries.map((entry) => entry.id)).toEqual(["good-house", "straight-road"]);
    expect(report.entries[0]?.files).toHaveLength(4);
    expect(report.failures).toEqual([]);
  });

  it("groups gate issues and duplicate ids in one batch result", async () => {
    const first = await writeSprite({ pathName: "dupe-a.json", id: "same-house" });
    const second = await writeSprite({ pathName: "dupe-b.json", id: "same-house" });
    const missingState = await writeSprite({
      pathName: "missing-state.json",
      id: "missing-state",
      omitState: "abandoned",
    });

    const report = await inspectSpriteBatch([first, missingState, second], palette);

    expect(report.issueCounts).toMatchObject({ "duplicate-id": 1, "state-missing": 1 });
    expect(report.failures.some((failure) => failure.includes("[duplicate-id]"))).toBe(true);
    expect(report.failures.some((failure) => failure.includes("[state-missing]"))).toBe(true);
  });

  it("keeps invalid sidecars visible instead of dropping them from the manifest", async () => {
    const invalid = join(dir, "not-json.json");
    writeFileSync(invalid, "{");

    const report = await inspectSpriteBatch([invalid], palette);

    expect(report.byCategory).toEqual({ unknown: 1 });
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.issues[0]?.rule).toBe("sidecar");
    expect(report.failures[0]).toContain("[sidecar]");
  });
});
