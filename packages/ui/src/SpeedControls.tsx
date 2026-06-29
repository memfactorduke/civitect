/**
 * Speed controls: pause/1×/3×/9× (GDD §13 tiers as carried by sim
 * SIM_SPEEDS — the UI lists them statically; the sim remains the validator
 * and will reject anything else with a reason code).
 */
import { CommandType } from "@civitect/protocol";
import type { ReactNode } from "react";
import { useDispatch } from "./dispatch";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

const TIERS: readonly { speed: number; label: I18nKey }[] = [
  { speed: 0, label: "speed.pause" },
  { speed: 1, label: "speed.normal" },
  { speed: 3, label: "speed.fast" },
  { speed: 9, label: "speed.fastest" },
];

export function SpeedControls(props: { readonly store: UiStore }): ReactNode {
  const current = useUiStore(props.store, (s) => s.speed);
  const dispatch = useDispatch();

  return (
    <fieldset aria-label={t("hud.speed")}>
      <legend>{t("hud.speed")}</legend>
      {TIERS.map((tier) => {
        const isCurrent = current === tier.speed;
        return (
          <button
            key={tier.speed}
            type="button"
            aria-pressed={isCurrent}
            data-speed={tier.speed}
            data-testid={`speed-control-${tier.speed}`}
            disabled={isCurrent}
            onClick={() => {
              if (!isCurrent) {
                dispatch({ type: CommandType.setSpeed, speed: tier.speed });
              }
            }}
          >
            {t(tier.label)}
          </button>
        );
      })}
    </fieldset>
  );
}
