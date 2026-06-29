/**
 * Golden-corpus session-value audit (GDD §17.2, ROADMAP Phase 8 exit).
 *
 * Golden hashes prove "same input -> same city." This helper asks a different
 * product question: does the corpus still include cities that look like real
 * player sessions, with growth, solvency, zoning, utilities, and services?
 */
import { BuildingKind, type Command, CommandType } from "@civitect/protocol";
import type { GoldenExpectation } from "./goldens";
import type { GoldenScenario } from "./scenario";

const DEFAULT_STARTING_FUNDS_CENTS = 5_000_000;
const TICKS_PER_GAME_DAY = 1_440;
const PLAYABLE_POPULATION = 5_000;
const CITY_SCALE_POPULATION = 30_000;
const MIN_CORE_ZONE_KINDS = 3;
const MIN_SERVICE_KINDS = 6;

export interface SessionValueMetrics {
  readonly days: number;
  readonly commandCount: number;
  readonly roadCommands: number;
  readonly zoneKinds: number;
  readonly utilityKinds: number;
  readonly serviceKinds: number;
  readonly population: number;
  readonly fundsCents: number;
  readonly fundsDeltaCents: number;
}

export interface SessionValueScore {
  readonly name: string;
  readonly score: number;
  readonly metrics: SessionValueMetrics;
  readonly tags: readonly string[];
  readonly gaps: readonly string[];
}

export interface SessionValueSummary {
  readonly scenarioCount: number;
  readonly playableGrowthCount: number;
  readonly cityScaleCount: number;
  readonly bestScore: SessionValueScore;
}

function commandStats(commands: readonly Command[]) {
  const zoneKinds = new Set<number>();
  const utilityKinds = new Set<number>();
  const serviceKinds = new Set<number>();
  let roadCommands = 0;

  for (const command of commands) {
    switch (command.type) {
      case CommandType.buildRoad:
      case CommandType.bulldozeRoad:
      case CommandType.upgradeRoad:
        roadCommands++;
        break;
      case CommandType.zoneRect:
        zoneKinds.add(command.zone);
        break;
      case CommandType.placeBuilding:
        if (
          command.building === BuildingKind.powerPlant ||
          command.building === BuildingKind.waterPump
        ) {
          utilityKinds.add(command.building);
        } else if (command.building >= BuildingKind.fireStation) {
          serviceKinds.add(command.building);
        }
        break;
    }
  }

  return {
    roadCommands,
    zoneKinds: zoneKinds.size,
    utilityKinds: utilityKinds.size,
    serviceKinds: serviceKinds.size,
  };
}

function addIf(tags: string[], condition: boolean, tag: string): void {
  if (condition) {
    tags.push(tag);
  }
}

export function scoreSessionValue(
  scenario: GoldenScenario,
  expectation: GoldenExpectation,
): SessionValueScore {
  const stats = commandStats(scenario.commands);
  const days = Math.floor(expectation.hud.tick / TICKS_PER_GAME_DAY);
  const startingFundsCents = scenario.startingFundsCents ?? DEFAULT_STARTING_FUNDS_CENTS;
  const metrics: SessionValueMetrics = {
    days,
    commandCount: scenario.commands.length,
    roadCommands: stats.roadCommands,
    zoneKinds: stats.zoneKinds,
    utilityKinds: stats.utilityKinds,
    serviceKinds: stats.serviceKinds,
    population: expectation.hud.population,
    fundsCents: expectation.hud.fundsCents,
    fundsDeltaCents: expectation.hud.fundsCents - startingFundsCents,
  };

  const hasRoadNetwork = metrics.roadCommands > 0;
  const hasCoreZoning = metrics.zoneKinds >= MIN_CORE_ZONE_KINDS;
  const hasUtilities = metrics.utilityKinds >= 2;
  const hasServices = metrics.serviceKinds >= MIN_SERVICE_KINDS;
  const reachesPlayableGrowth = metrics.population >= PLAYABLE_POPULATION;
  const reachesCityScale = metrics.population >= CITY_SCALE_POPULATION;
  const isSolvent = metrics.fundsCents >= 0;
  const hasLongEnoughHorizon = metrics.days >= 90;

  const tags: string[] = [];
  addIf(tags, hasRoadNetwork, "road-network");
  addIf(tags, hasCoreZoning, "mixed-zoning");
  addIf(tags, hasUtilities, "core-utilities");
  addIf(tags, hasServices, "service-portfolio");
  addIf(tags, reachesPlayableGrowth, "playable-growth");
  addIf(tags, reachesCityScale, "city-scale");
  addIf(tags, isSolvent, "solvent");
  addIf(tags, hasLongEnoughHorizon, "sustained-session");

  const gaps: string[] = [];
  addIf(gaps, !hasRoadNetwork, "no-road-network");
  addIf(gaps, !hasCoreZoning, "no-mixed-zoning");
  addIf(gaps, !hasUtilities, "no-core-utilities");
  addIf(gaps, !hasServices, "no-service-portfolio");
  addIf(gaps, !reachesPlayableGrowth, "below-playable-population");
  addIf(gaps, !isSolvent, "insolvent");
  addIf(gaps, !hasLongEnoughHorizon, "short-session");

  let score = 0;
  if (hasRoadNetwork) score += 10;
  if (hasCoreZoning) score += 15;
  if (hasUtilities) score += 15;
  if (hasServices) score += 15;
  if (reachesPlayableGrowth) score += 20;
  if (reachesCityScale) score += 10;
  if (isSolvent) score += 10;
  if (hasLongEnoughHorizon) score += 5;

  return { name: scenario.name, score, metrics, tags, gaps };
}

export function summarizeSessionValue(scores: readonly SessionValueScore[]): SessionValueSummary {
  if (scores.length === 0) {
    throw new Error("session-value audit needs at least one scored scenario");
  }
  let bestScore = scores[0] as SessionValueScore;
  let playableGrowthCount = 0;
  let cityScaleCount = 0;
  for (const score of scores) {
    if (score.score > bestScore.score) {
      bestScore = score;
    }
    if (
      score.metrics.population >= PLAYABLE_POPULATION &&
      score.metrics.zoneKinds >= MIN_CORE_ZONE_KINDS &&
      score.metrics.utilityKinds >= 2
    ) {
      playableGrowthCount++;
    }
    if (
      score.metrics.population >= CITY_SCALE_POPULATION &&
      score.metrics.serviceKinds >= MIN_SERVICE_KINDS
    ) {
      cityScaleCount++;
    }
  }
  return { scenarioCount: scores.length, playableGrowthCount, cityScaleCount, bestScore };
}
