export interface BalanceSample {
  readonly scenario: string;
  readonly tick: number;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface BalanceBand {
  readonly scenario: string;
  readonly metric: string;
  readonly min?: number;
  readonly max?: number;
}

export interface BalanceInput {
  readonly samples: readonly BalanceSample[];
  readonly bands?: readonly BalanceBand[];
}

export interface MetricSummary {
  readonly scenario: string;
  readonly metric: string;
  readonly samples: number;
  readonly firstTick: number;
  readonly lastTick: number;
  readonly first: number;
  readonly last: number;
  readonly min: number;
  readonly max: number;
  readonly delta: number;
  readonly band: BalanceBand | null;
  readonly status: "pass" | "fail" | "unbounded";
}

export interface BalanceReport {
  readonly summaries: readonly MetricSummary[];
  readonly failures: readonly MetricSummary[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function parseSample(value: unknown, index: number): BalanceSample {
  if (!isObject(value)) {
    throw new Error(`sample ${index} must be an object`);
  }
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    throw new Error(`sample ${index} scenario must be a non-empty string`);
  }
  const tick = parseNumber(value.tick, `sample ${index} tick`);
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(`sample ${index} tick must be a non-negative integer`);
  }
  if (!isObject(value.metrics)) {
    throw new Error(`sample ${index} metrics must be an object`);
  }
  const metrics: Record<string, number> = {};
  for (const [metric, metricValue] of Object.entries(value.metrics)) {
    if (metric.length === 0) {
      throw new Error(`sample ${index} metric names must be non-empty`);
    }
    metrics[metric] = parseNumber(metricValue, `sample ${index} metric ${metric}`);
  }
  return { scenario: value.scenario, tick, metrics };
}

function parseBand(value: unknown, index: number): BalanceBand {
  if (!isObject(value)) {
    throw new Error(`band ${index} must be an object`);
  }
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    throw new Error(`band ${index} scenario must be a non-empty string`);
  }
  if (typeof value.metric !== "string" || value.metric.length === 0) {
    throw new Error(`band ${index} metric must be a non-empty string`);
  }
  const min = value.min === undefined ? undefined : parseNumber(value.min, `band ${index} min`);
  const max = value.max === undefined ? undefined : parseNumber(value.max, `band ${index} max`);
  if (min === undefined && max === undefined) {
    throw new Error(`band ${index} must define min or max`);
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`band ${index} min cannot exceed max`);
  }
  return { scenario: value.scenario, metric: value.metric, min, max };
}

export function parseBalanceInput(value: unknown): BalanceInput {
  const rawSamples = Array.isArray(value) ? value : isObject(value) ? value.samples : undefined;
  if (!Array.isArray(rawSamples)) {
    throw new Error("balance input must be an array or an object with samples");
  }
  const samples = rawSamples.map(parseSample);
  if (samples.length === 0) {
    throw new Error("balance input must include at least one sample");
  }
  const rawBands = isObject(value) && value.bands !== undefined ? value.bands : [];
  if (!Array.isArray(rawBands)) {
    throw new Error("bands must be an array");
  }
  return { samples, bands: rawBands.map(parseBand) };
}

function bandKey(scenario: string, metric: string): string {
  return `${scenario}\u0000${metric}`;
}

function statusFor(value: number, band: BalanceBand | null): MetricSummary["status"] {
  if (band === null) {
    return "unbounded";
  }
  if (band.min !== undefined && value < band.min) {
    return "fail";
  }
  if (band.max !== undefined && value > band.max) {
    return "fail";
  }
  return "pass";
}

export function summarizeBalance(input: BalanceInput): BalanceReport {
  const bands = new Map<string, BalanceBand>();
  for (const band of input.bands ?? []) {
    bands.set(bandKey(band.scenario, band.metric), band);
  }

  const series = new Map<string, BalanceSample[]>();
  for (const sample of input.samples) {
    const group = series.get(sample.scenario);
    if (group === undefined) {
      series.set(sample.scenario, [sample]);
    } else {
      group.push(sample);
    }
  }

  const summaries: MetricSummary[] = [];
  for (const [scenario, samples] of [...series.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    samples.sort((a, b) => a.tick - b.tick);
    const metricNames = new Set<string>();
    for (const sample of samples) {
      for (const metric of Object.keys(sample.metrics)) {
        metricNames.add(metric);
      }
    }
    for (const metric of [...metricNames].sort()) {
      const points = samples
        .filter((sample) => sample.metrics[metric] !== undefined)
        .map((sample) => ({ tick: sample.tick, value: sample.metrics[metric] as number }));
      const first = points[0];
      const last = points.at(-1);
      if (first === undefined || last === undefined) {
        continue;
      }
      const values = points.map((point) => point.value);
      const band = bands.get(bandKey(scenario, metric)) ?? null;
      const status = statusFor(last.value, band);
      summaries.push({
        scenario,
        metric,
        samples: points.length,
        firstTick: first.tick,
        lastTick: last.tick,
        first: first.value,
        last: last.value,
        min: Math.min(...values),
        max: Math.max(...values),
        delta: last.value - first.value,
        band,
        status,
      });
    }
  }

  return {
    summaries,
    failures: summaries.filter((summary) => summary.status === "fail"),
  };
}

function csvCell(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function balanceReportCsv(report: BalanceReport): string {
  const rows = [
    [
      "scenario",
      "metric",
      "samples",
      "firstTick",
      "lastTick",
      "first",
      "last",
      "min",
      "max",
      "delta",
      "bandMin",
      "bandMax",
      "status",
    ],
    ...report.summaries.map((summary) => [
      summary.scenario,
      summary.metric,
      summary.samples,
      summary.firstTick,
      summary.lastTick,
      summary.first,
      summary.last,
      summary.min,
      summary.max,
      summary.delta,
      summary.band?.min ?? null,
      summary.band?.max ?? null,
      summary.status,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
