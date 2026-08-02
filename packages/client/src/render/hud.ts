import {
  BLOOM_FADE_SEC,
  BLOOM_OFFSCREEN_MARGIN_M,
  PIXELS_PER_METRE,
  BLOOM_EDGE_OFFSET_PX,
  BLOOM_MAX_ALPHA,
  BLOOM_MAX_RANGE_M,
  BLOOM_MIN_RANGE_M,
  BLOOM_SIZE_FAR,
  BLOOM_SIZE_NEAR,
  BLOOM_TIER_BRIGHTNESS,
  LIGHT_FALLOFF_STOPS,
  LIGHT_GRADIENT_PX,
} from '@ember/shared';
import type { FireView, Vec2 } from '@ember/shared';
import { Container, Sprite, Texture } from 'pixi.js';

/** Firelight orange — the only saturated colour in the game (Q128). */
const BLOOM_TINT = 0xff8a2b;

/**
 * The horizon bloom (Q13).
 *
 * The fire's glow, seen from far enough away that the fire itself is over the
 * horizon: a warm smear at the edge of the screen in the direction of home,
 * dimming with distance and with the fire's tier.
 *
 * This is the navigation system. There is no minimap, no compass and no
 * objective marker (Q127) — if you are lost in the dark, this is the only
 * thing that tells you which way camp is, and a fire you have let burn down is
 * correspondingly harder to find. Losing the fire loses you the map.
 *
 * Drawn unmasked, above the light field: it is glow scattered in the air over
 * the treeline, not a lit surface, so line of sight does not apply to it.
 */
export class HorizonBloom {
  readonly container = new Container();

  private sprite: Sprite;
  /** 0..1 eased visibility, so the bloom fades across the screen edge. */
  private fade = 0;

  constructor() {
    this.sprite = new Sprite(makeBloomTexture());
    this.sprite.anchor.set(0.5);
    this.sprite.tint = BLOOM_TINT;
    this.sprite.blendMode = 'add';
    this.sprite.visible = false;
    this.container.addChild(this.sprite);
  }

  /**
   * @param fire     the fire as the server describes it
   * @param eye      the local player's world position, metres
   * @param screen   viewport size in pixels
   */
  update(
    fire: FireView | null,
    eye: Vec2 | null,
    screen: { width: number; height: number },
    dtSec = 0,
  ): void {
    const target = this.wantsBloom(fire, eye, screen) ? 1 : 0;

    // Fade rather than pop. The fire crossing the screen edge is a continuous
    // event and a hard cut there reads as a rendering bug.
    const rate = BLOOM_FADE_SEC > 0 ? dtSec / BLOOM_FADE_SEC : 1;
    this.fade += Math.sign(target - this.fade) * Math.min(rate, Math.abs(target - this.fade));

    if (this.fade <= 0.001 || !fire || !eye) {
      this.sprite.visible = false;
      return;
    }

    const dx = fire.pos.x - eye.x;
    const dy = fire.pos.y - eye.y;
    const distM = Math.hypot(dx, dy);

    // 0 at the near edge, 1 at the far edge.
    const t = clamp01((distM - BLOOM_MIN_RANGE_M) / (BLOOM_MAX_RANGE_M - BLOOM_MIN_RANGE_M));

    const brightness = BLOOM_TIER_BRIGHTNESS[fire.tier];
    // Squared falloff so the last stretch home is where it becomes legible,
    // rather than the glow reading as "near" across most of the map.
    this.sprite.alpha = BLOOM_MAX_ALPHA * brightness * (1 - t) * (1 - t) * this.fade;

    const minAxis = Math.min(screen.width, screen.height);
    const size = minAxis * (BLOOM_SIZE_NEAR + (BLOOM_SIZE_FAR - BLOOM_SIZE_NEAR) * t);
    this.sprite.width = size;
    this.sprite.height = size;

    const at = edgePoint(dx, dy, screen);
    this.sprite.x = at.x;
    this.sprite.y = at.y;
    this.sprite.visible = true;
  }

  /**
   * The bloom's entire job is pointing you home when you *cannot see camp*
   * (Q13). The old gate was a fixed 18m, but at 16px/m a 1280px viewport is
   * ~80m wide — so the glow appeared while the fire was still plainly on
   * screen, which is noise, and noise trains players to ignore the one
   * navigation aid the game has.
   *
   * Gate on the viewport instead: the fire must be genuinely off screen, plus a
   * margin so it does not flicker on and off while hovering at the edge.
   */
  private wantsBloom(
    fire: FireView | null,
    eye: Vec2 | null,
    screen: { width: number; height: number },
  ): boolean {
    if (!fire || !eye || fire.dead) return false;

    const dx = fire.pos.x - eye.x;
    const dy = fire.pos.y - eye.y;

    if (Math.hypot(dx, dy) >= BLOOM_MAX_RANGE_M) return false;

    const halfWidthM = screen.width / 2 / PIXELS_PER_METRE + BLOOM_OFFSCREEN_MARGIN_M;
    const halfHeightM = screen.height / 2 / PIXELS_PER_METRE + BLOOM_OFFSCREEN_MARGIN_M;

    // Off screen on either axis is enough — the fire only has to have left the
    // viewport, not to be beyond both its corners.
    return Math.abs(dx) > halfWidthM || Math.abs(dy) > halfHeightM;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Where a ray from the screen centre in direction (dx, dy) leaves the viewport,
 * pushed a little further out so the glow reads as coming from beyond the edge
 * rather than sitting on it.
 */
function edgePoint(dx: number, dy: number, screen: { width: number; height: number }): Vec2 {
  const cx = screen.width / 2;
  const cy = screen.height / 2;

  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: cx, y: cy };

  const ux = dx / len;
  const uy = dy / len;

  // Distance along the ray to each axis' bound; the nearer one is the edge hit.
  const tx = ux !== 0 ? cx / Math.abs(ux) : Infinity;
  const ty = uy !== 0 ? cy / Math.abs(uy) : Infinity;
  const t = Math.min(tx, ty) + BLOOM_EDGE_OFFSET_PX;

  return { x: cx + ux * t, y: cy + uy * t };
}

/**
 * A soft radial blob. Same falloff profile as the light gradient, so the bloom
 * reads as the same substance as the firelight it comes from.
 */
function makeBloomTexture(): Texture {
  const size = LIGHT_GRADIENT_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the horizon bloom');

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const stop of LIGHT_FALLOFF_STOPS) {
    grad.addColorStop(stop.at, `rgba(255,255,255,${stop.alpha})`);
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}
