/**
 * Archetype scenarios (board phase-5 task 6, ADR-013 §3 / GDD §17): five
 * deliberately-different cities that stress different corners of the Phase 5
 * economy. Each is built programmatically (a command log over a 64×64 map)
 * rather than as a hand-keyed JSON — the SHAPE is the point, and code keeps
 * the five readable side by side.
 *
 * The per-PR gate runs each a couple of game-years inside balance BANDS; the
 * weekly/dispatchable gate runs the full 20-game-year horizon (the exit
 * criterion). Bands are [TUNE] — loose enough to be a regression tripwire,
 * not a fragile snapshot.
 */
import { CommandType } from "@civitect/protocol";

export const MAP = 64;
export const TICKS_PER_GAME_YEAR = 525_600;

/** A command minus seq/tick — the builder stamps both in declaration order.
 *  (string values allow transit line names alongside the numeric fields.) */
type Cmd = Record<string, number | string>;

export interface Archetype {
  readonly name: string;
  readonly seed: number;
  readonly startingFundsCents: number;
  /** Built command log, tick-0 stamped (the harness compresses the build). */
  readonly commands: readonly { seq: number; tick: number }[];
  /** What this archetype must demonstrate, checked after the run. */
  readonly bands: ArchetypeBands;
}

export interface ArchetypeBands {
  readonly minPopulation: number;
  readonly maxPopulation: number;
  /** Treasury must never end below this (knife-edge solvency). */
  readonly minFundsCents: number;
  /** At least this many of the dominant building kind (0 = unchecked). */
  readonly minDominantKind?: { readonly zone: number; readonly count: number };
  /** Peak transit ridership (max traffic.ridden over the run) the line must
   *  sustain — the mode-choice tripwire (task 4a). Omitted = no assertion. [TUNE] */
  readonly minRidden?: number;
}

function log(cmds: Cmd[]): { seq: number; tick: number }[] {
  return cmds.map((c, i) => ({ ...c, seq: i, tick: 0 }) as { seq: number; tick: number });
}

/** A full-perimeter + cross road grid: outside connections on every edge. */
function gridRoads(roadClass: number): Cmd[] {
  const e = MAP - 1;
  const lines: Cmd[] = [];
  for (const y of [0, 16, 32, 48, e]) {
    lines.push({ type: CommandType.buildRoad, ax: 0, ay: y, bx: e, by: y, roadClass });
  }
  for (const x of [0, 16, 32, 48, e]) {
    lines.push({ type: CommandType.buildRoad, ax: x, ay: 0, bx: x, by: e, roadClass });
  }
  return lines;
}

function power(x: number, y: number): Cmd[] {
  return [
    { type: CommandType.placeBuilding, x, y, building: 1 }, // power plant
    { type: CommandType.placeBuilding, x: x + 2, y, building: 2 }, // water pump
  ];
}

function zone(x0: number, y0: number, x1: number, y1: number, z: number): Cmd {
  return { type: CommandType.zoneRect, x0, y0, x1, y1, zone: z };
}

// Zones are kept MODEST (a few ~12-tile blocks) so each archetype caps at a
// few thousand population in a couple of game-years — fast enough for the
// per-PR gate, while the 20-year weekly run lets them mature. Every city has a
// housing↔jobs balance or it can't grow at all (jobs pull immigration).

/** 1 R-SPRAWL SUBURB: housing-dominant, a small commercial/industrial job core
 *  the suburb commutes to. */
function rSprawl(): Archetype {
  const cmds: Cmd[] = [
    ...gridRoads(1),
    ...power(2, 1),
    zone(2, 2, 14, 14, 1),
    zone(18, 2, 30, 14, 1),
    zone(2, 18, 14, 30, 1),
    zone(50, 18, 62, 30, 3), // commercial jobs
    zone(50, 2, 62, 14, 5), // a little industry for jobs
  ];
  return {
    name: "r-sprawl-suburb",
    seed: 1001,
    startingFundsCents: 1_000_000_00,
    commands: log(cmds),
    bands: { minPopulation: 400, maxPopulation: 200_000, minFundsCents: -20_000_000_00 },
  };
}

/** 2 INDUSTRY-FREIGHT TOWN: industry-heavy + border roads ⇒ active chain. */
function industryFreight(): Archetype {
  const cmds: Cmd[] = [
    ...gridRoads(2),
    ...power(2, 1),
    zone(2, 2, 16, 16, 1), // workers
    zone(34, 2, 50, 24, 5), // industrial belt
    zone(2, 34, 16, 46, 3), // retail
  ];
  return {
    name: "industry-freight-town",
    seed: 2002,
    startingFundsCents: 1_000_000_00,
    commands: log(cmds),
    bands: {
      minPopulation: 300,
      maxPopulation: 90_000,
      minFundsCents: -15_000_000_00,
      minDominantKind: { zone: 5, count: 12 },
    },
  };
}

