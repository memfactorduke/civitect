import { BuildingKind, type Command, CommandType, ZoneKind } from "@civitect/protocol";
import type { GoldenScenario, TerrainRect } from "./scenario";

export interface ScenarioCoverage {
  readonly name: string;
  readonly commandCount: number;
  readonly latestCommandTick: number;
  readonly commandTickSpan: number;
  readonly duplicateSeqs: readonly number[];
  readonly commandTicksMonotone: boolean;
  readonly commandsAfterHorizon: number;
  readonly roads: ScenarioRoadCoverage;
  readonly zones: ScenarioZoneCoverage;
  readonly buildings: ScenarioBuildingCoverage;
  readonly terrain: ScenarioTerrainCoverage;
  readonly operations: ScenarioOperationCoverage;
  readonly warnings: readonly ScenarioCoverageWarning[];
}

export interface ScenarioRoadCoverage {
  readonly buildCount: number;
  readonly upgradeCount: number;
  readonly bulldozeCount: number;
  readonly roadClasses: readonly number[];
  readonly bridgeSegments: number;
}

export interface ScenarioZoneCoverage {
  readonly totalArea: number;
  readonly residentialArea: number;
  readonly jobArea: number;
  readonly dezoneArea: number;
  readonly byZone: Readonly<Record<number, number>>;
}

export interface ScenarioBuildingCoverage {
  readonly totalPlaced: number;
  readonly utilities: number;
  readonly services: number;
  readonly parks: number;
  readonly education: number;
}

export interface ScenarioTerrainCoverage {
  readonly rects: number;
  readonly elevationTiles: number;
  readonly waterTiles: number;
  readonly resourceTiles: number;
}

export interface ScenarioOperationCoverage {
  readonly speedChanges: number;
  readonly selections: number;
  readonly undoRedo: number;
  readonly serviceBudgetChanges: number;
  readonly taxChanges: number;
  readonly loanCommands: number;
  readonly districtCommands: number;
}

export type ScenarioCoverageWarning =
  | "empty-command-log"
  | "no-roads"
  | "no-zoning"
  | "no-residential-zoning"
  | "no-job-zoning"
  | "no-utilities"
  | "duplicate-seq"
  | "non-monotone-command-ticks"
  | "commands-after-horizon";

export interface ScenarioCorpusCoverage {
  readonly scenarioCount: number;
  readonly commandCount: number;
  readonly roadScenarioCount: number;
  readonly zoningScenarioCount: number;
  readonly utilityScenarioCount: number;
  readonly serviceScenarioCount: number;
  readonly terrainScenarioCount: number;
  readonly stagedSetupScenarioCount: number;
  readonly warningsByScenario: Readonly<Record<string, readonly ScenarioCoverageWarning[]>>;
}

const STAGED_SETUP_TICK_SPAN = 24;
const UTILITY_BUILDINGS: ReadonlySet<number> = new Set([
  BuildingKind.powerPlant,
  BuildingKind.waterPump,
]);
const PARK_BUILDINGS: ReadonlySet<number> = new Set([BuildingKind.parkSmall, BuildingKind.plaza]);
const EDUCATION_BUILDINGS: ReadonlySet<number> = new Set([
  BuildingKind.schoolElementary,
  BuildingKind.schoolHigh,
  BuildingKind.university,
  BuildingKind.library,
]);

