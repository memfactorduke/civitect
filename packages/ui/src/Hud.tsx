/**
 * HUD strip: the snapshot scalars a mayor always sees (TDD §9).
 * Pure view over the zustand store — no dispatch, no local state.
 */
import type { ReactNode } from "react";
import { formatCount, formatFundsCents } from "./format";
import { t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

export function Hud(props: { readonly store: UiStore }): ReactNode {
  const population = useUiStore(props.store, (s) => s.population);
  const fundsCents = useUiStore(props.store, (s) => s.fundsCents);
  const tick = useUiStore(props.store, (s) => s.tick);
  const selectedTile = useUiStore(props.store, (s) => s.selectedTile);

  return (
    <div role="status" aria-label="city status">
      <span>
        {t("hud.population")}:{" "}
        <output data-testid="hud-population">{formatCount(population)}</output>
      </span>
      <span>
        {t("hud.funds")}:{" "}
        <output
          data-testid="hud-funds"
          data-debt={fundsCents < 0 ? "true" : "false"}
          style={{ color: fundsCents < 0 ? "#c0392b" : undefined }}
        >
          {formatFundsCents(fundsCents)}
        </output>
      </span>
      <span>
        {t("hud.tick")}: <output data-testid="hud-tick">{tick}</output>
      </span>
      <span data-testid="hud-selected-tile">
        {selectedTile === null
          ? t("tile.none")
          : `${t("tile.selected")}: ${selectedTile.x}, ${selectedTile.y}`}
      </span>
    </div>
  );
}
