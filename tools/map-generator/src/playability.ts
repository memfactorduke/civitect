import type { TerrainGrid } from "@civitect/protocol";

export type MapPlayabilityBand = "excellent" | "good" | "rough" | "hostile";

export interface MapPlayabilityOptions {
  /** Terraces at or below this height are treated as low-friction starter land. */
  readonly easyBuildElevationMax?: number;
  /** Land-to-land edges above this elevation delta count as steep. */
  readonly steepSlopeDelta?: number;
}

export interface MapPlayabilityScore {
  readonly totalTiles: number;
  readonly landTiles: number;
  readonly waterTiles: number;
  readonly easyBuildableTiles: number;
  readonly waterfrontBuildableTiles: number;
  readonly resourceTiles: number;
  readonly steepLandEdges: number;
  readonly landNeighborEdges: number;
  readonly landShare: number;
  readonly waterShare: number;
  readonly easyBuildableShare: number;
  readonly easyBuildableLandShare: number;
  readonly waterfrontShareOfEasyBuild: number;
  readonly resourceShareOfLand: number;
  readonly steepEdgeShare: number;
  readonly score: number;
  readonly band: MapPlayabilityBand;
  readonly warnings: readonly string[];
}

const DEFAULT_EASY_BUILD_ELEVATION_MAX = 3;
const DEFAULT_STEEP_SLOPE_DELTA = 1;

export function scoreTerrainPlayability(
  terrain: TerrainGrid,
  options: MapPlayabilityOptions = {},
): MapPlayabilityScore {
  const totalTiles = terrain.width * terrain.height;
  if (terrain.width < 1 || terrain.height < 1 || totalTiles < 1) {
    throw new Error(`terrain dims ${terrain.width}x${terrain.height} invalid`);
  }
  assertLayerSize(terrain.layers.elevation, totalTiles, "elevation");
  assertLayerSize(terrain.layers.water, totalTiles, "water");
  assertLayerSize(terrain.layers.resource, totalTiles, "resource");

  const easyBuildElevationMax = options.easyBuildElevationMax ?? DEFAULT_EASY_BUILD_ELEVATION_MAX;
  const steepSlopeDelta = options.steepSlopeDelta ?? DEFAULT_STEEP_SLOPE_DELTA;

  let landTiles = 0;
  let waterTiles = 0;
  let easyBuildableTiles = 0;
  let waterfrontBuildableTiles = 0;
  let resourceTiles = 0;
  let landNeighborEdges = 0;
  let steepLandEdges = 0;

  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      const i = y * terrain.width + x;
      if (isWater(terrain, i)) {
        waterTiles++;
        continue;
      }

      landTiles++;
      const elevation = terrain.layers.elevation[i] as number;
      const easyBuildable = elevation <= easyBuildElevationMax;
      if (easyBuildable) {
        easyBuildableTiles++;
      }
      if ((terrain.layers.resource[i] as number) !== 0) {
        resourceTiles++;
      }
      if (easyBuildable && touchesWater(terrain, x, y)) {
        waterfrontBuildableTiles++;
      }

      if (x + 1 < terrain.width) {
        const right = i + 1;
        if (!isWater(terrain, right)) {
          landNeighborEdges++;
          if (Math.abs(elevation - (terrain.layers.elevation[right] as number)) > steepSlopeDelta) {
            steepLandEdges++;
          }
        }
      }
      if (y + 1 < terrain.height) {
        const below = i + terrain.width;
        if (!isWater(terrain, below)) {
          landNeighborEdges++;
          if (Math.abs(elevation - (terrain.layers.elevation[below] as number)) > steepSlopeDelta) {
            steepLandEdges++;
          }
        }
      }
    }
  }

  const landShare = ratio(landTiles, totalTiles);
  const waterShare = ratio(waterTiles, totalTiles);
  const easyBuildableShare = ratio(easyBuildableTiles, totalTiles);
  const easyBuildableLandShare = ratio(easyBuildableTiles, landTiles);
  const waterfrontShareOfEasyBuild = ratio(waterfrontBuildableTiles, easyBuildableTiles);
  const resourceShareOfLand = ratio(resourceTiles, landTiles);
  const steepEdgeShare = ratio(steepLandEdges, landNeighborEdges);

  const score = Math.round(
    rangeScore(landShare, 0.35, 0.75) * 30 +
      rangeScore(easyBuildableShare, 0.25, 0.55) * 25 +
      trapezoidScore(waterShare, 0.02, 0.08, 0.3, 0.45) * 15 +
      rangeScore(waterfrontShareOfEasyBuild, 0.01, 0.06) * 10 +
      rangeScore(resourceShareOfLand, 0.002, 0.015) * 10 +
      descendingScore(steepEdgeShare, 0.08, 0.25) * 10,
  );

  const warnings = playabilityWarnings({
    landShare,
    waterShare,
    easyBuildableShare,
    waterfrontShareOfEasyBuild,
    resourceTiles,
    steepEdgeShare,
  });

  return {
    totalTiles,
    landTiles,
    waterTiles,
    easyBuildableTiles,
    waterfrontBuildableTiles,
    resourceTiles,
    steepLandEdges,
    landNeighborEdges,
    landShare,
    waterShare,
    easyBuildableShare,
    easyBuildableLandShare,
    waterfrontShareOfEasyBuild,
    resourceShareOfLand,
    steepEdgeShare,
    score: clamp(score, 0, 100),
    band: scoreBand(score),
    warnings,
  };
}

