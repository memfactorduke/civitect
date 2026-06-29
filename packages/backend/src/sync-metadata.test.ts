import { describe, expect, it } from "vitest";
import {
  buildCloudSaveBlobPath,
  CloudSaveMetadataError,
  normalizeCloudSaveMetadata,
} from "./sync-metadata";

describe("cloud save metadata boundary", () => {
  it("normalizes app-shaped metadata into sync-policy friendly values", () => {
    expect(
      normalizeCloudSaveMetadata({
        cityId: "city-1",
        deviceId: "desktop-1",
        generation: 12,
        simVersion: 4,
        thumbnailUrl: "https://cdn.example.test/thumbs/city-1.png",
        updatedAt: "2026-06-29T08:30:00.000Z",
      }),
    ).toEqual({
      cityId: "city-1",
      deviceId: "desktop-1",
      generation: 12,
      simVersion: 4,
      thumbnailUrl: "https://cdn.example.test/thumbs/city-1.png",
      updatedAtMs: Date.UTC(2026, 5, 29, 8, 30, 0),
    });
  });

  it("normalizes Supabase-style snake_case rows without leaking provider shape", () => {
    expect(
      normalizeCloudSaveMetadata({
        city_id: "city-2",
        device_id: "phone-1",
        generation: 3,
        sim_version: 8,
        thumbnail_url: null,
        updated_at: new Date("2026-06-29T09:15:30.000Z"),
      }),
    ).toEqual({
      cityId: "city-2",
      deviceId: "phone-1",
      generation: 3,
      simVersion: 8,
      updatedAtMs: Date.UTC(2026, 5, 29, 9, 15, 30),
    });
  });

  it("rejects rows that cannot safely participate in sync", () => {
    const valid = {
      cityId: "city-1",
      deviceId: "desktop-1",
      generation: 0,
      simVersion: 1,
      updatedAt: "2026-06-29T08:30:00.000Z",
    };

    expect(() => normalizeCloudSaveMetadata(null)).toThrow(CloudSaveMetadataError);
    expect(() => normalizeCloudSaveMetadata({ ...valid, cityId: "" })).toThrow(
      CloudSaveMetadataError,
    );
    expect(() => normalizeCloudSaveMetadata({ ...valid, generation: 1.5 })).toThrow(
      CloudSaveMetadataError,
    );
    expect(() => normalizeCloudSaveMetadata({ ...valid, simVersion: -1 })).toThrow(
      CloudSaveMetadataError,
    );
    expect(() => normalizeCloudSaveMetadata({ ...valid, updatedAt: "not-a-date" })).toThrow(
      CloudSaveMetadataError,
    );
    expect(() =>
      normalizeCloudSaveMetadata({ ...valid, thumbnailUrl: "javascript:alert(1)" }),
    ).toThrow(CloudSaveMetadataError);
  });

  it("builds user-scoped save blob paths with encoded segments", () => {
    expect(buildCloudSaveBlobPath("user@example.test", "city/alpha", 4)).toBe(
      "users/user%40example.test/cities/city%2Falpha/generation-4.civ",
    );
  });

  it("rejects unsafe storage path inputs", () => {
    expect(() => buildCloudSaveBlobPath("", "city-1", 1)).toThrow(CloudSaveMetadataError);
    expect(() => buildCloudSaveBlobPath("user-1", " city-1", 1)).toThrow(CloudSaveMetadataError);
    expect(() => buildCloudSaveBlobPath("user-1", "city-1", -1)).toThrow(CloudSaveMetadataError);
  });
});
