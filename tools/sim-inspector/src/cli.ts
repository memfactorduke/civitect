import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectArtifact } from "./index";

function usage(): string {
  return [
    "Usage: pnpm --filter @civitect/sim-inspector inspect -- <artifact> [artifact...]",
    "",
    "Artifacts may be .civmap map files or .civ save files.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(args.length === 0 ? 1 : 0);
}

const inspections = [];
const invocationCwd = process.env.INIT_CWD ?? process.cwd();
for (const file of args) {
  const path = resolve(invocationCwd, file);
  const bytes = new Uint8Array(await readFile(path));
  inspections.push(await inspectArtifact(bytes, file));
}

console.log(JSON.stringify(inspections.length === 1 ? inspections[0] : inspections, null, 2));
