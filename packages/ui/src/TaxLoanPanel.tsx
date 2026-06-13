/**
 * Tax + loan panel (GDD §8/§13, board phase-5 task 5). Tax sliders dispatch
 * setTaxRate per zone (10–290‰, the sim's domain); loan buttons dispatch
 * takeLoan/repayLoan. Every value is an OPTIMISTIC GHOST — the sim is
 * authoritative (TDD §9), the local state just keeps the slider responsive.
 *
 * The loan controls only show once loans are unlocked (milestone block's
 * unlock mask, task 4): the UI gates the tool the sim also gates.
 */
import { CommandType, type ZoneKind } from "@civitect/protocol";
import { type ReactNode, useState } from "react";
import { useDispatch } from "./dispatch";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

const ZONES = [1, 2, 3, 4, 5, 6] as const;
const LOAN_TIERS = [1, 2, 3] as const;
const UNLOCK_LOANS = 1 << 1; // Unlock.loans (kept in sync with sim progression)

export function TaxLoanPanel(props: { readonly store: UiStore }): ReactNode {
  const dispatch = useDispatch();
  const unlockedMask = useUiStore(props.store, (s) => s.milestone?.unlockedMask ?? 0);
  const [rates, setRates] = useState<Record<number, number>>({});
  const loansUnlocked = (unlockedMask & UNLOCK_LOANS) !== 0;
  return (
    <section aria-label={t("tax.title")} data-testid="tax-loan-panel">
      <h2>{t("tax.title")}</h2>
      <ul>
        {ZONES.map((zone) => {
          const permille = rates[zone] ?? 90;
          return (
            <li key={zone}>
              <label>
                {t(`tax.zone.${zone}` as I18nKey)}
                <input
                  type="range"
                  min={10}
                  max={290}
                  step={10}
                  value={permille}
                  data-testid={`tax-slider-${zone}`}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setRates((prev) => ({ ...prev, [zone]: next }));
                    dispatch({
                      type: CommandType.setTaxRate,
                      zone: zone as ZoneKind,
                      permille: next,
                    });
                  }}
                />
                <span data-testid={`tax-value-${zone}`}>{(permille / 10).toFixed(0)}%</span>
              </label>
            </li>
          );
        })}
      </ul>
      {loansUnlocked && (
        <div data-testid="loan-controls">
          <h3>{t("loan.title")}</h3>
          {LOAN_TIERS.map((tier) => (
            <span key={tier}>
              <button
                type="button"
                data-testid={`loan-take-${tier}`}
                onClick={() => dispatch({ type: CommandType.takeLoan, tier })}
              >
                {t("loan.take")} {t("loan.tier")} {tier}
              </button>
              <button
                type="button"
                data-testid={`loan-repay-${tier}`}
                onClick={() => dispatch({ type: CommandType.repayLoan, tier })}
              >
                {t("loan.repay")} {tier}
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
