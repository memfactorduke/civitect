/**
 * Service budget sliders (GDD §7: 50–150%, diminishing returns above 100%).
 * Sliders dispatch setServiceBudget commands — the sim is authoritative;
 * the local value is an optimistic ghost like every other intent.
 */
import { CommandType, SERVICE_ID_LIST, type ServiceId } from "@civitect/protocol";
import { type ReactNode, useState } from "react";
import { useDispatch } from "./dispatch";
import { t } from "./i18n";

export function BudgetPanel(): ReactNode {
  const dispatch = useDispatch();
  const [budgets, setBudgets] = useState<Record<number, number>>({});
  return (
    <details data-testid="budget-panel">
      <summary>{t("budget.title")}</summary>
      <ul>
        {SERVICE_ID_LIST.map((service) => {
          const value = budgets[service] ?? 1000;
          return (
            <li key={service}>
              <label>
                {t(`budget.service.${service}` as Parameters<typeof t>[0])}
                <input
                  type="range"
                  min={500}
                  max={1500}
                  step={50}
                  value={value}
                  data-testid={`budget-slider-${service}`}
                  onChange={(event) => {
                    const permille = Number(event.target.value);
                    setBudgets((prev) => ({ ...prev, [service]: permille }));
                    dispatch({
                      type: CommandType.setServiceBudget,
                      service: service as ServiceId,
                      permille,
                    });
                  }}
                />
                <span data-testid={`budget-value-${service}`}>{(value / 10).toFixed(0)}%</span>
              </label>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
