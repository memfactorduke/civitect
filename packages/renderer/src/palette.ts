/**
 * Renderer palette constants plus the small color-audit helpers used by tests.
 * Keeping these values outside the Pixi stage makes the placeholder art ramps
 * reviewable while the sprite pipeline catches up.
 */

export const GRID_COLOR = 0x3a4a3f;
export const HIGHLIGHT_COLOR = 0xffd166;
export const COVERAGE_OVERLAY_COLOR = 0x2fae5a;
export const AGENT_CAR_COLOR = 0xffd24a;
export const AGENT_PEDESTRIAN_COLOR = 0x9be4ff;

/** Zone kind -> overlay/building tint [TUNE until sprites + style bible]. */
export const ZONE_COLOR: Readonly<Record<number, number>> = {
  1: 0x3f9b53, // R low
  2: 0x2e7a40, // R high
  3: 0x3f6f9b, // C low
  4: 0x2e567a, // C high
  5: 0x9b8a3f, // industrial
  6: 0x7a3f9b, // office
};

export const PLOPPABLE_COLOR: Readonly<Record<number, number>> = {
  101: 0x8a3030, // power plant
  102: 0x30708a, // water pump
  // Phase 4 service set [TUNE until sprites]: one hue family per service.
  103: 0xb5413a, // fire station
  104: 0xc94f47, // fire station (large)
  105: 0x3a5db5, // police station
  106: 0x4769c9, // police HQ
  107: 0x3aa394, // clinic
  108: 0x47b8a8, // hospital
  109: 0x6b6478, // cemetery
  110: 0x7d7591, // crematorium
  111: 0xb58f3a, // elementary school
  112: 0xc99f47, // high school
  113: 0xd9b15a, // university
  114: 0xa3823a, // library
  115: 0x55a04a, // small park
  116: 0x64b558, // plaza
  117: 0x8a8a9e, // telecom tower
  118: 0x77603c, // landfill
  119: 0x8a6e45, // incinerator
  120: 0x6e8a45, // recycling center
  121: 0x5c4a36, // sewage outlet
  122: 0x6b5740, // sewage treatment
};

/** Road class -> stroke {width, color} at 1x [TUNE until road sprites]. */
export const ROAD_STYLE: Readonly<Record<number, { width: number; color: number }>> = {
  1: { width: 6, color: 0x4a4a4a }, // street
  2: { width: 10, color: 0x5a5a5e }, // avenue
  3: { width: 14, color: 0x6b6b70 }, // highway
  4: { width: 3, color: 0xa8865c }, // ped/bike path
  11: { width: 7, color: 0x77818c }, // bridges read lighter + a hair wider
  12: { width: 11, color: 0x848e99 },
  13: { width: 15, color: 0x919ba6 },
  14: { width: 4, color: 0xb59a76 },
};

export function congestionColor(permille: number): number {
  if (permille >= 1200) {
    return 0xd83a3a; // jammed
  }
  if (permille >= 900) {
    return 0xe07b2f;
  }
  if (permille >= 500) {
    return 0xd9c544;
  }
  return 0x4ea64e; // free-flowing
}

export type ColorVisionMode = "protanopia" | "deuteranopia" | "tritanopia";

const COLOR_VISION_MATRICES: Readonly<
  Record<
    ColorVisionMode,
    readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ]
  >
> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function channel(color: number, shift: number): number {
  return (color >> shift) & 0xff;
}

function linearize(channelValue: number): number {
  const value = channelValue / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: number): number {
  const r = linearize(channel(color, 16));
  const g = linearize(channel(color, 8));
  const b = linearize(channel(color, 0));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: number, b: number): number {
  const bright = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (bright + 0.05) / (dark + 0.05);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

export function simulateColorVision(color: number, mode: ColorVisionMode): number {
  const r = channel(color, 16) / 255;
  const g = channel(color, 8) / 255;
  const b = channel(color, 0) / 255;
  const matrix = COLOR_VISION_MATRICES[mode];
  const out = matrix.map((row) => clampByte(row[0] * r + row[1] * g + row[2] * b));
  return ((out[0] as number) << 16) | ((out[1] as number) << 8) | (out[2] as number);
}
