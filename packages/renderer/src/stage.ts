/**
 * Empty-world stage (TDD §8, board PR 5 scope).
 *
 * Phase 0 world: a flat tile grid drawn as diamond outlines + one highlight
 * diamond driven by display state. The real architecture (32×32-tile chunk
 * render-textures, building/agent/overlay layers, LOD tiers) lands with
 * Phase 1 terrain — this stage exists so the round trip has something honest
 * to draw, not as a miniature of that design.
 */
import { Container, Graphics } from "pixi.js";
import type { DisplayState } from "./display";
import { TILE_H, TILE_W, tileToWorld } from "./iso";

export interface WorldStageOptions {
  readonly mapWidth: number;
  readonly mapHeight: number;
}

export interface WorldStage {
  /** Root container — caller owns placement (camera offset/scale). */
  readonly root: Container;
  /** Reconcile visuals with a new display state. Idempotent. */
  update(state: DisplayState): void;
}

const GRID_COLOR = 0x3a4a3f; // placeholder slate-green until Phase 1 terrain
const HIGHLIGHT_COLOR = 0xffd166;

function diamondPath(g: Graphics, wx: number, wy: number): Graphics {
  // wx/wy = tile top corner (north vertex), per iso.ts convention.
  return g
    .moveTo(wx, wy)
    .lineTo(wx + TILE_W / 2, wy + TILE_H / 2)
    .lineTo(wx, wy + TILE_H)
    .lineTo(wx - TILE_W / 2, wy + TILE_H / 2)
    .closePath();
}

export function createWorldStage(options: WorldStageOptions): WorldStage {
  const root = new Container();

  const grid = new Graphics();
  for (let y = 0; y < options.mapHeight; y++) {
    for (let x = 0; x < options.mapWidth; x++) {
      const { wx, wy } = tileToWorld(x, y);
      diamondPath(grid, wx, wy);
    }
  }
  grid.stroke({ color: GRID_COLOR, width: 1, pixelLine: true });
  root.addChild(grid);

  const highlight = new Graphics();
  diamondPath(highlight, 0, 0).fill({ color: HIGHLIGHT_COLOR, alpha: 0.55 });
  highlight.visible = false;
  root.addChild(highlight);

  return {
    root,
    update(state: DisplayState): void {
      if (state.highlight === null) {
        highlight.visible = false;
        return;
      }
      const { wx, wy } = tileToWorld(state.highlight.x, state.highlight.y);
      highlight.position.set(wx, wy);
      highlight.visible = true;
    },
  };
}
