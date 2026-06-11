/**
 * Determinism ban-rules, scoped to packages/sim ONLY (ADR-005, ADR-007:
 * Biome handles general lint; this config exists solely because the
 * determinism bans aren't expressible as Biome rules yet).
 *
 * Sim escape hatch policy: a justified `eslint-disable-next-line` with an
 * ADR reference in the comment — reviewers treat a bare disable as a defect.
 */
import tsParser from "@typescript-eslint/parser";

// Math members whose results are implementation-defined (TDD §3.1). Math.sqrt
// is deliberately absent: IEEE-754 requires it correctly rounded.
const TRANSCENDENTALS = [
  "random",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "expm1",
  "log",
  "log1p",
  "log2",
  "log10",
  "pow",
  "cbrt",
  "hypot",
];

export default [
  {
    files: ["packages/sim/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "no-restricted-properties": [
        "error",
        ...TRANSCENDENTALS.map((property) => ({
          object: "Math",
          property,
          message: `ADR-005: Math.${property} is implementation-defined (or nondeterministic) — use PCG32 streams (sim/rng), integer math, Q16.16 fixed-point, or shared LUTs.`,
        })),
        {
          object: "Date",
          property: "now",
          message: "ADR-005 §5: no wall clock in sim — the tick counter is time.",
        },
        {
          object: "performance",
          property: "now",
          message: "ADR-005 §5: no wall clock in sim — the tick counter is time.",
        },
        {
          object: "Object",
          property: "keys",
          message:
            "ADR-005 §4: no object-key iteration over sim state. Use explicit ordered lists (e.g. RNG_STREAM_NAMES); if keys are truly needed, sort them and disable this line with an ADR-005 justification.",
        },
        {
          object: "Object",
          property: "values",
          message: "ADR-005 §4: no object-key iteration over sim state (see Object.keys note).",
        },
        {
          object: "Object",
          property: "entries",
          message: "ADR-005 §4: no object-key iteration over sim state (see Object.keys note).",
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "performance",
          message: "ADR-005 §5: no wall clock in sim.",
        },
        {
          name: "window",
          message: "ADR-006: zero DOM in sim (tsconfig has no DOM lib; this is belt-and-braces).",
        },
        {
          name: "document",
          message: "ADR-006: zero DOM in sim.",
        },
        {
          name: "navigator",
          message: "ADR-006: zero DOM in sim.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ForInStatement",
          message:
            "ADR-005 §4: for-in iteration order is not part of the determinism contract — iterate explicit indices or fixed name lists.",
        },
        {
          selector: "BinaryExpression[operator='**']",
          message: "ADR-005: ** is Math.pow in disguise — implementation-defined for non-integers.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "ADR-005 §5: no wall clock in sim — the tick counter is time.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "pixi.js", message: "ADR-006: zero Pixi in sim." },
            { name: "react", message: "ADR-006: zero UI in sim." },
            { name: "react-dom", message: "ADR-006: zero UI in sim." },
          ],
          patterns: [
            {
              group: ["@civitect/renderer", "@civitect/ui", "@civitect/app", "@civitect/backend"],
              message: "ADR-006: sim imports nothing from rendering/UI — protocol only.",
            },
          ],
        },
      ],
    },
  },
];
