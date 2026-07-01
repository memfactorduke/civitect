import { auditSpriteSidecars, formatAuditSummary } from "./report";

const args = process.argv.slice(2);
const json = args.includes("--json");
const roots = args.filter((arg) => arg !== "--json");

if (roots.length === 0) {
  console.error(
    "usage: pnpm --filter @civitect/sprite-intake report <sidecar-dir-or-file> [--json]",
  );
  process.exitCode = 2;
} else {
  try {
    const summary = await auditSpriteSidecars(roots);
    if (json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      process.stdout.write(formatAuditSummary(summary));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