function isWater(terrain: TerrainGrid, tile: number): boolean {
  return (terrain.layers.water[tile] as number) !== 0;
}

function touchesWater(terrain: TerrainGrid, x: number, y: number): boolean {
  const { width, height } = terrain;
  const i = y * width + x;
  return (
    (x > 0 && isWater(terrain, i - 1)) ||
    (x + 1 < width && isWater(terrain, i + 1)) ||
    (y > 0 && isWater(terrain, i - width)) ||
    (y + 1 < height && isWater(terrain, i + width))
  );
}

function assertLayerSize(layer: Uint16Array, expected: number, name: string): void {
  if (layer.length !== expected) {
    throw new Error(`terrain layer ${name} has ${layer.length} cells, grid wants ${expected}`);
  }
}

function playabilityWarnings(input: {
  readonly landShare: number;
  readonly waterShare: number;
  readonly easyBuildableShare: number;
  readonly waterfrontShareOfEasyBuild: number;
  readonly resourceTiles: number;
  readonly steepEdgeShare: number;
}): readonly string[] {
  const warnings: string[] = [];
  if (input.landShare < 0.35 || input.easyBuildableShare < 0.25) {
    warnings.push("low-buildable-land");
  }
  if (input.waterShare === 0 || input.waterfrontShareOfEasyBuild < 0.01) {
    warnings.push("limited-water-access");
  }
  if (input.waterShare > 0.45) {
    warnings.push("water-heavy");
  }
  if (input.resourceTiles === 0) {
    warnings.push("resource-scarcity");
  }
  if (input.steepEdgeShare > 0.25) {
    warnings.push("rough-terrain");
  }
  return warnings;
}

function scoreBand(score: number): MapPlayabilityBand {
  if (score >= 80) {
    return "excellent";
  }
  if (score >= 65) {
    return "good";
  }
  if (score >= 45) {
    return "rough";
  }
  return "hostile";
}

function ratio(value: number, total: number): number {
  return total <= 0 ? 0 : value / total;
}

function rangeScore(value: number, low: number, high: number): number {
  if (value <= low) {
    return 0;
  }
  if (value >= high) {
    return 1;
  }
  return (value - low) / (high - low);
}

function descendingScore(value: number, good: number, bad: number): number {
  if (value <= good) {
    return 1;
  }
  if (value >= bad) {
    return 0;
  }
  return 1 - (value - good) / (bad - good);
}

function trapezoidScore(
  value: number,
  low: number,
  idealLow: number,
  idealHigh: number,
  high: number,
): number {
  if (value <= low || value >= high) {
    return 0;
  }
  if (value >= idealLow && value <= idealHigh) {
    return 1;
  }
  if (value < idealLow) {
    return (value - low) / (idealLow - low);
  }
  return 1 - (value - idealHigh) / (high - idealHigh);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
