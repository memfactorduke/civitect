/**
 * Day/night presentation tint (GDD §4, TDD §8).
 *
 * The sim clock is already expressed as game minutes, so the renderer can
 * derive a visual tint without asking the sim for extra presentation state.
 */

export const TICKS_PER_DAY = 24 * 60;
export const DAY_NIGHT_CLEAR_TINT = 0xffffff;
export const DAY_NIGHT_TINT = 0xa5b8d7;
export const DAY_NIGHT_MAX_ALPHA = 0.28;

const DAWN_START_MINUTE = 5 * 60;
const DAWN_END_MINUTE = 7 * 60;
const DUSK_START_MINUTE = 18 * 60;
const DUSK_END_MINUTE = 21 * 60;
const PHASE_SCALE = 1000;
const CHANNEL_MAX = 255;

export interface DayNightTint {
  /** 0 at midnight, 500 at noon; useful for cheap redraw checks. */
  readonly phasePermille: number;
  readonly color: number;
  readonly alpha: number;
}

export function minuteOfDay(tick: number): number {
  return ((Math.trunc(tick) % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
}

function fadeAlpha(
  minute: number,
  startMinute: number,
  endMinute: number,
  fromAlpha: number,
  toAlpha: number,
): number {
  const progress = (minute - startMinute) / (endMinute - startMinute);
  return fromAlpha + (toAlpha - fromAlpha) * progress;
}

function channel(color: number, shift: number): number {
  return (color >> shift) & 0xff;
}

function mixChannel(from: number, to: number, progress: number): number {
  return Math.round(from + (to - from) * progress);
}

function tintForAlpha(alpha: number): number {
  if (alpha === 0) {
    return DAY_NIGHT_CLEAR_TINT;
  }
  const progress = alpha / DAY_NIGHT_MAX_ALPHA;
  const r = mixChannel(CHANNEL_MAX, channel(DAY_NIGHT_TINT, 16), progress);
  const g = mixChannel(CHANNEL_MAX, channel(DAY_NIGHT_TINT, 8), progress);
  const b = mixChannel(CHANNEL_MAX, channel(DAY_NIGHT_TINT, 0), progress);
  return (r << 16) | (g << 8) | b;
}

export function dayNightTintForTick(tick: number): DayNightTint {
  const minute = minuteOfDay(tick);
  let alpha = DAY_NIGHT_MAX_ALPHA;

  if (minute >= DAWN_START_MINUTE && minute < DAWN_END_MINUTE) {
    alpha = fadeAlpha(minute, DAWN_START_MINUTE, DAWN_END_MINUTE, DAY_NIGHT_MAX_ALPHA, 0);
  } else if (minute >= DAWN_END_MINUTE && minute < DUSK_START_MINUTE) {
    alpha = 0;
  } else if (minute >= DUSK_START_MINUTE && minute < DUSK_END_MINUTE) {
    alpha = fadeAlpha(minute, DUSK_START_MINUTE, DUSK_END_MINUTE, 0, DAY_NIGHT_MAX_ALPHA);
  }

  return {
    phasePermille: Math.floor((minute * PHASE_SCALE) / TICKS_PER_DAY),
    color: tintForAlpha(alpha),
    alpha,
  };
}
