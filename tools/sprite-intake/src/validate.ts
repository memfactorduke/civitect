/**
 * The ADR-012 mechanical gates: dimension / anchor / footprint / state
 * completeness / palette, validated against the sprite's protocol sidecar.
 * Machines check consistency here; Mem's taste pass happens on contact
 * sheets (intake-chain follow-up).
 *
 * Every rule reports ALL failures for a sprite, not just the first —
 * a 60-sprite Codex batch gets one triage list, not sixty round trips.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseSpriteSidecar,
  SPRITE_TILE_3X,
  SpriteCategory,
  type SpriteSidecar,
  SpriteState,
} from "@civitect/protocol";
import { checkPalette, loadMasterPalette, type Rgb } from "./palette";
import { decodePng, type RawImage } from "./png";

/** Categories whose sprites must ship all four state variants (ADR-012). */
const BUILDING_CATEGORIES: ReadonlySet<string> = new Set([
  SpriteCategory.residential,
  SpriteCategory.commercial,
  SpriteCategory.industrial,
  SpriteCategory.office,
  SpriteCategory.services,
]);

const REQUIRED_BUILDING_STATES: readonly SpriteState[] = [
  SpriteState.normal,
  SpriteState.construction,
  SpriteState.abandoned,
  SpriteState.emissiveMask,
];

/** [TUNE] TDD §11: max sprite height 4× footprint width. */
const MAX_HEIGHT_FOOTPRINT_FACTOR = 4;

/** [TUNE] anchor tolerance, px at 3× (odd canvas widths round the center). */
const ANCHOR_TOLERANCE_PX = 1;

export interface SpriteIssue {
  readonly rule:
    | "sidecar"
    | "state-missing"
    | "file"
    | "dimensions"
    | "anchor"
    | "background"
    | "palette";
  readonly message: string;
}

export interface SpriteReport {
  readonly id: string;
  readonly issues: readonly SpriteIssue[];
}

/** Expected 3× canvas width for a w×d footprint: the iso base diamond span. */
export function expectedCanvasWidth(sidecar: SpriteSidecar): number {
  return ((sidecar.footprint.w + sidecar.footprint.d) * SPRITE_TILE_3X.w) / 2;
}

/** Base diamond height + the [TUNE] height ceiling above it. */
export function maxCanvasHeight(sidecar: SpriteSidecar): number {
  const base = ((sidecar.footprint.w + sidecar.footprint.d) * SPRITE_TILE_3X.h) / 2;
  return base + MAX_HEIGHT_FOOTPRINT_FACTOR * sidecar.footprint.w * SPRITE_TILE_3X.w;
}

/**
 * Validate one sprite: sidecar JSON path + its sibling PNGs.
 * Returns a report; an empty `issues` array means the sprite passes.
 */
export async function validateSprite(
  sidecarPath: string,
  palette: readonly Rgb[],
): Promise<SpriteReport> {
  const issues: SpriteIssue[] = [];
  let sidecar: SpriteSidecar;
  try {
    sidecar = parseSpriteSidecar(JSON.parse(readFileSync(sidecarPath, "utf8")), sidecarPath);
  } catch (error) {
    return {
      id: sidecarPath,
      issues: [
        { rule: "sidecar", message: error instanceof Error ? error.message : String(error) },
      ],
    };
  }

  if (BUILDING_CATEGORIES.has(sidecar.category)) {
    for (const state of REQUIRED_BUILDING_STATES) {
      if (sidecar.states[state] === undefined) {
        issues.push({
          rule: "state-missing",
          message: `building category "${sidecar.category}" requires state "${state}" (ADR-012)`,
        });
      }
    }
  }

  const dir = dirname(sidecarPath);
  const images = new Map<string, RawImage>();
  for (const [state, file] of Object.entries(sidecar.states)) {
    try {
      const image = await decodePng(new Uint8Array(readFileSync(join(dir, file))), file);
      images.set(state, image);
    } catch (error) {
      issues.push({
        rule: "file",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Dimensions: every state shares the sidecar canvas; canvas matches the
  // footprint's iso span; height under the [TUNE] ceiling.
  const wantW = expectedCanvasWidth(sidecar);
  if (sidecar.canvas.w !== wantW) {
    issues.push({
      rule: "dimensions",
      message:
        `canvas width ${sidecar.canvas.w} ≠ ${wantW} px required by the ` +
        `${sidecar.footprint.w}×${sidecar.footprint.d} footprint at 3× (TDD §11)`,
    });
  }
  const maxH = maxCanvasHeight(sidecar);
  if (sidecar.canvas.h > maxH) {
    issues.push({
      rule: "dimensions",
      message: `canvas height ${sidecar.canvas.h} exceeds the ${maxH} px ceiling (4× footprint width [TUNE])`,
    });
  }
  for (const [state, image] of images) {
    if (image.width !== sidecar.canvas.w || image.height !== sidecar.canvas.h) {
      issues.push({
        rule: "dimensions",
        message:
          `state "${state}" is ${image.width}×${image.height}, sidecar canvas says ` +
          `${sidecar.canvas.w}×${sidecar.canvas.h}`,
      });
    }
  }

  // Anchor: center-bottom of the footprint = horizontal center of the base
  // diamond, bottom edge of the canvas (TDD §11).
  const wantX = Math.round(sidecar.canvas.w / 2);
  if (Math.abs(sidecar.anchor.x - wantX) > ANCHOR_TOLERANCE_PX) {
    issues.push({
      rule: "anchor",
      message: `anchor.x ${sidecar.anchor.x} ≠ canvas center ${wantX} (±${ANCHOR_TOLERANCE_PX})`,
    });
  }
  if (Math.abs(sidecar.anchor.y - sidecar.canvas.h) > ANCHOR_TOLERANCE_PX) {
    issues.push({
      rule: "anchor",
      message: `anchor.y ${sidecar.anchor.y} ≠ canvas bottom ${sidecar.canvas.h} (±${ANCHOR_TOLERANCE_PX})`,
    });
  }

  // Background: the four canvas corners must be transparent — a filled
  // corner is the classic un-removed AI background.
  const normal = images.get(SpriteState.normal);
  if (normal !== undefined) {
    const corners: [number, number][] = [
      [0, 0],
      [normal.width - 1, 0],
      [0, normal.height - 1],
      [normal.width - 1, normal.height - 1],
    ];
    for (const [x, y] of corners) {
      const alpha = normal.pixels[(y * normal.width + x) * 4 + 3] as number;
      if (alpha > 8) {
        issues.push({
          rule: "background",
          message: `corner (${x}, ${y}) is not transparent (alpha ${alpha}) — background not removed?`,
        });
        break;
      }
    }

    // Palette: lint the normal state (emissive masks are channel data, and
    // construction/abandoned inherit the base palette by construction).
    const paletteResult = checkPalette(normal, palette);
    if (!paletteResult.ok) {
      issues.push({
        rule: "palette",
        message:
          `palette deviation: mean ${paletteResult.meanDistance.toFixed(1)} ` +
          `(max ${24}), offenders ${(paletteResult.offenderRatio * 100).toFixed(2)}% ` +
          `(max 2%) over ${paletteResult.opaquePixels} opaque px — off the 64-swatch ramps (ADR-012)`,
      });
    }
  }

  return { id: sidecar.id, issues };
}

export { loadMasterPalette };
