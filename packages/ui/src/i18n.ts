/**
 * i18n key plumbing (TDD §9: "all strings through i18n keys — ship English;
 * structure costs nothing now, retrofit costs weeks").
 *
 * Deliberately tiny: a typed key → string lookup. A real i18n runtime
 * (plurals, interpolation, locale negotiation) is a later decision; what's
 * LOCKED today is that no component renders a bare string literal.
 */

const en = {
  "hud.population": "Population",
  "hud.funds": "Funds",
  "hud.tick": "Tick",
  "hud.speed": "Speed",
  "speed.pause": "Pause",
  "speed.normal": "1×",
  "speed.fast": "3×",
  "speed.fastest": "9×",
  "tile.selected": "Selected tile",
  "tile.none": "No tile selected",
} as const;

export type I18nKey = keyof typeof en;

export function t(key: I18nKey): string {
  return en[key];
}
