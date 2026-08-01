import { LOS_CORNER_EPSILON, LOS_MAX_STEPS, TILE_M, VIS_POLY_RING_RAYS } from './constants.js';
import { isOpaqueTile } from './grid.js';
import type { OccluderGrid } from './grid.js';
import type { Vec2 } from './math.js';

/**
 * Line of sight over the occluder grid.
 *
 * Two consumers, deliberately different shapes:
 *
 *   raycastLOS       - server. "Can A see B?" One boolean, no allocation, run
 *                      once per creature per candidate target per tick.
 *   visibilityPolygon - client. "What shape is lit?" A fan of points to fill
 *                      into the light mask, run once per light per frame.
 *
 * Both read the true grid and nothing else (Q48).
 */

export interface RayHit {
  /** Where the ray stopped: an occluder face, or the radius limit. */
  x: number;
  y: number;
  /** Distance travelled from the origin, metres. */
  dist: number;
  /** False when the ray ran out of range without hitting anything. */
  hit: boolean;
}

/**
 * Is the segment a->b unobstructed?
 *
 * Amanatides & Woo grid traversal. The origin tile is not tested: an entity
 * standing flush against a wall (or nudged inside one by a rounding error)
 * must not be permanently blind.
 */
export function raycastLOS(grid: OccluderGrid, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let tx = Math.floor(a.x / TILE_M);
  let ty = Math.floor(a.y / TILE_M);
  const endX = Math.floor(b.x / TILE_M);
  const endY = Math.floor(b.y / TILE_M);

  if (tx === endX && ty === endY) return true;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  // Everything below is parameterised on t in [0,1] along the segment.
  const invDx = dx !== 0 ? TILE_M / Math.abs(dx) : Infinity;
  const invDy = dy !== 0 ? TILE_M / Math.abs(dy) : Infinity;

  let tMaxX =
    stepX === 0
      ? Infinity
      : stepX > 0
        ? ((tx + 1) * TILE_M - a.x) / dx
        : (tx * TILE_M - a.x) / dx;
  let tMaxY =
    stepY === 0
      ? Infinity
      : stepY > 0
        ? ((ty + 1) * TILE_M - a.y) / dy
        : (ty * TILE_M - a.y) / dy;

  for (let i = 0; i < LOS_MAX_STEPS; i++) {
    if (tMaxX < tMaxY) {
      if (tMaxX > 1) return true;
      tx += stepX;
      tMaxX += invDx;
    } else {
      if (tMaxY > 1) return true;
      ty += stepY;
      tMaxY += invDy;
    }

    if (isOpaqueTile(grid, tx, ty)) return false;
    if (tx === endX && ty === endY) return true;
  }

  // Ran out of budget: refuse to claim sight we did not actually verify.
  return false;
}

/**
 * March a ray from `origin` along `angle` until it hits an occluder or reaches
 * `maxDist`. Returns the stopping point, which is the vertex the light mask
 * is built from.
 */
export function castRay(
  grid: OccluderGrid,
  origin: Vec2,
  angle: number,
  maxDist: number,
): RayHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  let tx = Math.floor(origin.x / TILE_M);
  let ty = Math.floor(origin.y / TILE_M);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const invDx = dx !== 0 ? TILE_M / Math.abs(dx) : Infinity;
  const invDy = dy !== 0 ? TILE_M / Math.abs(dy) : Infinity;

  let tMaxX =
    stepX === 0
      ? Infinity
      : stepX > 0
        ? ((tx + 1) * TILE_M - origin.x) / dx
        : (tx * TILE_M - origin.x) / dx;
  let tMaxY =
    stepY === 0
      ? Infinity
      : stepY > 0
        ? ((ty + 1) * TILE_M - origin.y) / dy
        : (ty * TILE_M - origin.y) / dy;

  const reachedLimit = (): RayHit => ({
    x: origin.x + dx * maxDist,
    y: origin.y + dy * maxDist,
    dist: maxDist,
    hit: false,
  });

  for (let i = 0; i < LOS_MAX_STEPS; i++) {
    const t = Math.min(tMaxX, tMaxY);
    if (t > maxDist) return reachedLimit();

    if (tMaxX < tMaxY) {
      tx += stepX;
      tMaxX += invDx;
    } else {
      ty += stepY;
      tMaxY += invDy;
    }

    if (isOpaqueTile(grid, tx, ty)) {
      return { x: origin.x + dx * t, y: origin.y + dy * t, dist: t, hit: true };
    }
  }

  return reachedLimit();
}

