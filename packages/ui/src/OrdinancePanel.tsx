/**
 * City-wide ordinance controls (GDD §11): these are global policy bits, not
 * district-specific policies. The UI keeps optimistic checkbox state while the
 * sim remains authoritative through the setOrdinance protocol command.
 */
import { CommandType } from "@civitect/protocol";
import { type ReactNode, useState } from "react";
import { useDispatch } from "./dispatch";
import { type I18nKey, t } from "./i18n";

const ORDINANCES: readonly { bit: number; label: I18nKey; help: I18nKey }[] = [
  {
    bit: 0,
    label: "ordinance.smokeDetectors",
    help: "ordinance.smokeDetectors.help",
  },
  {
    bit: 1,
    label: "ordinance.recycling",
    help: "ordinance.recycling.help",
  },
  {
    bit: 2,
    label: "ordinance.waterRestrictions",
    help: "ordinance.waterRestrictions.help",
  },
  {
    bit: 3,
    label: "ordinance.powerConservation",
    help: "ordinance.powerConservation.help",
  },
];

export function OrdinancePanel(): ReactNode {
  const dispatch = useDispatch();
  const [mask, setMask] = useState(0);

  return (
    <details data-testid="ordinance-panel">
      <summary>{t("ordinance.title")}</summary>
      <ul>
        {ORDINANCES.map((ordinance) => {
          const bitMask = 1 << ordinance.bit;
          const checked = (mask & bitMask) !== 0;
          return (
            <li key={ordinance.bit}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  data-testid={`ordinance-toggle-${ordinance.bit}`}
                  onChange={(event) => {
                    const on = event.target.checked ? 1 : 0;
                    setMask((prev) => (on === 1 ? prev | bitMask : prev & ~bitMask));
                    dispatch({ type: CommandType.setOrdinance, ordinance: ordinance.bit, on });
                  }}
                />
                <span>{t(ordinance.label)}</span>
              </label>
              <small>{t(ordinance.help)}</small>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
