/**
 * The demand panel (GDD §6 [LOCKED]: "shows the FACTORS, not just bars").
 * Exit criterion 3 lives here: displayed factors sum to displayed demand —
 * asserted by an RTL property over arbitrary demand blocks.
 */
import type { ReactNode } from "react";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

const SECTORS: readonly { key: "r" | "c" | "i" | "o"; label: I18nKey; from: number }[] = [
  { key: "r", label: "demand.residential", from: 0 },
  { key: "c", label: "demand.commercial", from: 3 },
  { key: "i", label: "demand.industrial", from: 6 },
  { key: "o", label: "demand.office", from: 9 },
];

const FACTOR_LABELS: readonly I18nKey[] = [
  "demand.factor.jobs",
  "demand.factor.attractiveness",
  "demand.factor.vacancy",
  "demand.factor.purchasing",
  "demand.factor.goods",
  "demand.factor.vacancy",
  "demand.factor.orders",
  "demand.factor.workforce",
  "demand.factor.vacancy",
  "demand.factor.educated",
  "demand.factor.admin",
  "demand.factor.vacancy",
];

export function DemandPanel(props: { readonly store: UiStore }): ReactNode {
  const demand = useUiStore(props.store, (s) => s.demand);
  return (
    <section aria-label={t("demand.title")}>
      <h2>{t("demand.title")}</h2>
      {SECTORS.map((sector) => (
        <div key={sector.key}>
          <strong>
            {t(sector.label)}:{" "}
            <output data-testid={`demand-${sector.key}`}>{demand[sector.key]}</output>
          </strong>
          <ul>
            {[0, 1, 2].map((offset) => (
              <li key={offset}>
                {t(FACTOR_LABELS[sector.from + offset] as I18nKey)}:{" "}
                <output data-testid={`demand-${sector.key}-f${offset}`}>
                  {demand.factors[sector.from + offset] ?? 0}
                </output>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
