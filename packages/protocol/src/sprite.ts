/**
 * Sprite sidecar contract (TDD §11, ADR-012): every sprite ships as 3× PNG
 * + this JSON sidecar; the intake toolchain (tools/sprite-intake, board
 * PR 11) validates pixels against it and the atlas packer trusts it. The
 * schema lives HERE because it's a cross-tool contract — generators write
 * it, gates verify it, the packer consumes it (protocol is neutral ground).
 *
 * Parsing is strict and loud: a sidecar that drifts from spec must fail the
 * build, not the game (TDD §11). Unknown categories/states are errors —
 * additions are append-only edits to this file, reviewed like any wire id.
 */

/** Source-of-truth scale: sprites are authored at 3×; 2×/1× are derived (never AI-upscaled). */
export const SPRITE_SOURCE_SCALE = 3;

/** Tile metric at 3×: 192×96 px (2:1 iso, 64×32 at 1× — TDD §11 [LOCKED]). */
export const SPRITE_TILE_3X = { w: 192, h: 96 } as const;

/** Footprint bounds in tiles (TDD §11: 1×1 … 8×8). */
export const FOOTPRINT_MIN = 1;
export const FOOTPRINT_MAX = 8;

/** Atlas categories (TDD §8) — append-only. */
export const SpriteCategory = {
  terrainRoads: "terrain-roads",
  residential: "residential",
  commercial: "commercial",
  industrial: "industrial",
  office: "office",
  services: "services",
  agents: "agents",
  effects: "effects",
  uiIcons: "ui-icons",
} as const;
export type SpriteCategory = (typeof SpriteCategory)[keyof typeof SpriteCategory];

const CATEGORIES: ReadonlySet<string> = new Set(Object.values(SpriteCategory));

/**
 * State variants (ADR-012). `normal` is universal; building categories
 * additionally require construction/abandoned/emissiveMask — that
 * completeness rule lives in the intake gate (it's per-category policy,
 * not schema shape).
 */
export const SpriteState = {
  normal: "normal",
  construction: "construction",
  abandoned: "abandoned",
  /** Night-emissive mask (windows/streetlights) — separate atlas channel (TDD §8). */
  emissiveMask: "emissive-mask",
} as const;
export type SpriteState = (typeof SpriteState)[keyof typeof SpriteState];

const STATES: ReadonlySet<string> = new Set(Object.values(SpriteState));

export interface SpriteSidecar {
  /** Kebab-case sprite id, unique within its category. */
  readonly id: string;
  readonly category: SpriteCategory;
  /** Footprint in tiles: w along +x (east), d along +y (south). */
  readonly footprint: { readonly w: number; readonly d: number };
  /** Canvas size of the 3× source PNGs, px. All states share one canvas. */
  readonly canvas: { readonly w: number; readonly h: number };
  /**
   * Anchor in 3× canvas px, measured from the canvas top-left: the point
   * placed at the footprint's center-bottom in world space (TDD §11).
   */
  readonly anchor: { readonly x: number; readonly y: number };
  /** State name → PNG filename (relative to the sidecar). */
  readonly states: Readonly<Partial<Record<SpriteState, string>>>;
}

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parse + validate one sidecar document (already JSON.parse'd). Throws with field-specific messages. */
export function parseSpriteSidecar(doc: unknown, source: string): SpriteSidecar {
  if (typeof doc !== "object" || doc === null) {
    fail(source, "sidecar must be a JSON object");
  }
  const d = doc as Record<string, unknown>;

  if (typeof d.id !== "string" || !KEBAB_ID.test(d.id)) {
    fail(source, `id must be kebab-case, got ${JSON.stringify(d.id)}`);
  }
  if (typeof d.category !== "string" || !CATEGORIES.has(d.category)) {
    fail(source, `unknown category ${JSON.stringify(d.category)}`);
  }

  const footprint = d.footprint as Record<string, unknown> | null | undefined;
  if (
    footprint == null ||
    !isPositiveInt(footprint.w) ||
    !isPositiveInt(footprint.d) ||
    footprint.w > FOOTPRINT_MAX ||
    footprint.d > FOOTPRINT_MAX
  ) {
    fail(
      source,
      `footprint must be integers in [${FOOTPRINT_MIN}, ${FOOTPRINT_MAX}] tiles, got ${JSON.stringify(d.footprint)}`,
    );
  }

  const canvas = d.canvas as Record<string, unknown> | null | undefined;
  if (canvas == null || !isPositiveInt(canvas.w) || !isPositiveInt(canvas.h)) {
    fail(source, `canvas must have positive integer w/h px, got ${JSON.stringify(d.canvas)}`);
  }

  const anchor = d.anchor as Record<string, unknown> | null | undefined;
  if (anchor == null || !isNonNegativeInt(anchor.x) || !isNonNegativeInt(anchor.y)) {
    fail(source, `anchor must have non-negative integer x/y px, got ${JSON.stringify(d.anchor)}`);
  }
  if (anchor.x > canvas.w || anchor.y > canvas.h) {
    fail(
      source,
      `anchor (${anchor.x}, ${anchor.y}) lies outside the ${canvas.w}×${canvas.h} canvas`,
    );
  }

  const statesRaw = d.states as Record<string, unknown> | null | undefined;
  if (statesRaw == null || typeof statesRaw !== "object" || Array.isArray(statesRaw)) {
    fail(source, "states must be an object of state name → filename");
  }
  const states: Partial<Record<SpriteState, string>> = {};
  for (const [name, file] of Object.entries(statesRaw)) {
    if (!STATES.has(name)) {
      fail(
        source,
        `unknown state ${JSON.stringify(name)} (additions are append-only schema edits)`,
      );
    }
    if (typeof file !== "string" || !file.endsWith(".png")) {
      fail(source, `state "${name}" must name a .png file, got ${JSON.stringify(file)}`);
    }
    states[name as SpriteState] = file;
  }
  if (states[SpriteState.normal] === undefined) {
    fail(source, 'every sprite must carry the "normal" state');
  }

  return {
    id: d.id,
    category: d.category as SpriteCategory,
    footprint: { w: footprint.w as number, d: footprint.d as number },
    canvas: { w: canvas.w as number, h: canvas.h as number },
    anchor: { x: anchor.x as number, y: anchor.y as number },
    states,
  };
}
