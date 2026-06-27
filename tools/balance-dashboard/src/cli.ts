import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { balanceReportCsv, parseBalanceInput, summarizeBalance } from "./index";

function usage(): string {
  return [
    "Usage: pnpm --filter @civitect/balance-dashboard report -- [--csv] <balance-samples.json>",
    "",
    "Input may be an array of samples or an object with samples and optional bands.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(usage());
  process.exit(args.length === 0 ? 1 : 0);
}

const csv = args.includes("--csv");
const files = args.filter((arg) => arg !== "--csv");
if (files.length !== 1) {
  console.error(usage());
  process.exit(1);
}

const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const path = resolve(invocationCwd, files[0] as string);
const input = parseBalanceInput(JSON.parse(await readFile(path, "utf8")));
const report = summarizeBalance(input);

console.log(csv ? balanceReportCsv(report) : JSON.stringify(report, null, 2));
if (report.failures.length > 0) {
  process.exitCode = 2;
}
