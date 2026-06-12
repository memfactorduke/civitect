/**
 * Board task 11 verification: the gate rejects seeded bad fixtures (wrong
 * size / off-palette / missing state / bad anchor / unremoved background)
 * and accepts a good one. Fixtures are GENERATED here with the intake's
 * own encoder — self-contained, no binary blobs in the repo.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMasterPalette, type Rgb } from "./palette";
import { encodePng, type RawImage } from "./png";
import { validateSprite } from "./validate";

let dir: string;
let palette: readonly Rgb[];

function blankImage(
  width: number,
  height: number,
): {
  image: RawImage & { pixels: Uint8Array };
} {
  return { image: { width, height, pixels: new Uint8Array(width * height * 4) } };
}

/** Paint a centered diamond blob of `color`, leaving corners transparent. */
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

interface FixtureOptions {
  readonly id: string;
  readonly color?: Rgb;
  readonly canvas?: { w: number; h: number };
  readonly anchor?: { x: number; y: number };
  readonly omitState?: string;
  readonly statePngSize?: { w: number; h: number };
  readonly fillCorner?: boolean;
}

/** Write a residential 1×1 sprite (canvas 192×240, anchor 96/240) with overrides. */
async function writeFixture(options: FixtureOptions): Promise<string> {
  const canvas = options.canvas ?? { w: 192, h: 240 };
  const anchor = options.anchor ?? { x: canvas.w / 2, y: canvas.h };
  const color = options.color ?? (palette[20] as Rgb);

  const states: Record<string, string> = {
    normal: `${options.id}.png`,
    construction: `${options.id}.construction.png`,
    abandoned: `${options.id}.abandoned.png`,
    "emissive-mask": `${options.id}.emissive.png`,
  };
  if (options.omitState !== undefined) {
    delete states[options.omitState];
  }

  const sidecarPath = join(dir, `${options.id}.json`);
  writeFileSync(
    sidecarPath,
    JSON.stringify({
      id: options.id,
      category: "residential",
      footprint: { w: 1, d: 1 },
      canvas,
      anchor,
      states,
    }),
  );

  for (const file of Object.values(states)) {
    const size = options.statePngSize ?? canvas;
    const { image } = blankImage(size.w, size.h);
    paintBlob(image, color);
    if (options.fillCorner === true) {
      image.pixels[0] = 200;
      image.pixels[1] = 200;
      image.pixels[2] = 200;
      image.pixels[3] = 255;
    }
    writeFileSync(join(dir, file), await encodePng(image));
  }
  return sidecarPath;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sprite-intake-"));
  palette = loadMasterPalette();
});

afterAll(() => {
  // tmpdir cleanup is the OS's job; nothing precious in there.
});

describe("sprite-intake gates (ADR-012: machines check consistency)", () => {
  it("accepts a spec-conformant sprite", async () => {
    const report = await validateSprite(await writeFixture({ id: "good-house" }), palette);
    expect(report.issues).toEqual([]);
  });

  it("rejects wrong-size state PNGs", async () => {
    const report = await validateSprite(
      await writeFixture({ id: "bad-size", statePngSize: { w: 100, h: 100 } }),
      palette,
    );
    expect(report.issues.some((i) => i.rule === "dimensions")).toBe(true);
  });

  it("rejects canvases that disagree with the footprint's iso span", async () => {
    const report = await validateSprite(
      await writeFixture({ id: "bad-canvas", canvas: { w: 200, h: 240 } }),
      palette,
    );
    expect(report.issues.some((i) => i.rule === "dimensions" && /footprint/.test(i.message))).toBe(
      true,
    );
  });

  it("rejects off-palette sprites (style drift fails the build)", async () => {
    const report = await validateSprite(
      await writeFixture({ id: "magenta-monster", color: { r: 255, g: 0, b: 255 } }),
      palette,
    );
    expect(report.issues.some((i) => i.rule === "palette")).toBe(true);
  });

  it("rejects building sprites missing a required state", async () => {
    const report = await validateSprite(
      await writeFixture({ id: "no-construction", omitState: "construction" }),
      palette,
    );
    expect(report.issues.some((i) => i.rule === "state-missing")).toBe(true);
  });

  it("rejects anchors off the footprint center-bottom", async () => {
    const report = await validateSprite(
      await writeFixture({ id: "bad-anchor", anchor: { x: 10, y: 240 } }),
      palette,
    );
    expect(report.issues.some((i) => i.rule === "anchor")).toBe(true);
  });

  it("rejects unremoved backgrounds (opaque canvas corner)", async () => {
    const report = await validateSprite(
      await writeFixture({ id: "bg-left-in", fillCorner: true }),
      palette,
    );
    expect(report.issues.some((i) => i.rule === "background")).toBe(true);
  });

  it("reports ALL failures at once (batch triage, not sixty round trips)", async () => {
    const report = await validateSprite(
      await writeFixture({
        id: "everything-wrong",
        color: { r: 255, g: 0, b: 255 },
        anchor: { x: 10, y: 10 },
        omitState: "abandoned",
      }),
      palette,
    );
    const rules = new Set(report.issues.map((i) => i.rule));
    expect(rules.has("palette")).toBe(true);
    expect(rules.has("anchor")).toBe(true);
    expect(rules.has("state-missing")).toBe(true);
  });
});
