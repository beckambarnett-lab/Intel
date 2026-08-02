import { LIGHT_FALLOFF_STOPS, LIGHT_GRADIENT_PX, PIXELS_PER_METRE, visibilityPolygon } from '@ember/shared';
import type { OccluderGrid, Vec2 } from '@ember/shared';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';

export interface Light {
  pos: Vec2;
  radiusM: number;
  /** Emitted colour. Temperature separation is what makes two lights read as real (§24.4). */
  colour: number;
  /** Multiplier on the falloff. Above 1 the core blows past white before tone-mapping pulls it back. */
  intensity: number;
}

/**
 * The light buffer (§24.2, stages 3 and 4).
 *
 * Each light contributes a coloured radial falloff clipped to its own visibility
 * polygon, accumulating additively. This container is rendered to its own
 * texture and multiplied over the world by the composite pass — it is NOT a
 * mask and must never be added to the visible scene graph.
 *
 * That distinction is the fix for the white fire: as a mask, light could only be
 * white and the mask itself was being drawn over the world, so the screen showed
 * the light field instead of the lit world.
 *
 * Polygon and gradient stay separate on purpose: the polygon decides *whether* a
 * spot is lit, which is line of sight and must stay crisp at shadow edges; the
 * gradient decides *how brightly*, which must not.
 */
export class LightField {
  readonly container = new Container();

  private gradient: Texture;
  private pool: LightSprite[] = [];

  constructor() {
    this.gradient = makeRadialGradientTexture();
  }

  /**
   * Sprites are pooled rather than recreated: at 20+ lights and 60fps, churning
   * Graphics objects every frame is the difference between smooth and not.
   */
  update(grid: OccluderGrid, lights: Light[]): void {
    let used = 0;

    for (const light of lights) {
      if (light.radiusM <= 0 || light.intensity <= 0) continue;

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
      entry.glow.tint = light.colour;
      // Alpha carries intensity; the tone-map absorbs anything over 1.
      entry.glow.alpha = Math.min(light.intensity, 1);

      entry.holder.visible = true;
    }

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
 * The falloff profile, baked once into a white texture and tinted per light.
 *
 * White rather than pre-coloured so one texture serves every source; the tint
 * is what gives the fire and the lantern different temperatures.
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

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}