export function summarizeScenarioCoverage(scenario: GoldenScenario): ScenarioCoverage {
  const seqs = new Set<number>();
  const duplicateSeqs: number[] = [];
  let previousTick = -1;
  let commandTicksMonotone = true;
  let earliestCommandTick = Number.POSITIVE_INFINITY;
  let latestCommandTick = 0;
  let commandsAfterHorizon = 0;

  const zoneArea = new Map<number, number>();
  const roadClasses = new Set<number>();
  let roadBuildCount = 0;
  let roadUpgradeCount = 0;
  let roadBulldozeCount = 0;
  let bridgeSegments = 0;
  let dezoneArea = 0;
  let buildingsPlaced = 0;
  let utilityBuildings = 0;
  let serviceBuildings = 0;
  let parkBuildings = 0;
  let educationBuildings = 0;
  let speedChanges = 0;
  let selections = 0;
  let undoRedo = 0;
  let serviceBudgetChanges = 0;
  let taxChanges = 0;
  let loanCommands = 0;
  let districtCommands = 0;

  for (const command of scenario.commands) {
    if (seqs.has(command.seq)) {
      duplicateSeqs.push(command.seq);
    }
    seqs.add(command.seq);
    if (command.tick < previousTick) {
      commandTicksMonotone = false;
    }
    previousTick = command.tick;
    earliestCommandTick = Math.min(earliestCommandTick, command.tick);
    latestCommandTick = Math.max(latestCommandTick, command.tick);
    if (command.tick >= scenario.untilTick) {
      commandsAfterHorizon++;
    }

    if (command.type === CommandType.buildRoad || command.type === CommandType.upgradeRoad) {
      if (command.type === CommandType.buildRoad) {
        roadBuildCount++;
      } else {
        roadUpgradeCount++;
      }
      roadClasses.add(command.roadClass);
      if (command.roadClass >= 11) {
        bridgeSegments++;
      }
    } else if (command.type === CommandType.bulldozeRoad) {
      roadBulldozeCount++;
    } else if (command.type === CommandType.zoneRect) {
      addArea(zoneArea, command.zone, rectArea(command));
    } else if (command.type === CommandType.dezoneRect) {
      dezoneArea += rectArea(command);
    } else if (command.type === CommandType.placeBuilding) {
      buildingsPlaced++;
      if (UTILITY_BUILDINGS.has(command.building)) {
        utilityBuildings++;
      } else {
        serviceBuildings++;
      }
      if (PARK_BUILDINGS.has(command.building)) {
        parkBuildings++;
      }
      if (EDUCATION_BUILDINGS.has(command.building)) {
        educationBuildings++;
      }
    } else if (command.type === CommandType.setSpeed) {
      speedChanges++;
    } else if (command.type === CommandType.selectTile) {
      selections++;
    } else if (command.type === CommandType.undo || command.type === CommandType.redo) {
      undoRedo++;
    } else if (command.type === CommandType.setServiceBudget) {
      serviceBudgetChanges++;
    } else if (command.type === CommandType.setTaxRate) {
      taxChanges++;
    } else if (command.type === CommandType.takeLoan || command.type === CommandType.repayLoan) {
      loanCommands++;
    } else if (
      command.type === CommandType.paintDistrict ||
      command.type === CommandType.nameDistrict ||
      command.type === CommandType.setPolicy ||
      command.type === CommandType.setOrdinance
    ) {
      districtCommands++;
    }
  }

  const terrain = summarizeTerrain(scenario.terrainRects);
  const byZone = Object.fromEntries([...zoneArea.entries()].sort(([a], [b]) => a - b));
  const residentialArea =
    (byZone[ZoneKind.residentialLow] ?? 0) + (byZone[ZoneKind.residentialHigh] ?? 0);
  const jobArea =
    (byZone[ZoneKind.commercialLow] ?? 0) +
    (byZone[ZoneKind.commercialHigh] ?? 0) +
    (byZone[ZoneKind.industrial] ?? 0) +
    (byZone[ZoneKind.office] ?? 0);
  const totalZoneArea = Object.values(byZone).reduce((sum, area) => sum + area, 0);
  const commandTickSpan =
    scenario.commands.length === 0 ? 0 : latestCommandTick - earliestCommandTick;

  const coverage: Omit<ScenarioCoverage, "warnings"> = {
    name: scenario.name,
    commandCount: scenario.commands.length,
    latestCommandTick,
    commandTickSpan,
    duplicateSeqs,
    commandTicksMonotone,
    commandsAfterHorizon,
    roads: {
      buildCount: roadBuildCount,
      upgradeCount: roadUpgradeCount,
      bulldozeCount: roadBulldozeCount,
      roadClasses: [...roadClasses].sort((a, b) => a - b),
      bridgeSegments,
    },
    zones: {
      totalArea: totalZoneArea,
      residentialArea,
      jobArea,
      dezoneArea,
      byZone,
    },
    buildings: {
      totalPlaced: buildingsPlaced,
      utilities: utilityBuildings,
      services: serviceBuildings,
      parks: parkBuildings,
      education: educationBuildings,
    },
    terrain,
    operations: {
      speedChanges,
      selections,
      undoRedo,
      serviceBudgetChanges,
      taxChanges,
      loanCommands,
      districtCommands,
    },
  };

  return { ...coverage, warnings: coverageWarnings(coverage) };
}

