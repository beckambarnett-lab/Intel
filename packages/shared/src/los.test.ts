import { describe, expect, it } from 'vitest';
import { OCCLUDER_OPAQUE, SANDBOX_MAP_SEED, TILE_M } from './constants.js';
import { createGrid, fillRect, isBlockedAt, isOpaqueTile, sandboxGrid, sandboxMap } from './grid.js';
import { canSee, castRay, normaliseAngle, raycastLOS, visibilityPolygon } from './los.js';

/** An open room with one wall segment across the middle. */
function roomWithWall(): ReturnType<typeof createGrid> {
  const grid = createGrid(20, 20);
  fillRect(grid, { x: 10, y: 5, w: 1, h: 10 });
  return grid;
}

describe('occluder grid', () => {
  it('reads out of bounds as solid — the world ends in rock', () => {
    const grid = createGrid(10, 10);
    expect(isOpaqueTile(grid, -1, 5)).toBe(true);
    expect(isOpaqueTile(grid, 10, 5)).toBe(true);
    expect(isOpaqueTile(grid, 5, 5)).toBe(false);
  });

  it('maps world metres onto tiles', () => {
    const grid = createGrid(10, 10);
    fillRect(grid, { x: 3, y: 4, w: 1, h: 1 });
    expect(isBlockedAt(grid, 3.5, 4.5)).toBe(true);
    expect(isBlockedAt(grid, 3.5, 5.5)).toBe(false);
  });

  it('builds the same sandbox from the same seed, and a different one otherwise', () => {
    const a = sandboxGrid(SANDBOX_MAP_SEED);
    const b = sandboxGrid(SANDBOX_MAP_SEED);
    const c = sandboxGrid(SANDBOX_MAP_SEED + 1);

    // Client and server derive geometry independently; if this is not exactly
    // equal, prediction collides against a different world than the server.
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(Array.from(a.cells)).not.toEqual(Array.from(c.cells));
  });

  it('terminates map generation even though placement is rejection-sampled', () => {
    const map = sandboxMap(SANDBOX_MAP_SEED);
    expect(map.trees.length).toBeGreaterThan(0);
    // No duplicate trunks in the same tile.
    const keys = new Set(map.trees.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(map.trees.length);
  });
});

describe('raycastLOS', () => {
  it('sees across open ground', () => {
    const grid = createGrid(20, 20);
    expect(raycastLOS(grid, { x: 1.5, y: 10.5 }, { x: 18.5, y: 10.5 })).toBe(true);
  });

  it('is blocked by a wall in between', () => {
    const grid = roomWithWall();
    expect(raycastLOS(grid, { x: 5.5, y: 10.5 }, { x: 15.5, y: 10.5 })).toBe(false);
  });

  it('sees around the end of the wall', () => {
    const grid = roomWithWall();
    // The wall spans y 5..15; both points sit below it.
    expect(raycastLOS(grid, { x: 5.5, y: 17.5 }, { x: 15.5, y: 17.5 })).toBe(true);
  });

  it('is symmetric — if I can see you, you can see me', () => {
    const grid = roomWithWall();
    const a = { x: 4.2, y: 8.1 };
    const b = { x: 13.7, y: 12.9 };
    expect(raycastLOS(grid, a, b)).toBe(raycastLOS(grid, b, a));
  });

  it('does not blind an entity standing flush against a wall', () => {
    const grid = roomWithWall();
    // Just off the wall's left face, looking away from it.
    expect(raycastLOS(grid, { x: 9.99, y: 10.5 }, { x: 2.5, y: 10.5 })).toBe(true);
  });

  it('sees within a single tile', () => {
    const grid = createGrid(20, 20);
    expect(raycastLOS(grid, { x: 5.1, y: 5.1 }, { x: 5.9, y: 5.9 })).toBe(true);
  });
});

describe('castRay', () => {
  it('stops at the face of the first occluder', () => {
    const grid = roomWithWall();
    const hit = castRay(grid, { x: 5.5, y: 10.5 }, 0, 20);
    expect(hit.hit).toBe(true);
    // The wall's left face is at x = 10.
    expect(hit.x).toBeCloseTo(10, 6);
    expect(hit.dist).toBeCloseTo(4.5, 6);
  });

  it('runs to the radius limit over open ground', () => {
    const grid = createGrid(40, 40);
    const hit = castRay(grid, { x: 20.5, y: 20.5 }, 0, 5);
    expect(hit.hit).toBe(false);
    expect(hit.dist).toBeCloseTo(5, 6);
  });
});

describe('visibilityPolygon', () => {
  it('never returns a point beyond the light radius', () => {
    const grid = sandboxGrid(SANDBOX_MAP_SEED);
    const origin = { x: 12, y: 20 };
    const radius = 9;

    const poly = visibilityPolygon(grid, origin, radius);
    expect(poly.length).toBeGreaterThan(3);

    for (const p of poly) {
      const d = Math.hypot(p.x - origin.x, p.y - origin.y);
      // A hair of tolerance for float error at the ring rays.
      expect(d).toBeLessThanOrEqual(radius + 1e-6);
    }
  });

  /**
   * The fan is filled in the order returned, so a break in angular order is a
   * polygon folded through itself — which renders as light leaking across the
   * middle of a shadow.
   */
  it('is returned in angular order, so the fan does not self-intersect', () => {
    const grid = roomWithWall();
    const origin = { x: 5.5, y: 10.5 };
    const poly = visibilityPolygon(grid, origin, 8);

    let previous = -Infinity;
    for (const p of poly) {
      const a = normaliseAngle(Math.atan2(p.y - origin.y, p.x - origin.x));
      expect(a).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = a;
    }
  });

  it('never reaches into the shadow the wall casts', () => {
    const grid = roomWithWall();
    const origin = { x: 5.5, y: 10.5 };
    const poly = visibilityPolygon(grid, origin, 9);

    // The wall occupies x 10..11, y 5..15. Rays may travel past x = 10 by going
    // round either end of it — but never while still within its vertical span.
    for (const p of poly) {
      const pastTheFace = p.x > 10 + 0.05;
      const withinItsSpan = p.y > 5 + 0.05 && p.y < 15 - 0.05;
      expect(pastTheFace && withinItsSpan).toBe(false);
    }
  });

  it('reaches full radius on the open side', () => {
    const grid = roomWithWall();
    const origin = { x: 5.5, y: 10.5 };
    const radius = 9;
    const poly = visibilityPolygon(grid, origin, radius);

    const awayFromWall = poly.filter((p) => p.x < origin.x - 1);
    const furthestBehind = Math.max(
      ...awayFromWall.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)),
    );
    expect(furthestBehind).toBeCloseTo(radius, 3);
  });
});

describe('canSee', () => {
  it('requires both range and a clear line', () => {
    const grid = roomWithWall();
    const eye = { x: 5.5, y: 10.5 };

    expect(canSee(grid, eye, 3, { x: 7.5, y: 10.5 })).toBe(true);
    // In range but through the wall.
    expect(canSee(grid, eye, 20, { x: 15.5, y: 10.5 })).toBe(false);
    // Clear line but out of range.
    expect(canSee(grid, eye, 1, { x: 8.5, y: 10.5 })).toBe(false);
  });

  it('sees nothing at all with no light', () => {
    const grid = createGrid(20, 20);
    expect(canSee(grid, { x: 5, y: 5 }, 0, { x: 5, y: 5.1 })).toBe(false);
  });
});

describe('grid constants', () => {
  it('is a 1m grid, as the spec requires', () => {
    expect(TILE_M).toBe(1);
    expect(OCCLUDER_OPAQUE).toBe(255);
  });
});
