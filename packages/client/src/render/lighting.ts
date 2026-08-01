import {
  DARKNESS_FLOOR_ALPHA,
  LIGHT_FALLOFF_STOPS,
  LIGHT_GRADIENT_PX,
  PIXELS_PER_METRE,
  visibilityPolygon,
} from '@ember/shared';
import type { OccluderGrid, Vec2 } from '@ember/shared';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';

export interface Light {
  pos: Vec2;
  radiusM: number;
}

/**
 * The darkness.
 *
 * Every light contributes a radial falloff sprite clipped to its own visibility
 * polygon; they accumulate into one container which is then used as the mask
 * for the whole world. What is not lit is not drawn — so the screen genuinely
 * goes black when you hood the lantern rather than merely getting dimmer.
 *
 * The polygon is geometry, the gradient is falloff, and they are separate on
 * purpose: the polygon decides *whether* a spot is lit (that is line of sight,
 * and it must be crisp at shadow edges), the gradient decides *how brightly*.
 */
export class LightField {
  /** Masked over the world container. Lives in world space, like the world. */
  readonly container = new Container();

  private gradient: Texture;
  private pool: LightSprite[] = [];

  constructor() {
    this.gradient = makeRadialGradientTexture();
  }

  /**
   * Rebuild the mask for this frame.
   *
   * Sprites are pooled rather than recreated: at 20+ lights and 60fps, churning
   * Graphics objects every frame is the difference between smooth and not.
   */
  update(grid: OccluderGrid, lights: Light[]): void {
    let used = 0;

    for (const light of lights) {
      if (light.radiusM <= 0) continue;

      const entry = this.acquire(used++);
      const poly = visibilityPolygon(grid, light.pos, light.radiusM);

      entry.shape.clear();
      if (poly.length >= 3) {
        entry.shape.poly(poly.map((p) => ({ x: p.x * PIXELS_PER_METRE, y: p.y * PIXELS_PER_METRE })));
        entry.shape.fill({ color: 0xffffff });
      }

      const diameter = light.radiusM * 2 * PIXELS_PER_METRE;
      entry.glow.width = diameter;
      entry.glow.height = diameter;
      entry.glow.x = light.pos.x * PIXELS_PER_METRE;
      entry.glow.y = light.pos.y * PIXELS_PER_METRE;

      entry.holder.visible = true;
    }

    // Park the surplus rather than destroying it — light counts fluctuate every
    // time somebody walks in or out of view.
    for (let i = used; i < this.pool.length; i++) {
      const entry = this.pool[i];
      if (entry) entry.holder.visible = false;
    }
  }

  private acquire(index: number): LightSprite {
    const existing = this.pool[index];
    if (existing) return existing;

    const glow = new Sprite(this.gradient);
    glow.anchor.set(0.5);
    // Additive so overlapping lights brighten rather than punching holes in
    // each other where their polygons meet.
    glow.blendMode = 'add';

    const shape = new Graphics();

    const holder = new Container();
    holder.addChild(glow);
    holder.addChild(shape);
    // The polygon clips the glow to what is actually in line of sight.
    glow.mask = shape;

    this.container.addChild(holder);

    const entry: LightSprite = { holder, glow, shape };
    this.pool[index] = entry;
    return entry;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.gradient.destroy(true);
    this.pool = [];
  }
}

interface LightSprite {
  holder: Container;
  glow: Sprite;
  shape: Graphics;
}

/**
 * The falloff profile, baked once into a texture.
 *
 * A canvas gradient rather than a shader because this is a static lookup that
 * never changes — the shader budget belongs to Step 5's memory rot.
 */
function makeRadialGradientTexture(): Texture {
  const size = LIGHT_GRADIENT_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the light gradient');

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const stop of LIGHT_FALLOFF_STOPS) {
    grad.addColorStop(stop.at, `rgba(255,255,255,${stop.alpha})`);
  }

  // A hair of light everywhere keeps unlit ground from being a dead black
  // rectangle; it is far too dim to read anything by.
  ctx.fillStyle = `rgba(255,255,255,${DARKNESS_FLOOR_ALPHA})`;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}
