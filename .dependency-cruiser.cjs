/**
 * The ADR-006 import wall, mechanically enforced (ADR-007: dependency-cruiser in CI).
 *
 * The one rule that matters: `packages/sim` imports nothing from rendering or UI — ever.
 * Everything else is the protocol-as-only-contract discipline (TDD §1/§7).
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment:
        "Imports that don't resolve are invisible to the path rules below — an undeclared " +
        "workspace import (e.g. sim importing @civitect/renderer without depending on it) " +
        "must fail here rather than slip past the wall.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "sim-wall-packages",
      comment:
        "ADR-006 [LOCKED]: sim imports nothing from renderer/UI/app/backend/assets. " +
        "Cross-boundary communication goes through packages/protocol only.",
      severity: "error",
      from: { path: "^packages/sim" },
      to: { path: "^packages/(renderer|ui|app|backend|assets)" },
    },
    {
      name: "sim-wall-dom-libs",
      comment: "ADR-006: zero DOM, zero Pixi, zero React inside the sim core.",
      severity: "error",
      from: { path: "^packages/sim" },
      to: { path: "node_modules/(pixi\\.js|react|react-dom)" },
    },
    {
      name: "protocol-depends-on-nothing",
      comment:
        "TDD §1: protocol is the contract — shared types + codecs. It may not depend on any " +
        "other workspace package, or the contract stops being neutral ground.",
      severity: "error",
      from: { path: "^packages/protocol" },
      to: { path: "^packages/(?!protocol)" },
    },
    {
      name: "renderer-via-protocol-only",
      comment:
        "TDD §1: renderer consumes snapshots, knows nothing of rules. No sim/ui/app imports.",
      severity: "error",
      from: { path: "^packages/renderer" },
      to: { path: "^packages/(sim|ui|app|backend)" },
    },
    {
      name: "ui-via-protocol-only",
      comment: "TDD §9: UI talks to sim only via protocol commands. No sim/renderer imports.",
      severity: "error",
      from: { path: "^packages/ui" },
      to: { path: "^packages/(sim|renderer|app|backend)" },
    },
    {
      name: "backend-via-protocol-only",
      comment: "ADR-011: backend touches save blobs/metadata via protocol types only.",
      severity: "error",
      from: { path: "^packages/backend" },
      to: { path: "^packages/(sim|renderer|ui|app)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