/** 3 OFFICE/EDUCATION CITY: schools feed office jobs; commerce bootstraps it. */
function officeEducation(): Archetype {
  const cmds: Cmd[] = [
    ...gridRoads(2),
    ...power(2, 1),
    { type: CommandType.placeBuilding, x: 6, y: 6, building: 13 }, // university
    { type: CommandType.placeBuilding, x: 10, y: 6, building: 12 }, // high school
    { type: CommandType.placeBuilding, x: 6, y: 10, building: 11 }, // elementary
    zone(2, 14, 18, 30, 1), // housing
    zone(34, 14, 50, 30, 3), // commercial bootstrap (early jobs)
    zone(34, 2, 50, 12, 6), // office district (needs educated labour)
  ];
  return {
    name: "office-education-city",
    seed: 3003,
    startingFundsCents: 1_000_000_00,
    commands: log(cmds),
    bands: { minPopulation: 250, maxPopulation: 90_000, minFundsCents: -15_000_000_00 },
  };
}

/** 4 TOURISM-PARKS RESORT: parks + commerce + outside connections ⇒ tourists. */
function tourismParks(): Archetype {
  const cmds: Cmd[] = [
    ...gridRoads(2),
    ...power(2, 1),
    zone(2, 2, 16, 16, 1),
    zone(34, 2, 50, 16, 3), // commerce for tourists to spend at
    // A ribbon of parks (kind 15 small park, 16 plaza) for attractiveness.
    ...[20, 24, 28, 38, 42, 46].flatMap((x) => [
      { type: CommandType.placeBuilding, x, y: 34, building: 15 },
      { type: CommandType.placeBuilding, x, y: 38, building: 16 },
    ]),
  ];
  return {
    name: "tourism-parks-resort",
    seed: 4004,
    startingFundsCents: 1_000_000_00,
    commands: log(cmds),
    bands: { minPopulation: 300, maxPopulation: 80_000, minFundsCents: -15_000_000_00 },
  };
}

/** 5 LEAN-BUDGET KNIFE-EDGE: tight funds, must stay solvent (or recover). */
function leanBudget(): Archetype {
  const cmds: Cmd[] = [
    ...gridRoads(1), // cheap streets only
    ...power(2, 1),
    zone(2, 2, 18, 18, 1),
    zone(34, 2, 46, 14, 3),
    zone(34, 18, 46, 30, 5),
  ];
  return {
    name: "lean-budget-knife-edge",
    seed: 5005,
    startingFundsCents: 300_000_00, // Ironclad-tight
    commands: log(cmds),
    // The knife-edge: it may dip, but a bailout city recovers — it must not
    // end in unbounded debt.
    bands: { minPopulation: 150, maxPopulation: 60_000, minFundsCents: -3_000_000_00 },
  };
}

/** 6 TRANSIT-FIRST CITY: housing on the west, jobs on the east, a crosstown bus
 *  down the corridor — the signature mode-choice tripwire (task 4a). The line
 *  must carry riders across the game-years, not just at one peak snapshot. */
function transitFirst(): Archetype {
  const cmds: Cmd[] = [
    ...gridRoads(1),
    ...power(2, 1),
    zone(2, 2, 20, 14, 1), // R (west)
    zone(2, 18, 20, 30, 1), // more R (west)
    zone(44, 2, 62, 14, 5), // industrial jobs (east)
    zone(44, 18, 62, 30, 3), // commercial jobs (east)
    // A crosstown bus: a stop by the west housing and one by the east jobs.
    { type: CommandType.createLine, lineId: 1, mode: 1, color: 0x2e86de, name: "Crosstown" },
    { type: CommandType.addStop, lineId: 1, tileIdx: 16 * MAP + 8 },
    { type: CommandType.addStop, lineId: 1, tileIdx: 16 * MAP + 56 },
    { type: CommandType.setLineVehicles, lineId: 1, vehicles: 8, headwayTicks: 20 },
  ];
  return {
    name: "transit-first-city",
    seed: 4242,
    startingFundsCents: 2_000_000_00,
    commands: log(cmds),
    bands: {
      minPopulation: 400,
      maxPopulation: 120_000,
      minFundsCents: -20_000_000_00,
      // Peak was ~1410 at 2 game-years; a loose floor that catches transit
      // collapsing (not a fragile snapshot). [TUNE]
      minRidden: 500,
    },
  };
}

export const ARCHETYPES: readonly Archetype[] = [
  rSprawl(),
  industryFreight(),
  officeEducation(),
  tourismParks(),
  leanBudget(),
  transitFirst(),
];
