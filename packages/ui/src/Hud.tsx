/**
 * HUD strip: the snapshot scalars a mayor always sees (TDD §9).
 * Pure view over the zustand store — no dispatch, no local state.
 */
import type { ReactNode } from "react";
import { formatCount, formatFundsCents } from "./format";
import { t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

const TICKS_PER_HOUR = 60;
const TICKS_PER_DAY = TICKS_PER_HOUR * 24;
const DAYS_PER_MONTH = 30;
const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH;

function formatClockPart(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatGameTime(tick: number): string {
  const safeTick = Math.max(0, Math.floor(tick));
  const month = Math.floor(safeTick / TICKS_PER_MONTH) + 1;
  const tickInMonth = safeTick % TICKS_PER_MONTH;
  const day = Math.floor(tickInMonth / TICKS_PER_DAY) + 1;
  const tickInDay = tickInMonth % TICKS_PER_DAY;
  const hour = Math.floor(tickInDay / TICKS_PER_HOUR);
  const minute = tickInDay % TICKS_PER_HOUR;
  return `${t("hud.month")} ${month}, ${t("hud.day")} ${day}, ${formatClockPart(
    hour,
  )}:${formatClockPart(minute)}`;
}

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
      <span>
        {t("hud.time")}: <output data-testid="hud-game-time">{formatGameTime(tick)}</output>
      </span>
      <span data-testid="hud-selected-tile">
        {selectedTile === null
          ? t("tile.none")
          : `${t("tile.selected")}: ${selectedTile.x}, ${selectedTile.y}`}
      </span>
    </div>
  );
}