/**
 * The lit polygon around `origin`, as a fan of points in angular order.
 *
 * Rays go to two places: every silhouette corner within range (straddled by a
 * pair either side, which is what carves the shadow edge), plus a uniform ring
 * so that unobstructed light is round rather than a polygon of corner-to-corner
 * chords.
 *
 * Client-only. The server never needs the shape, just the boolean — see
 * `canSee` below.
 */
export function visibilityPolygon(grid: OccluderGrid, origin: Vec2, radius: number): Vec2[] {
  const angles: number[] = [];

  for (let i = 0; i < VIS_POLY_RING_RAYS; i++) {
    angles.push((i / VIS_POLY_RING_RAYS) * Math.PI * 2);
  }

  for (const corner of silhouetteCorners(grid, origin, radius)) {
    const a = Math.atan2(corner.y - origin.y, corner.x - origin.x);
    // Normalised into [0, 2pi) to match the ring rays. Sorting atan2's
    // (-pi, pi] against the ring's [0, 2pi) interleaves the two halves of the
    // circle and the fan folds through itself.
    angles.push(
      normaliseAngle(a - LOS_CORNER_EPSILON),
      normaliseAngle(a),
      normaliseAngle(a + LOS_CORNER_EPSILON),
    );
  }

  angles.sort((p, q) => p - q);

  const points: Vec2[] = [];
  for (const a of angles) {
    const hit = castRay(grid, origin, a, radius);
    points.push({ x: hit.x, y: hit.y });
  }

  return points;
}

/** Fold an angle into [0, 2pi), the one convention this module sorts in. */
export function normaliseAngle(a: number): number {
  const twoPi = Math.PI * 2;
  const m = a % twoPi;
  return m < 0 ? m + twoPi : m;
}

/**
 * Lattice points where opaque and clear tiles meet — the only corners that can
 * cast a shadow. Testing all four corners of every solid tile instead would
 * cast thousands of rays per frame to draw the same polygon.
 */
function silhouetteCorners(grid: OccluderGrid, origin: Vec2, radius: number): Vec2[] {
  const minTx = Math.max(0, Math.floor((origin.x - radius) / TILE_M));
  const maxTx = Math.min(grid.w, Math.ceil((origin.x + radius) / TILE_M));
  const minTy = Math.max(0, Math.floor((origin.y - radius) / TILE_M));
  const maxTy = Math.min(grid.h, Math.ceil((origin.y + radius) / TILE_M));

  const out: Vec2[] = [];
  const r2 = radius * radius;

  // Lattice points, so the loop runs one past the tile range on each axis.
  for (let cy = minTy; cy <= maxTy; cy++) {
    for (let cx = minTx; cx <= maxTx; cx++) {
      const x = cx * TILE_M;
      const y = cy * TILE_M;

      const ddx = x - origin.x;
      const ddy = y - origin.y;
      if (ddx * ddx + ddy * ddy > r2) continue;

      // A corner matters only where solid meets clear. All four the same means
      // it is interior to rock or interior to open air; neither casts an edge.
      const a = isOpaqueTile(grid, cx - 1, cy - 1);
      const b = isOpaqueTile(grid, cx, cy - 1);
      const c = isOpaqueTile(grid, cx - 1, cy);
      const d = isOpaqueTile(grid, cx, cy);
      if (a === b && b === c && c === d) continue;

      out.push({ x, y });
    }
  }

  return out;
}

/**
 * Can a viewer at `origin` with a light of `radius` see the point `target`?
 *
 * This is the server's formulation of the same question the polygon answers
 * for the renderer: inside the radius, and nothing solid in between. It is the
 * predicate the whole anti-cheat story rests on (Q122), so it is deliberately
 * the cheap exact test rather than a point-in-polygon check against a shape
 * built for drawing.
 */
export function canSee(
  grid: OccluderGrid,
  origin: Vec2,
  radius: number,
  target: Vec2,
): boolean {
  if (radius <= 0) return false;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (dx * dx + dy * dy > radius * radius) return false;
  return raycastLOS(grid, origin, target);
}
