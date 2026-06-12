/**
 * Coverage overlay selector (GDD §15: every service coverage one tap from
 * the HUD). Selection is PRESENTATION state — it travels as an
 * overlayRequest message (the viewportHint pattern), never as a command.
 */
import { SERVICE_ID_LIST } from "@civitect/protocol";
import { type ReactNode, useState } from "react";
import { t } from "./i18n";

export function OverlayPicker(props: { readonly onSelect: (service: number) => void }): ReactNode {
  const [active, setActive] = useState(0);
  const pick = (service: number): void => {
    setActive(service);
    props.onSelect(service);
  };
  return (
    <nav aria-label={t("overlayPicker.title")} data-testid="overlay-picker">
      <button
        type="button"
        data-testid="overlay-off"
        aria-pressed={active === 0}
        onClick={() => pick(0)}
      >
        {t("overlayPicker.off")}
      </button>
      {SERVICE_ID_LIST.map((service) => (
        <button
          type="button"
          key={service}
          data-testid={`overlay-pick-${service}`}
          aria-pressed={active === service}
          onClick={() => pick(service)}
        >
          {t(`budget.service.${service}` as Parameters<typeof t>[0])}
        </button>
      ))}
    </nav>
  );
}
