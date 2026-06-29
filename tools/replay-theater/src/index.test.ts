import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CommandType } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { parseReplayDocument, replayTerrain, replayTimelineHtml, replayToTimeline } from "./index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(ROOT, "fixtures", "simple-replay.json");

function fixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

describe("replay theater", () => {
  it("parses terrain and named commands from bug-report JSON", () => {
    const replay = parseReplayDocument(fixture(), fixturePath);
    const terrain = replayTerrain(replay);

    expect(replay.name).toBe("simple-replay");
    expect(replay.commands).toHaveLength(4);
    expect(replay.commands[0]?.type).toBe(CommandType.buildRoad);
    expect(terrain.layers.water[0]).toBe(1);
    expect(terrain.layers.water[2]).toBe(0);
  });

  it("accepts numeric protocol command ids", () => {
    const replay = parseReplayDocument(
      {
        name: "numeric-id",
        seed: 1,
        mapWidth: 8,
        mapHeight: 8,
        untilTick: 2,
        commands: [{ seq: 1, tick: 0, type: CommandType.setSpeed, speed: 1 }],
      },
      "numeric-id",
    );

    expect(replay.commands[0]?.type).toBe(CommandType.setSpeed);
  });

  it("builds a deterministic scrub timeline", async () => {
    const replay = parseReplayDocument(fixture(), fixturePath);
    const report = await replayToTimeline(replay, { sampleEveryTicks: 10 });
    const repeat = await replayToTimeline(replay, { sampleEveryTicks: 10 });

    expect(report.frameCount).toBeGreaterThan(1);
    expect(report.frames[0]?.tick).toBe(0);
    expect(report.final.tick).toBe(80);
    expect(report.final.hash).toBe(repeat.final.hash);
    expect(report.commandCount).toBe(4);
    expect(report.final.roads.edges).toBeGreaterThan(0);
    expect(report.final.commandsRun).toBe(4);
  });

  it("renders self-contained HTML with escaped JSON data", async () => {
    const replay = parseReplayDocument(
      {
        name: "script-close</script>",
        seed: 1,
        mapWidth: 8,
        mapHeight: 8,
        untilTick: 1,
        commands: [],
      },
      "html-replay",
    );
    const report = await replayToTimeline(replay);
    const html = replayTimelineHtml(report);

    expect(html).toContain('id="scrubber"');
    expect(html).toContain('type="application/json"');
    expect(html).toContain("script-close&lt;/script&gt;");
    expect(html).toContain("script-close\\u003c/script\\u003e");
  });

  it("rejects commands that would silently fall outside the replay horizon", () => {
    expect(() =>
      parseReplayDocument(
        {
          name: "bad-tail",
          seed: 1,
          mapWidth: 8,
          mapHeight: 8,
          untilTick: 5,
          commands: [{ seq: 1, tick: 5, type: "setSpeed", speed: 1 }],
        },
        "bad-tail",
      ),
    ).toThrow(/will not run before untilTick/);
  });

  it("rejects malformed terrain rects before replaying", () => {
    expect(() =>
      parseReplayDocument(
        {
          name: "bad-terrain",
          seed: 1,
          mapWidth: 8,
          mapHeight: 8,
          untilTick: 5,
          terrainRects: [{ layer: "zone", x0: 0, y0: 0, x1: 1, y1: 1, value: 1 }],
          commands: [],
        },
        "bad-terrain",
      ),
    ).toThrow(/layer must be elevation, water, or resource/);
  });
});
