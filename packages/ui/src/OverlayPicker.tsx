/**
 * Coverage overlay selector (GDD §15: every service coverage one tap from
 * the HUD). Selection is PRESENTATION state — it travels as an
 * overlayRequest message (the viewportHint pattern), never as a command.
 */
import { OverlayId, SERVICE_ID_LIST } from "@civitect/protocol";
import { type ReactNode, useState } from "react";
import { type I18nKey, t } from "./i18n";

interface OverlayLegend {
  readonly id: number;
  readonly labelKey: I18nKey;
  readonly scaleKey: I18nKey;
  readonly lowKey: I18nKey;
  readonly highKey: I18nKey;
  readonly lowColor: string;
  readonly highColor: string;
}

/** Field overlays (task 1's generalized ids 10–14): land value + pollutions. */
const FIELD_OVERLAYS = [
  OverlayId.landValue,
  OverlayId.airPollution,
  OverlayId.groundPollution,
  OverlayId.noise,
  OverlayId.waterPollution,
] as const;

const SERVICE_LEGENDS: readonly OverlayLegend[] = SERVICE_ID_LIST.map((service) => ({
  id: service,
  labelKey: `budget.service.${service}` as I18nKey,
  scaleKey: "overlayLegend.coverage",
  lowKey: "overlayLegend.weak",
  highKey: "overlayLegend.strong",
  lowColor: "#334f45",
  highColor: "#72d68a",
}));

const FIELD_LEGENDS: readonly OverlayLegend[] = [
  {
    id: OverlayId.landValue,
    labelKey: "overlay.10",
    scaleKey: "overlayLegend.value",
    lowKey: "overlayLegend.low",
    highKey: "overlayLegend.high",
    lowColor: "#46505a",
    highColor: "#d6cf72",
  },
  {
    id: OverlayId.airPollution,
    labelKey: "overlay.11",
    scaleKey: "overlayLegend.pollution",
    lowKey: "overlayLegend.low",
    highKey: "overlayLegend.high",
    lowColor: "#2f5146",
    highColor: "#bf5c4d",
  },
  {
    id: OverlayId.groundPollution,
    labelKey: "overlay.12",
    scaleKey: "overlayLegend.pollution",
    lowKey: "overlayLegend.low",
    highKey: "overlayLegend.high",
    lowColor: "#38503f",
    highColor: "#8e6840",
  },
  {
    id: OverlayId.noise,
    labelKey: "overlay.13",
    scaleKey: "overlayLegend.noise",
    lowKey: "overlayLegend.low",
    highKey: "overlayLegend.high",
    lowColor: "#354d5f",
    highColor: "#cf6db7",
  },
  {
    id: OverlayId.waterPollution,
    labelKey: "overlay.14",
    scaleKey: "overlayLegend.pollution",
    lowKey: "overlayLegend.low",
    highKey: "overlayLegend.high",
    lowColor: "#35536f",
    highColor: "#7c6f45",
  },
];

const LEGENDS = [...SERVICE_LEGENDS, ...FIELD_LEGENDS] as const;

export function OverlayPicker(props: { readonly onSelect: (service: number) => void }): ReactNode {
  const [active, setActive] = useState(0);
  const activeLegend = LEGENDS.find((legend) => legend.id === active) ?? null;
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
      {FIELD_OVERLAYS.map((id) => (
        <button
          type="button"
          key={id}
          data-testid={`overlay-pick-${id}`}
          aria-pressed={active === id}
          onClick={() => pick(id)}
        >
          {t(`overlay.${id}` as I18nKey)}
        </button>
      ))}
      <OverlayLegendView legend={activeLegend} />
    </nav>
  );
}

function OverlayLegendView(props: { readonly legend: OverlayLegend | null }): ReactNode {
  if (props.legend === null) {
    return (
      <div data-testid="overlay-legend" aria-live="polite" style={{ marginTop: 4 }}>
        <strong data-testid="overlay-active-label">{t("overlayPicker.off")}</strong>
      </div>
    );
  }
  return (
    <div
      data-testid="overlay-legend"
      aria-live="polite"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto auto auto",
        alignItems: "center",
        columnGap: 6,
        marginTop: 4,
      }}
    >
      <strong data-testid="overlay-active-label">{t(props.legend.labelKey)}</strong>
      <span data-testid="overlay-scale-label">{t(props.legend.scaleKey)}</span>
      <span
        data-testid="overlay-legend-ramp"
        aria-hidden="true"
        style={{ display: "inline-flex", gap: 2 }}
      >
        <span
          data-testid="overlay-legend-low-swatch"
          style={{
            display: "inline-block",
            width: 14,
            height: 10,
            border: "1px solid rgba(232, 239, 233, 0.34)",
            backgroundColor: props.legend.lowColor,
          }}
        />
        <span
          data-testid="overlay-legend-high-swatch"
          style={{
            display: "inline-block",
            width: 14,
            height: 10,
            border: "1px solid rgba(232, 239, 233, 0.34)",
            backgroundColor: props.legend.highColor,
          }}
        />
      </span>
      <span data-testid="overlay-legend-low-label">{t(props.legend.lowKey)}</span>
      <span data-testid="overlay-legend-high-label">{t(props.legend.highKey)}</span>
    </div>
  );
}
