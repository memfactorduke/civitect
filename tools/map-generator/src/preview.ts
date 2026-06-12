/**
 * Top-down catalog previews (GDD §3): 1 px per tile, the renderer's v0
 * tint language, PNG via the intake codec. For Mem's eyes and the map
 * catalog UI later — never a gameplay artifact.
 */
import type { TerrainGrid } from "@civitect/protocol";
import { encodePng, type RawImage } from "@civitect/sprite-intake";

const WATER = 0x2b4a66;
const RESOURCE = 0x8a6f3c;
const ELEVATION_RAMP = [0x2e4639, 0x3a5743, 0x49684c, 0x5b7a55, 0x70885c, 0x869a66, 0x9cab72];

export async function renderPreview(terrain: TerrainGrid): Promise<Uint8Array> {
  const { width, height } = terrain;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let color: number;
      if ((terrain.layers.water[i] as number) !== 0) {
        color = WATER;
      } else if ((terrain.layers.resource[i] as number) !== 0) {
        color = RESOURCE;
      } else {
        const e = Math.min(ELEVATION_RAMP.length - 1, terrain.layers.elevation[i] as number);
        color = ELEVATION_RAMP[e] as number;
      }
      const p = i * 4;
      pixels[p] = (color >> 16) & 0xff;
      pixels[p + 1] = (color >> 8) & 0xff;
      pixels[p + 2] = color & 0xff;
      pixels[p + 3] = 255;
    }
  }
  const image: RawImage = { width, height, pixels };
  return encodePng(image);
}
