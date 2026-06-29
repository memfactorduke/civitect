/**
 * Deterministic new-city start scoring (GDD 3).
 *
 * The generator creates varied maps; this pass finds fair opening sites so
 * catalog/UI work can present useful places to begin without touching sim
 * rules. Scores are integer-only and tie-broken by coordinates.
 */
import type { TerrainGrid } from "@civitect/protocol";

export interface StartSiteOptions {
  readonly count?: number;
  readonly radius?: number;
  readonly edgeBuffer?: number;
}

export interface StartSite {
  readonly x: number;
  readonly y: number;
  readonly score: number;
  readonly buildableTiles: number;
  readonly waterTiles: number;
  readonly resourceTiles: number;
  readonly elevationRange: number;
}

interface CandidateScore extends StartSite {
  readonly centerWater: number;
}

const DEFAULT_COUNT = 5;
const DEFAULT_RADIUS = 6;

function clampPositiveInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function cellIndex(terrain: TerrainGrid, x: number, y: number): number {
  return y * terrain.width + x;
}

function scanCandidate(terrain: TerrainGrid, x: number, y: number, radius: number): CandidateScore {
  let buildableTiles = 0;
  let waterTiles = 0;
  let resourceTiles = 0;
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = 0;

  const minX = Math.max(0, x - radius);
  const maxX = Math.min(terrain.width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(terrain.height - 1, y + radius);

  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const i = cellIndex(terrain, xx, yy);
      if ((terrain.layers.water[i] as number) !== 0) {
        waterTiles++;
        continue;
      }
      buildableTiles++;
      if ((terrain.layers.resource[i] as number) !== 0) {
        resourceTiles++;
      }
      const elevation = terrain.layers.elevation[i] as number;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    }
  }

  const elevationRange = buildableTiles === 0 ? 99 : maxElevation - minElevation;
  const centerWater = terrain.layers.water[cellIndex(terrain, x, y)] as number;
  const waterAccessBonus = Math.min(waterTiles, buildableTiles);
  const score =
    buildableTiles * 12 +
    waterAccessBonus * 16 +
    resourceTiles * 16 -
    elevationRange * 24 -
    centerWater * 10_000;

  return { x, y, score, buildableTiles, waterTiles, resourceTiles, elevationRange, centerWater };
}

function compareStartSites(a: CandidateScore, b: CandidateScore): number {
  return b.score - a.score || b.buildableTiles - a.buildableTiles || a.y - b.y || a.x - b.x;
}

export function findStartSites(terrain: TerrainGrid, options: StartSiteOptions = {}): StartSite[] {
  const count = clampPositiveInteger("count", options.count ?? DEFAULT_COUNT);
  const radius = clampPositiveInteger("radius", options.radius ?? DEFAULT_RADIUS);
  const edgeBuffer = options.edgeBuffer ?? radius;
  if (!Number.isSafeInteger(edgeBuffer) || edgeBuffer < 0) {
    throw new Error("edgeBuffer must be a non-negative safe integer");
  }

  const minX = Math.min(edgeBuffer, terrain.width - 1);
  const maxX = Math.max(minX, terrain.width - 1 - edgeBuffer);
  const minY = Math.min(edgeBuffer, terrain.height - 1);
  const maxY = Math.max(minY, terrain.height - 1 - edgeBuffer);
  const candidates: CandidateScore[] = [];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const site = scanCandidate(terrain, x, y, radius);
      if (site.centerWater === 0 && site.buildableTiles > 0) {
        candidates.push(site);
      }
    }
  }

  candidates.sort(compareStartSites);
  return candidates.slice(0, count).map(({ centerWater: _centerWater, ...site }) => site);
}
