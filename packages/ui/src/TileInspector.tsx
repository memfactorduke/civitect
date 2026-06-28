/**
 * Tile inspector panel (GDD §9.5): the baseline readout for any selected tile.
 * Roads and buildings add their own detail panels, but zone, land value, and
 * pollution belong to the tile itself.
 */
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { type I18nKey, t } from "./i18n";
import type { UiStore } from "./store";

const ZONE_LABELS: Readonly<Record<number, I18nKey>> = {
  0: "tileInspector.zone.unzoned",
  1: "tax.zone.1",
  2: "tax.zone.2",
  3: "tax.zone.3",
  4: "tax.zone.4",
  5: "tax.zone.5",
  6: "tax.zone.6",
};

const TERRAIN_LABELS: Readonly<Record<number, I18nKey>> = {
  0: "tileInspector.terrain.grass",
};

function labelFor(labels: Readonly<Record<number, I18nKey>>, value: number): string {
  const key = labels[value];
  return key === undefined ? `${t("tileInspector.unknown")} ${value}` : t(key);
}

export function TileInspector(props: { readonly store: UiStore }): ReactNode {
  const tile = useStore(props.store, (s) => s.tileInfo);
  const environ = useStore(props.store, (s) => s.environInfo);
  if (tile === null && environ === null) {
    return null;
  }

  return (
    <section aria-label={t("tileInspector.title")} data-testid="tile-inspector">
      <h2>{t("tileInspector.title")}</h2>
      {tile !== null && (
        <dl>
          <dt>{t("tileInspector.tileId")}</dt>
          <dd data-testid="tile-id">{tile.tileIdx}</dd>
          <dt>{t("tileInspector.terrain")}</dt>
          <dd data-testid="tile-terrain">{labelFor(TERRAIN_LABELS, tile.terrainKind)}</dd>
          <dt>{t("tileInspector.elevation")}</dt>
          <dd data-testid="tile-elevation">{tile.elevationTerrace}</dd>
          <dt>{t("tileInspector.zone")}</dt>
          <dd data-testid="tile-zone">{labelFor(ZONE_LABELS, tile.zoneKind)}</dd>
          <dt>{t("tileInspector.landValue")}</dt>
          <dd data-testid="tile-land-value">{tile.landValue}/255</dd>
        </dl>
      )}
      {environ !== null && (
        <dl data-testid="environ-block">
          <dt>{t("environ.air")}</dt>
          <dd data-testid="environ-air">{environ.airPollution}</dd>
          <dt>{t("environ.ground")}</dt>
          <dd data-testid="environ-ground">{environ.groundPollution}</dd>
          <dt>{t("environ.noise")}</dt>
          <dd data-testid="environ-noise">{environ.noise}</dd>
          <dt>{t("environ.water")}</dt>
          <dd data-testid="environ-water">{environ.waterPollution}</dd>
        </dl>
      )}
    </section>
  );
}
