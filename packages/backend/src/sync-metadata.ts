/**
 * Provider-neutral cloud save metadata boundary (ADR-011, TDD 10).
 *
 * The future Supabase adapter can feed raw rows into this module before any
 * sync policy or storage operation sees them. That keeps malformed cloud rows
 * from becoming silent data-loss or cross-account path bugs.
 */

export interface CloudSaveMetadata {
  readonly cityId: string;
  readonly deviceId: string;
  readonly generation: number;
  readonly simVersion: number;
  readonly updatedAtMs: number;
  readonly thumbnailUrl?: string;
}

export class CloudSaveMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudSaveMetadataError";
  }
}

type RowRecord = Record<string, unknown>;

const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

function assertRecord(row: unknown): RowRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new CloudSaveMetadataError("cloud save metadata must be an object");
  }
  return row as RowRecord;
}

function readField(row: RowRecord, camelName: string, snakeName: string): unknown {
  if (Object.hasOwn(row, camelName)) {
    return row[camelName];
  }
  return row[snakeName];
}

function readRequiredString(row: RowRecord, camelName: string, snakeName: string): string {
  const value = readField(row, camelName, snakeName);
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new CloudSaveMetadataError(`${camelName} must be a non-empty string`);
  }
  return value;
}

function readOptionalHttpUrl(
  row: RowRecord,
  camelName: string,
  snakeName: string,
): string | undefined {
  const value = readField(row, camelName, snakeName);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new CloudSaveMetadataError(`${camelName} must be an HTTP(S) URL when present`);
  }
  if (!HTTP_URL_PATTERN.test(value)) {
    throw new CloudSaveMetadataError(`${camelName} must be an HTTP(S) URL when present`);
  }
  return value;
}

function readNonNegativeInteger(row: RowRecord, camelName: string, snakeName: string): number {
  const value = readField(row, camelName, snakeName);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CloudSaveMetadataError(`${camelName} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeUpdatedAt(value: unknown): number {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) {
      return time;
    }
  }

  if (typeof value === "string" && value.length > 0 && value.trim() === value) {
    const time = Date.parse(value);
    if (Number.isFinite(time)) {
      return time;
    }
  }

  throw new CloudSaveMetadataError("updatedAt must be an ISO timestamp or Date");
}

function encodeStorageSegment(label: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new CloudSaveMetadataError(`${label} must be a non-empty path segment`);
  }
  return encodeURIComponent(value);
}

function assertGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new CloudSaveMetadataError("generation must be a non-negative safe integer");
  }
}

export function normalizeCloudSaveMetadata(row: unknown): CloudSaveMetadata {
  const record = assertRecord(row);
  const thumbnailUrl = readOptionalHttpUrl(record, "thumbnailUrl", "thumbnail_url");
  const metadata: CloudSaveMetadata = {
    cityId: readRequiredString(record, "cityId", "city_id"),
    deviceId: readRequiredString(record, "deviceId", "device_id"),
    generation: readNonNegativeInteger(record, "generation", "generation"),
    simVersion: readNonNegativeInteger(record, "simVersion", "sim_version"),
    updatedAtMs: normalizeUpdatedAt(readField(record, "updatedAt", "updated_at")),
  };
  if (thumbnailUrl !== undefined) {
    return { ...metadata, thumbnailUrl };
  }
  return metadata;
}

export function buildCloudSaveBlobPath(userId: string, cityId: string, generation: number): string {
  assertGeneration(generation);
  return [
    "users",
    encodeStorageSegment("userId", userId),
    "cities",
    encodeStorageSegment("cityId", cityId),
    `generation-${generation}.civ`,
  ].join("/");
}
