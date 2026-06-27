import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseReplayDocument, replayTimelineHtml, replayToTimeline } from "./index";

interface CliOptions {
  readonly input: string;
  readonly html?: string;
  readonly sampleEveryTicks?: number;
  readonly maxFrames?: number;
}

const USAGE = `Usage:
  pnpm --filter @civitect/replay-theater render -- [--sample-every N] [--max-frames N] [--html out.html] replay.json

When --html is omitted, the command prints the replay timeline JSON.`;

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (value === undefined) {
    throw new Error(`${flag} needs a value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let html: string | undefined;
  let sampleEveryTicks: number | undefined;
  let maxFrames: number | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(USAGE);
    }
    if (arg === "--html") {
      html = argv[++i];
      if (html === undefined) {
        throw new Error("--html needs a value");
      }
      continue;
    }
    if (arg === "--sample-every") {
      sampleEveryTicks = parsePositiveInt(argv[++i], "--sample-every");
      continue;
    }
    if (arg === "--max-frames") {
      maxFrames = parsePositiveInt(argv[++i], "--max-frames");
      continue;
    }
    if (arg?.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    }
    if (arg !== undefined) {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    throw new Error(USAGE);
  }
  const input = positional[0];
  if (input === undefined) {
    throw new Error(USAGE);
  }
  return { input, html, sampleEveryTicks, maxFrames };
}

function workingDirectory(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const cwd = workingDirectory();
  const inputPath = resolve(cwd, options.input);
  const raw = await readFile(inputPath, "utf8");
  const replay = parseReplayDocument(JSON.parse(raw) as unknown, inputPath);
  const report = await replayToTimeline(replay, {
    sampleEveryTicks: options.sampleEveryTicks,
    maxFrames: options.maxFrames,
  });

  if (options.html !== undefined) {
    const outputPath = resolve(cwd, options.html);
    await writeFile(outputPath, replayTimelineHtml(report));
    console.log(
      JSON.stringify(
        {
          output: outputPath,
          frameCount: report.frameCount,
          finalTick: report.final.tick,
          finalHash: report.final.hash,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 2;
  });
}
