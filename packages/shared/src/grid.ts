import {
  OCCLUDER_BLOCK_THRESHOLD,
  OCCLUDER_OPAQUE,
  SANDBOX_FIRE_CLEARING_M,
  SANDBOX_FIRE_POS,
  SANDBOX_HEIGHT_M,
  SANDBOX_TREE_COUNT,
  SANDBOX_WIDTH_M,
  TILE_M,
} from './constants.js';
import { mulberry32 } from './math.js';

/**
 * The true world geometry: 1m tiles, one opacity byte each.
 *
 * This is the only thing collision and line-of-sight are ever allowed to read.
 * Step 5 adds a rotting *memory* of the world that lies about how it looks —
 * it must never be consulted about where anything is (Q48). Keeping the two in
 * separate modules is the mechanism that keeps that honest.
 */
export interface OccluderGrid {
  /** Width in tiles. */
  w: number;
  /** Height in tiles. */
  h: number;
  /** Row-major opacity, 0 = clear, 255 = solid. */
  cells: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A map before it becomes a grid. Authored zones with procedural detail inside
 * them (Q107); the sandbox below is the smallest thing of that shape.
 */
export interface MapDef {
  widthM: number;
  heightM: number;
  /** Solid blocks: the ravine wall, ruins, boulders. */
  walls: Rect[];
  /** 1m trunks. Scattered, but deterministically so. */
  trees: { x: number; y: number }[];
}

export function createGrid(wTiles: number, hTiles: number): OccluderGrid {
  return { w: wTiles, h: hTiles, cells: new Uint8Array(wTiles * hTiles) };
}

/** Opacity of a tile. Out of bounds reads as solid — the world ends in rock. */
export function opacityAt(grid: OccluderGrid, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return OCCLUDER_OPAQUE;
  return grid.cells[ty * grid.w + tx] ?? 0;
}

export function isOpaqueTile(grid: OccluderGrid, tx: number, ty: number): boolean {
  return opacityAt(grid, tx, ty) >= OCCLUDER_BLOCK_THRESHOLD;
}

/** Same question in world metres. */
export function isBlockedAt(grid: OccluderGrid, x: number, y: number): boolean {
  return isOpaqueTile(grid, Math.floor(x / TILE_M), Math.floor(y / TILE_M));
}

export function setTile(grid: OccluderGrid, tx: number, ty: number, opacity: number): void {
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return;
  grid.cells[ty * grid.w + tx] = opacity;
}

export function fillRect(grid: OccluderGrid, rect: Rect, opacity = OCCLUDER_OPAQUE): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(grid.w, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(grid.h, Math.ceil(rect.y + rect.h));

  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) setTile(grid, tx, ty, opacity);
  }
}

export function gridFromMap(map: MapDef): OccluderGrid {
  const grid = createGrid(Math.ceil(map.widthM / TILE_M), Math.ceil(map.heightM / TILE_M));

  for (const wall of map.walls) fillRect(grid, wall);
  for (const tree of map.trees) setTile(grid, Math.floor(tree.x), Math.floor(tree.y), OCCLUDER_OPAQUE);

  return grid;
}

/**
 * The sandbox map. Seeded rather than shipped: the client rebuilds this from
 * the seed in the welcome message, so client and server geometry cannot drift
 * apart and no per-tile payload crosses the wire.
 *
 * Laid out to exercise the darkness rather than to be fun — a clearing around
 * the fire, hard-edged blocks that throw long shadows, and a scatter of trunks
 * dense enough that a player 20m away is genuinely hidden.
 */
export function sandboxMap(seed: number): MapDef {
  const widthM = SANDBOX_WIDTH_M;
  const heightM = SANDBOX_HEIGHT_M;
  const rand = mulberry32(seed);

  const walls: Rect[] = [
    // The world ends in rock on all four sides.
    { x: 0, y: 0, w: widthM, h: 1 },
    { x: 0, y: heightM - 1, w: widthM, h: 1 },
    { x: 0, y: 0, w: 1, h: heightM },
    { x: widthM - 1, y: 0, w: 1, h: heightM },

    // Interior blocks. Long, thin and off-axis so the shadow edges sweep as
    // you walk rather than snapping between two orientations.
    { x: 24, y: 6, w: 8, h: 2 },
    { x: 30, y: 8, w: 2, h: 9 },
    { x: 18, y: 26, w: 12, h: 2 },
    { x: 40, y: 14, w: 3, h: 3 },
    { x: 44, y: 24, w: 9, h: 2 },
    { x: 51, y: 8, w: 2, h: 10 },
  ];

  const trees: { x: number; y: number }[] = [];
  const isClear = (x: number, y: number): boolean => {
    // Keep the fire's clearing and the spawn lane walkable.
    const dFire = Math.hypot(x - SANDBOX_FIRE_POS.x, y - SANDBOX_FIRE_POS.y);
    if (dFire < SANDBOX_FIRE_CLEARING_M) return false;
    if (walls.some((w) => x >= w.x - 1 && x < w.x + w.w + 1 && y >= w.y - 1 && y < w.y + w.h + 1)) {
      return false;
    }
    return true;
  };

  // Rejection sampling with a fixed attempt budget: a `while (placed < n)` loop
  // would hang rather than degrade if the clearance rules ever over-constrain.
  for (let attempt = 0; attempt < SANDBOX_TREE_COUNT * 12; attempt++) {
    if (trees.length >= SANDBOX_TREE_COUNT) break;
    const x = Math.floor(rand() * widthM);
    const y = Math.floor(rand() * heightM);
    if (!isClear(x, y)) continue;
    if (trees.some((t) => t.x === x && t.y === y)) continue;
    trees.push({ x, y });
  }

  return { widthM, heightM, walls, trees };
}

/** Convenience: the sandbox grid for a given seed. */
export function sandboxGrid(seed: number): OccluderGrid {
  return gridFromMap(sandboxMap(seed));
}
