import { describe, expect, it } from "vitest";
import { type I18nKey, t } from "./i18n";

function expectLabel(key: string): void {
  const label = t(key as I18nKey);

  expect(label, key).toEqual(expect.any(String));
  expect(label.trim(), key).not.toBe("");
}

describe("i18n key coverage", () => {
  it("covers dynamic UI label families that are cast at call sites", () => {
    const dynamicKeys = [
      ...Array.from({ length: 9 }, (_, i) => `budget.service.${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `overlay.${i + 10}`),
      ...Array.from({ length: 13 }, (_, i) => `report.line.${i + 1}`),
      ...Array.from({ length: 6 }, (_, i) => `tax.zone.${i + 1}`),
      "bankruptcy.bailout",
      "bankruptcy.receivership",
    ];

    for (const key of dynamicKeys) {
      expectLabel(key);
    }
  });

  it("covers demand factor labels used by the demand panel", () => {
    const demandFactorKeys = [
      "demand.factor.jobs",
      "demand.factor.attractiveness",
      "demand.factor.vacancy",
      "demand.factor.purchasing",
      "demand.factor.goods",
      "demand.factor.orders",
      "demand.factor.workforce",
      "demand.factor.educated",
      "demand.factor.admin",
    ];

    for (const key of demandFactorKeys) {
      expectLabel(key);
    }
  });
});