export function summarizeScenarioCorpus(
  scenarios: readonly GoldenScenario[],
): ScenarioCorpusCoverage {
  const summaries = scenarios.map(summarizeScenarioCoverage);
  const warningsByScenario: Record<string, readonly ScenarioCoverageWarning[]> = {};
  for (const summary of summaries) {
    if (summary.warnings.length > 0) {
      warningsByScenario[summary.name] = summary.warnings;
    }
  }

  return {
    scenarioCount: summaries.length,
    commandCount: summaries.reduce((sum, summary) => sum + summary.commandCount, 0),
    roadScenarioCount: summaries.filter((summary) => summary.roads.buildCount > 0).length,
    zoningScenarioCount: summaries.filter((summary) => summary.zones.totalArea > 0).length,
    utilityScenarioCount: summaries.filter((summary) => summary.buildings.utilities > 0).length,
    serviceScenarioCount: summaries.filter((summary) => summary.buildings.services > 0).length,
    terrainScenarioCount: summaries.filter((summary) => summary.terrain.rects > 0).length,
    stagedSetupScenarioCount: summaries.filter(
      (summary) => summary.commandTickSpan >= STAGED_SETUP_TICK_SPAN,
    ).length,
    warningsByScenario,
  };
}

function coverageWarnings(
  coverage: Omit<ScenarioCoverage, "warnings">,
): readonly ScenarioCoverageWarning[] {
  const warnings: ScenarioCoverageWarning[] = [];
  if (coverage.commandCount === 0) {
    warnings.push("empty-command-log");
  }
  if (coverage.roads.buildCount === 0) {
    warnings.push("no-roads");
  }
  if (coverage.zones.totalArea === 0) {
    warnings.push("no-zoning");
  }
  if (coverage.zones.residentialArea === 0) {
    warnings.push("no-residential-zoning");
  }
  if (coverage.zones.jobArea === 0) {
    warnings.push("no-job-zoning");
  }
  if (coverage.buildings.utilities === 0) {
    warnings.push("no-utilities");
  }
  if (coverage.duplicateSeqs.length > 0) {
    warnings.push("duplicate-seq");
  }
  if (!coverage.commandTicksMonotone) {
    warnings.push("non-monotone-command-ticks");
  }
  if (coverage.commandsAfterHorizon > 0) {
    warnings.push("commands-after-horizon");
  }
  return warnings;
}

function summarizeTerrain(rects: readonly TerrainRect[]): ScenarioTerrainCoverage {
  let elevationTiles = 0;
  let waterTiles = 0;
  let resourceTiles = 0;
  for (const rect of rects) {
    const area = terrainRectArea(rect);
    if (rect.layer === "elevation") {
      elevationTiles += area;
    } else if (rect.layer === "water") {
      waterTiles += area;
    } else {
      resourceTiles += area;
    }
  }
  return { rects: rects.length, elevationTiles, waterTiles, resourceTiles };
}

function addArea(area: Map<number, number>, id: number, amount: number): void {
  area.set(id, (area.get(id) ?? 0) + amount);
}

function rectArea(rect: Pick<Extract<Command, { x0: number }>, "x0" | "y0" | "x1" | "y1">): number {
  return (Math.abs(rect.x1 - rect.x0) + 1) * (Math.abs(rect.y1 - rect.y0) + 1);
}

function terrainRectArea(rect: TerrainRect): number {
  return (Math.abs(rect.x1 - rect.x0) + 1) * (Math.abs(rect.y1 - rect.y0) + 1);
}
