/**
 * World stage (TDD §8, ADR-008): a CHUNKED static terrain layer — one baked
 * container per 32×32-tile chunk, cached as a texture, re-baked only when
 * its chunk is marked dirty — plus the highlight layer driven by display
 * state. Building/agent/overlay layers and LOD-tier behavior arrive with
 * their phases; the chunk architecture is the structural piece.
 *
 * Without terrain (Phase 0 boot), chunks bake the placeholder diamond grid;
 * with terrain (map files), they bake flat tile tints (v0 "art" [TUNE]).
 */

import type { TerrainGrid } from "@civitect/protocol";
import { Container, Graphics } from "pixi.js";
import { CHUNK_TILES, chunkLayout, chunkTiles, terrainTint } from "./chunks";
import type { DisplayState } from "./display";
import { TILE_H, TILE_W, tileToWorld } from "./iso";

export interface WorldStageOptions {
  readonly mapWidth: number;
  readonly mapHeight: number;
  /** Tile layers to tint from (map files); omitted = placeholder grid. */
  readonly terrain?: TerrainGrid;
}

export interface WorldStage {
  /** Root container — caller owns placement (camera offset/scale). */
  readonly root: Container;
  /** Reconcile visuals with a new display state. Idempotent. */
  update(state: DisplayState): void;
  /** Re-bake specific chunks (snapshot dirtyChunkIds feed this). */
  rebakeChunks(chunkIds: readonly number[]): void;
  /** Chunk count — observability for tests/devtools. */
  readonly chunkCount: number;
}

const GRID_COLOR = 0x3a4a3f; // placeholder slate-green until terrain art
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
  const layout = chunkLayout(options.mapWidth, options.mapHeight);

  const terrainLayer = new Container();
  root.addChild(terrainLayer);
  const chunkContainers: Container[] = [];

  const bakeChunk = (chunkId: number): void => {
    const old = chunkContainers[chunkId];
    if (old !== undefined) {
      old.destroy({ children: true });
    }
    const container = new Container();
    const g = new Graphics();
    const rect = chunkTiles(layout, chunkId, options.mapWidth, options.mapHeight);
    if (options.terrain !== undefined) {
      for (let y = rect.y0; y < rect.y1; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const { wx, wy } = tileToWorld(x, y);
          diamondPath(g, wx, wy).fill({ color: terrainTint(options.terrain, x, y) });
        }
      }
    } else {
      for (let y = rect.y0; y < rect.y1; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const { wx, wy } = tileToWorld(x, y);
          diamondPath(g, wx, wy);
        }
      }
      g.stroke({ color: GRID_COLOR, width: 1, pixelLine: true });
    }
    container.addChild(g);
    // The ADR-008 bake: chunk renders once to a cached texture; the world
    // costs ~zero per frame until this chunk is dirtied again.
    container.cacheAsTexture(true);
    chunkContainers[chunkId] = container;
    // Plain append: chunks never overlap meaningfully, so z-order among
    // them is cosmetic — and index-based insertion would fight rebakes.
    terrainLayer.addChild(container);
  };

  for (let id = 0; id < layout.count; id++) {
    bakeChunk(id);
  }

  const highlight = new Graphics();
  diamondPath(highlight, 0, 0).fill({ color: HIGHLIGHT_COLOR, alpha: 0.55 });
  highlight.visible = false;
  root.addChild(highlight);

  return {
    root,
    chunkCount: layout.count,
    update(state: DisplayState): void {
      if (state.highlight === null) {
        highlight.visible = false;
        return;
      }
      const { wx, wy } = tileToWorld(state.highlight.x, state.highlight.y);
      highlight.position.set(wx, wy);
      highlight.visible = true;
    },
    rebakeChunks(chunkIds: readonly number[]): void {
      for (const id of chunkIds) {
        if (id >= 0 && id < layout.count) {
          bakeChunk(id);
        }
      }
    },
  };
}

export { CHUNK_TILES };
