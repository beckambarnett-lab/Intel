export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Clamp a vector to unit length. Used on movement input so that holding two
 * directions does not grant diagonal speed, while analogue sticks keep their
 * partial magnitude.
 */
export function clampToUnit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len <= 1 || len === 0) return { x: v.x, y: v.y };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Deterministic PRNG (mulberry32). The sim must never call Math.random —
 * client prediction replays server ticks and has to reproduce them exactly.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
