export interface BootConfigInput {
  readonly seed: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

export interface BootConfig extends BootConfigInput {}

export const MIN_BOOT_MAP_TILES = 16;
export const MAX_BOOT_MAP_TILES = 512;
export const MAX_BOOT_MAP_AREA = MAX_BOOT_MAP_TILES * MAX_BOOT_MAP_TILES;

const DEFAULT_BOOT_CONFIG: BootConfigInput = {
  seed: 1234,
  mapWidth: 64,
  mapHeight: 64,
};

function requireSafeInt(value: number, field: keyof BootConfigInput): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`boot config ${field} must be a safe integer`);
  }
}

/**
 * Validate app boot dimensions before the renderer or worker allocates memory.
 * The scene rebuild work will make these values dynamic; the guard belongs here
 * so map selection cannot accidentally boot an impossible city.
 */
export function createBootConfig(input: BootConfigInput): Readonly<BootConfig> {
  requireSafeInt(input.seed, "seed");
  requireSafeInt(input.mapWidth, "mapWidth");
  requireSafeInt(input.mapHeight, "mapHeight");
  if (input.seed < 0) {
    throw new Error("boot config seed must be non-negative");
  }
  if (input.mapWidth < MIN_BOOT_MAP_TILES || input.mapHeight < MIN_BOOT_MAP_TILES) {
    throw new Error(`boot config map dimensions must be at least ${MIN_BOOT_MAP_TILES} tiles`);
  }
  if (input.mapWidth > MAX_BOOT_MAP_TILES || input.mapHeight > MAX_BOOT_MAP_TILES) {
    throw new Error(`boot config map dimensions must be at most ${MAX_BOOT_MAP_TILES} tiles`);
  }
  if (input.mapWidth * input.mapHeight > MAX_BOOT_MAP_AREA) {
    throw new Error(`boot config map area must be at most ${MAX_BOOT_MAP_AREA} tiles`);
  }
  return Object.freeze({ ...input });
}

/**
 * Phase 0 boot constants, shared by the main thread and the sim worker.
 *
 * Real boot flows replace this: new-game params come from map selection
 * (ROADMAP Phase 1), loaded games from the .civ header (board PR 8/9).
 */
export const BOOT = createBootConfig(DEFAULT_BOOT_CONFIG);
