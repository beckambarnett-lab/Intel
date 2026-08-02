import {
  OCCLUDER_BLOCK_THRESHOLD,
  OCCLUDER_OPAQUE,
  SANDBOX_DEADFALL_COUNT,
  SANDBOX_FIRE_CLEARING_M,
  SANDBOX_FIRE_POS,
  SANDBOX_HEIGHT_M,
  SANDBOX_TREE_COUNT,
  SANDBOX_WIDTH_M,
  TILE_M,
  TUBE_CAMP_CLEARING_M,
  TUBE_CAMP_X,
  TUBE_CLIFF_M,
  TUBE_DEADFALL_DENSITY,
  TUBE_ROCK_COUNT,
  TUBE_TREE_DENSITY,
  TUBE_ZONES,
  WORLD_LENGTH_M,
  WORLD_WIDTH_M,
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
export type MapKind = 'tube' | 'sandbox';

/** Build the map a given kind and seed describe. Client and server must agree. */
export function mapFor(kind: MapKind, seed: number): MapDef {
  return kind === 'tube' ? tubeMap(seed) : sandboxMap(seed);
}

export interface MapDef {
  widthM: number;
  heightM: number;
  /** Solid blocks: the ravine wall, ruins, boulders. */
  walls: Rect[];
  /** 1m trunks. Scattered, but deterministically so. */
  trees: { x: number; y: number }[];
  /**
   * Deadfall branches lying on the ground (Q15): free wood, no tool, instant
   * pickup. Placed once and never replenished (Q19) — like the trees, this is
   * a finite stock, and stripping it is what eventually pushes you outward.
   */
  deadfall: { x: number; y: number }[];
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

  // Deadfall goes on open ground — including inside the fire's clearing, since
  // the easy wood being near camp is what makes the first few minutes calm.
  const deadfall: { x: number; y: number }[] = [];
  const occupied = new Set(trees.map((t) => `${t.x},${t.y}`));

  for (let attempt = 0; attempt < SANDBOX_DEADFALL_COUNT * 12; attempt++) {
    if (deadfall.length >= SANDBOX_DEADFALL_COUNT) break;
    const x = rand() * widthM;
    const y = rand() * heightM;
    const tile = `${Math.floor(x)},${Math.floor(y)}`;
    if (occupied.has(tile)) continue;
    if (walls.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h)) continue;
    deadfall.push({ x, y });
  }

  return { widthM, heightM, walls, trees, deadfall };
}

/** Convenience: the sandbox grid for a given seed. */
export function sandboxGrid(seed: number): OccluderGrid {
  return gridFromMap(sandboxMap(seed));
}

/**
 * The tube (§14) — the real map.
 *
 * A long corridor with camp at one end and the lair at the other, walled by
 * cliff along both sides. Distance *is* the difficulty curve: the near wood is
 * deliberately thin so it strips out inside the first stretch of a run, and
 * since nothing respawns (Q18/Q19) the only answer is to walk further into the
 * dark than you did last time.
 *
 * Zones are authored, detail inside them is procedural (Q107), and all of it is
 * derived from the seed so every client rebuilds an identical forest from the
 * welcome message rather than being shipped a per-tile payload.
 */
export function tubeMap(seed: number): MapDef {
  const widthM = WORLD_LENGTH_M;
  const heightM = WORLD_WIDTH_M;
  const rand = mulberry32(seed);

  const walls: Rect[] = [
    // The tube is bounded by cliff along its length and closed at both ends.
    { x: 0, y: 0, w: widthM, h: TUBE_CLIFF_M },
    { x: 0, y: heightM - TUBE_CLIFF_M, w: widthM, h: TUBE_CLIFF_M },
    { x: 0, y: 0, w: TUBE_CLIFF_M, h: heightM },
    { x: widthM - TUBE_CLIFF_M, y: 0, w: TUBE_CLIFF_M, h: heightM },
  ];

  const firePos = { x: TUBE_CAMP_X, y: heightM / 2 };

  const inCamp = (x: number, y: number): boolean =>
    Math.hypot(x - firePos.x, y - firePos.y) < TUBE_CAMP_CLEARING_M;

  const inWall = (x: number, y: number, pad = 0): boolean =>
    walls.some(
      (w) => x >= w.x - pad && x < w.x + w.w + pad && y >= w.y - pad && y < w.y + w.h + pad,
    );

  // Rock, zone by zone. Long and thin and off-axis so shadow edges sweep as you
  // walk rather than snapping between two orientations.
  for (const zone of TUBE_ZONES) {
    const count = TUBE_ROCK_COUNT[zone.name];
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = zone.from + rand() * (zone.to - zone.from);
        const y = TUBE_CLIFF_M + rand() * (heightM - TUBE_CLIFF_M * 2);
        const long = 3 + Math.floor(rand() * 9);
        const short = 2 + Math.floor(rand() * 2);
        const horizontal = rand() < 0.5;
        const rect: Rect = {
          x: Math.floor(x),
          y: Math.floor(y),
          w: horizontal ? long : short,
          h: horizontal ? short : long,
        };
        if (inCamp(rect.x, rect.y)) continue;
        if (rect.x + rect.w >= widthM || rect.y + rect.h >= heightM) continue;
        walls.push(rect);
        break;
      }
    }
  }

  const area = (zone: (typeof TUBE_ZONES)[number]): number =>
    ((zone.to - zone.from) * (heightM - TUBE_CLIFF_M * 2)) / 1000;

  const trees: { x: number; y: number }[] = [];
  const taken = new Set<string>();

  for (const zone of TUBE_ZONES) {
    const want = Math.round(TUBE_TREE_DENSITY[zone.name] * area(zone));
    // Fixed attempt budget rather than `while (placed < n)`: over-constrained
    // clearance rules should degrade, never hang.
    for (let attempt = 0; attempt < want * 12 && trees.length < want + countBefore(trees, zone); attempt++) {
      const x = Math.floor(zone.from + rand() * (zone.to - zone.from));
      const y = Math.floor(TUBE_CLIFF_M + rand() * (heightM - TUBE_CLIFF_M * 2));
      const key = `${x},${y}`;
      if (taken.has(key)) continue;
      if (inCamp(x, y) || inWall(x, y, 1)) continue;
      taken.add(key);
      trees.push({ x, y });
    }
  }

  const deadfall: { x: number; y: number }[] = [];
  for (const zone of TUBE_ZONES) {
    const want = Math.round(TUBE_DEADFALL_DENSITY[zone.name] * area(zone));
    for (let i = 0, attempt = 0; i < want && attempt < want * 12; attempt++) {
      const x = zone.from + rand() * (zone.to - zone.from);
      const y = TUBE_CLIFF_M + rand() * (heightM - TUBE_CLIFF_M * 2);
      if (taken.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
      if (inWall(x, y)) continue;
      deadfall.push({ x, y });
      i++;
    }
  }

  return { widthM, heightM, walls, trees, deadfall };
}

/** Trees already placed before this zone began — keeps the per-zone budget honest. */
function countBefore(trees: { x: number; y: number }[], zone: (typeof TUBE_ZONES)[number]): number {
  let n = 0;
  for (const t of trees) if (t.x < zone.from) n++;
  return n;
}

/** Where camp sits on the tube. The fire, the woodpile and spawns all key off this. */
export function tubeCampPos(): { x: number; y: number } {
  return { x: TUBE_CAMP_X, y: WORLD_WIDTH_M / 2 };
}

/** Convenience: the tube grid for a given seed. */
export function tubeGrid(seed: number): OccluderGrid {
  return gridFromMap(tubeMap(seed));
}
