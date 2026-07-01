/**
 * Transit network (GDD §9, board phase-6 task 1b interface; vehicles, mode
 * choice + per-line economics land in task 4). CANONICAL line config + ledger
 * accumulators, hashed and saved (v11 TRANSIT). All integer/string, no RNG.
 *
 * A line is an ordered list of stop tiles for a mode; the per-line ledger
 * (riders/cost/fare) is filled by the task-4 economics. Line ids are
 * UI-chosen (validated here) and `nextLineId` keeps a monotone suggestion.
 */
export interface TransitLine {
  id: number;
  mode: number;
  color: number;
  name: string;
  /** Stop tiles in order. */
  stops: number[];
  vehicles: number;
  headwayTicks: number;
  /** Canonical economics accumulators (task 4 fills). */
  riders: number;
  costCents: number;
  fareCents: number;
}

export interface TransitState {
  lines: TransitLine[];
  nextLineId: number;
}

export function createTransit(): TransitState {
  return { lines: [], nextLineId: 1 };
}

export function lineById(t: TransitState, id: number): TransitLine | undefined {
  for (const line of t.lines) {
    if (line.id === id) {
      return line;
    }
  }
  return undefined;
}
