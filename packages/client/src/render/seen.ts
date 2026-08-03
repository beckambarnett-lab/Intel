import {
  MEMORY_ROT_FULL_SEC,
  MEMORY_ROT_START_SEC,
  MEMORY_TEXELS_PER_METRE,
  canSee,
} from '@ember/shared';
import type { OccluderGrid, Vec2 } from '@ember/shared';

/**
 * The CPU half of memory: when each square metre of the world was last seen.
 *
 * The GPU keeps the same field in a texture (`memory.ts`) because the shader
 * needs it per-pixel; this copy exists because phantoms have to make decisions
 * — *is this spot rotten enough to hallucinate in?* — and reading a render
 * target back every frame would stall the pipeline.
 *
 * The two are separate stores of the same fact, which is a real risk, so they
 * are written from the same input on the same frame by the same caller. Neither
 * is ever consulted about geometry: this file can answer "how stale is your
 * memory of here", never "is there a tree here" (Q48).
 */
export class SeenField {
  readonly wTiles: number;
  readonly hTiles: number;

  /**
   * Seconds since run start when this tile was last lit, or NEVER.
   *
   * A sentinel rather than zero: zero is a legitimate timestamp — the first
   * frame of a run, and any frame at all after a revival resets the clock —
   * and conflating "seen at the very start" with "never seen" would make the
   * ground under your feet at spawn read as maximally distorted (Q55).
   */
  private lastSeen: Float32Array;

  constructor(widthM: number, heightM: number) {
    this.wTiles = Math.ceil(widthM * MEMORY_TEXELS_PER_METRE);
    this.hTiles = Math.ceil(heightM * MEMORY_TEXELS_PER_METRE);
    this.lastSeen = new Float32Array(this.wTiles * this.hTiles).fill(NEVER);
  }

  /**
   * Stamp `nowSec` over everything a light at `origin` reveals.
   *
   * Uses the same `canSee` predicate the server culls with (Q122), rather than
   * a point-in-polygon test against the shape the renderer draws. Two reasons:
   * it is the cheaper exact test, and it means what you remember is exactly
   * what the server was willing to tell you — memory can never contain
   * something the anti-cheat boundary refused to send.
   */
  mark(grid: OccluderGrid, origin: Vec2, radiusM: number, nowSec: number): void {
    if (radiusM <= 0) return;

    const scale = MEMORY_TEXELS_PER_METRE;
    const minX = Math.max(0, Math.floor((origin.x - radiusM) * scale));
    const maxX = Math.min(this.wTiles - 1, Math.ceil((origin.x + radiusM) * scale));
    const minY = Math.max(0, Math.floor((origin.y - radiusM) * scale));
    const maxY = Math.min(this.hTiles - 1, Math.ceil((origin.y + radiusM) * scale));

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const centre = { x: (tx + 0.5) / scale, y: (ty + 0.5) / scale };
        if (!canSee(grid, origin, radiusM, centre)) continue;
        this.lastSeen[ty * this.wTiles + tx] = nowSec;
      }
    }
  }

  /** Seconds since start when this point was last lit, or NEVER. */
  lastSeenAt(x: number, y: number): number {
    const tx = Math.floor(x * MEMORY_TEXELS_PER_METRE);
    const ty = Math.floor(y * MEMORY_TEXELS_PER_METRE);
    // Off the map is not somewhere you have been.
    if (tx < 0 || ty < 0 || tx >= this.wTiles || ty >= this.hTiles) return NEVER;
    return this.lastSeen[ty * this.wTiles + tx] ?? NEVER;
  }

  seenAt(x: number, y: number): boolean {
    return this.lastSeenAt(x, y) !== NEVER;
  }

  /** How stale this memory is, in seconds. Infinite where you have never been. */
  ageAt(x: number, y: number, nowSec: number): number {
    const last = this.lastSeenAt(x, y);
    if (last === NEVER) return Infinity;
    return Math.max(0, nowSec - last);
  }

  /**
   * Rot, 0..1, on the same curve the shader uses (Q46). Never-seen ground is
   * fully rotten, which is what Q55 asks for.
   */
  rotAt(x: number, y: number, nowSec: number): number {
    return rot(this.ageAt(x, y, nowSec));
  }

  /** Q54: revival wipes your map. Nothing calls this until Step 8 exists. */
  forget(): void {
    this.lastSeen.fill(NEVER);
  }
}

/** Not a timestamp. Chosen so it can never collide with one. */
const NEVER = -1;

/** The Q46 decay curve, shared by the CPU field and the memory shader. */
export function rot(ageSec: number): number {
  if (!Number.isFinite(ageSec)) return 1;
  return smoothstep(MEMORY_ROT_START_SEC, MEMORY_ROT_FULL_SEC, ageSec);
}

/** GLSL's smoothstep, so the two implementations of the curve cannot drift. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
