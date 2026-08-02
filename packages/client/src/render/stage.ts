import {
  COMPOSITE_AMBIENT,
  COMPOSITE_EXPOSURE,
  FIRE_CORE_COLOUR,
  FIRE_CORE_RADIUS_M,
  FIRE_FLICKER_AMPLITUDE,
  FIRE_FLICKER_HZ,
  FIRE_LIGHT_COLOUR,
  FIRE_LIGHT_INTENSITY,
  LANTERN_FLICKER_AMPLITUDE,
  LANTERN_FLICKER_HZ,
  LANTERN_LIGHT_COLOUR,
  LANTERN_LIGHT_INTENSITY,
  PIXELS_PER_METRE,
  PLAYER_RADIUS,
  TILE_M,
  isOpaqueTile,
} from '@ember/shared';
import type { FireView, OccluderGrid, Vec2, WorldItem } from '@ember/shared';
import { Application, Container, Graphics, RenderTexture, Text, TextStyle } from 'pixi.js';
import type { RenderedPlayer } from '../net.js';
import { Composite } from './composite.js';
import { HorizonBloom } from './hud.js';
import { LightField } from './lighting.js';
import type { Light } from './lighting.js';

/**
 * Deterministic-looking flicker without a PRNG.
 *
 * Two incommensurable sine waves read as irregular to the eye while staying
 * cheap and frame-rate independent. A real random walk would shimmer.
 */
function flicker(tSec: number, hz: number, amplitude: number): number {
  const a = Math.sin(tSec * hz * Math.PI * 2);
  const b = Math.sin(tSec * hz * 0.37 * Math.PI * 2 + 1.7);
  return 1 + (a * 0.6 + b * 0.4) * amplitude;
}

/** Radius of a dropped item's marker, metres. */
const ITEM_DOT_M = { log: 0.22, branch: 0.14 } as const;

/**
 * Albedo, not screen colour.
 *
 * These are surface *reflectance* values now, multiplied by light in the
 * composite pass — so they must read as a lit material, not as the dim final
 * pixel. The previous values were near-black because they were being drawn
 * straight to screen; multiplied by light they left the world invisible.
 *
 * Placeholder until 4B replaces them with textures and normal maps.
 */
const COLOUR = {
  ground: 0x6b6157,
  grid: 0x7a6f63,
  occluder: 0x8a7a66,
  occluderEdge: 0xa4917a,
  fire: 0xff9436,
  log: 0xb08a58,
  branch: 0x94795a,
  woodpile: 0x7d6242,
  localPlayer: 0xffb454, // firelight orange — the one warm colour (Q128)
  remotePlayer: 0xa8b6c6,
  label: 0xc8c4bd,
} as const;

/**
 * The renderer.
 *
 * The world is drawn in full and then masked by the light field, so the only
 * thing on screen is what is genuinely lit. Note that this is a rendering
 * concern only — the server has already refused to send anything outside the
 * light (Q122), so the mask is the second of two locks, not the only one.
 */
export class Stage {
  private app = new Application();
  /** Everything that gets masked by light. */
  private world = new Container();
  private ground = new Graphics();
  private occluders = new Graphics();
  private fire = new Graphics();
  private woodpile = new Graphics();
  private itemLayer = new Graphics();
  private bodies = new Container();
  private lights = new LightField();
  private bloom = new HorizonBloom();
  private sprites = new Map<string, { holder: Container }>();
  private labelStyle!: TextStyle;

  /** Albedo: the world in full colour, unlit. */
  private albedoRT!: RenderTexture;
  /** Light: every source's coloured falloff, clipped to line of sight. */
  private lightRT!: RenderTexture;
  private composite!: Composite;
  /** Seconds since start, for flicker. */
  private elapsed = 0;

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x000000,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      // WebGL rather than WebGPU so the composite shader has one language to
      // maintain rather than a GLSL and a WGSL variant that can drift apart.
      preference: 'webgl',
      // Rendering is driven from the game loop's fixed-timestep frame, not from
      // Pixi's ticker — the three passes below must run in order, every frame.
      autoStart: false,
    });

    mount.appendChild(this.app.canvas);

    const { width, height } = this.app.screen;
    this.albedoRT = RenderTexture.create({ width, height, resolution: 1 });
    this.lightRT = RenderTexture.create({ width, height, resolution: 1 });
    this.composite = new Composite(this.albedoRT, this.lightRT);
    this.composite.resize(width, height);
    this.composite.exposure = COMPOSITE_EXPOSURE;

    this.labelStyle = new TextStyle({
      fill: COLOUR.label,
      fontSize: 11,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    });

    this.world.addChild(this.ground);
    this.world.addChild(this.occluders);
    this.world.addChild(this.woodpile);
    this.world.addChild(this.itemLayer);
    this.world.addChild(this.fire);
    this.world.addChild(this.bodies);

    // The world and the light field are NOT on the stage. Each is rendered to
    // its own texture and combined by the composite pass, which is the only
    // thing the stage actually draws.
    //
    // The previous renderer used the light field as a mask *and* left it in the
    // display list, so the screen showed the light field itself — a white disc
    // — instead of the lit world underneath it.
    this.app.stage.addChild(this.composite.mesh);

    // Above the composite and in screen space: the bloom is glow in the air over
    // the treeline, not a lit surface, so it is not subject to line of sight.
    this.app.stage.addChild(this.bloom.container);

    window.addEventListener('resize', () => this.handleResize());
  }

  /** Render targets are screen-sized, so they have to be rebuilt on resize. */
  private handleResize(): void {
    const { width, height } = this.app.screen;
    if (width === this.albedoRT.width && height === this.albedoRT.height) return;

    this.albedoRT.destroy(true);
    this.lightRT.destroy(true);
    this.albedoRT = RenderTexture.create({ width, height, resolution: 1 });
    this.lightRT = RenderTexture.create({ width, height, resolution: 1 });
    this.composite.rebind(this.albedoRT, this.lightRT);
    this.composite.resize(width, height);
  }

  /**
   * Draw the static world once: ground, then every solid tile.
   *
   * The full map is drawn even though most of it is never lit — masking is
   * cheaper than rebuilding geometry per frame, and none of it reaches the
   * screen unless a light polygon reveals it.
   */
  drawMap(
    grid: OccluderGrid,
    widthM: number,
    heightM: number,
    firePos: Vec2,
    woodpilePos: Vec2,
  ): void {
    const w = widthM * PIXELS_PER_METRE;
    const h = heightM * PIXELS_PER_METRE;

    this.ground.clear();
    this.ground.rect(0, 0, w, h).fill(COLOUR.ground);

    for (let x = 0; x <= widthM; x += 5) {
      this.ground
        .moveTo(x * PIXELS_PER_METRE, 0)
        .lineTo(x * PIXELS_PER_METRE, h)
        .stroke({ width: 1, color: COLOUR.grid });
    }
    for (let y = 0; y <= heightM; y += 5) {
      this.ground
        .moveTo(0, y * PIXELS_PER_METRE)
        .lineTo(w, y * PIXELS_PER_METRE)
        .stroke({ width: 1, color: COLOUR.grid });
    }

    this.occluders.clear();
    const tilePx = TILE_M * PIXELS_PER_METRE;
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        if (!isOpaqueTile(grid, tx, ty)) continue;
        this.occluders
          .rect(tx * tilePx, ty * tilePx, tilePx, tilePx)
          .fill(COLOUR.occluder)
          .stroke({ width: 1, color: COLOUR.occluderEdge });
      }
    }

    // The flame is redrawn every frame in drawFlame() — it flickers and its size
    // tracks the fire tier, so it cannot be baked into the static map pass.

    this.woodpile.clear();
    this.woodpile
      .rect(
        (woodpilePos.x - 0.9) * PIXELS_PER_METRE,
        (woodpilePos.y - 0.6) * PIXELS_PER_METRE,
        1.8 * PIXELS_PER_METRE,
        1.2 * PIXELS_PER_METRE,
      )
      .fill(COLOUR.woodpile)
      .stroke({ width: 1, color: COLOUR.log });
  }

  render(
    grid: OccluderGrid,
    fire: FireView | null,
    players: RenderedPlayer[],
    worldItems: WorldItem[],
    cameraTargetM: { x: number; y: number } | null,
    dtSec: number,
  ): void {
    this.elapsed += dtSec;

    // Items are drawn inside the masked world container, so wood in the dark
    // is invisible even though we hold it in memory — and the server did not
    // send it anyway (Q21).
    this.itemLayer.clear();
    for (const item of worldItems) {
      const r = (item.kind === 'log' ? ITEM_DOT_M.log : ITEM_DOT_M.branch) * PIXELS_PER_METRE;
      this.itemLayer
        .circle(item.pos.x * PIXELS_PER_METRE, item.pos.y * PIXELS_PER_METRE, r)
        .fill(item.kind === 'log' ? COLOUR.log : COLOUR.branch);
    }

    const seen = new Set<string>();

    for (const p of players) {
      seen.add(p.id);
      let sprite = this.sprites.get(p.id);

      if (!sprite) {
        const body = new Graphics();
        const colour = p.isLocal ? COLOUR.localPlayer : COLOUR.remotePlayer;
        body.circle(0, 0, PLAYER_RADIUS * PIXELS_PER_METRE).fill(colour);

        const label = new Text({ text: p.name, style: this.labelStyle });
        label.anchor.set(0.5, 1);
        label.y = -PLAYER_RADIUS * PIXELS_PER_METRE - 4;

        // Move the holder, never the body, so the label travels with it.
        const holder = new Container();
        holder.addChild(body);
        holder.addChild(label);
        this.bodies.addChild(holder);

        sprite = { holder };
        this.sprites.set(p.id, sprite);
      }

      sprite.holder.x = p.x * PIXELS_PER_METRE;
      sprite.holder.y = p.y * PIXELS_PER_METRE;
    }

    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      sprite.holder.destroy({ children: true });
      this.sprites.delete(id);
    }

    // Every visible lantern plus the bonfire. Anyone whose light should not be
    // contributing is already absent from `players` — the server culled them.
    const lights: Light[] = [];
    if (fire && !fire.dead) {
      lights.push({
        pos: fire.pos,
        radiusM: fire.lightRadiusM,
        colour: FIRE_LIGHT_COLOUR[fire.tier],
        intensity:
          FIRE_LIGHT_INTENSITY[fire.tier] *
          flicker(this.elapsed, FIRE_FLICKER_HZ, FIRE_FLICKER_AMPLITUDE),
      });
    }
    for (const p of players) {
      if (p.lightRadiusM <= 0) continue;
      lights.push({
        pos: { x: p.x, y: p.y },
        radiusM: p.lightRadiusM,
        colour: LANTERN_LIGHT_COLOUR,
        intensity:
          LANTERN_LIGHT_INTENSITY *
          flicker(this.elapsed + p.x, LANTERN_FLICKER_HZ, LANTERN_FLICKER_AMPLITUDE),
      });
    }
    this.lights.update(grid, lights);
    this.drawFlame(fire);

    this.bloom.update(fire, cameraTargetM, this.app.screen, dtSec);

    if (cameraTargetM) {
      const x = this.app.screen.width / 2 - cameraTargetM.x * PIXELS_PER_METRE;
      const y = this.app.screen.height / 2 - cameraTargetM.y * PIXELS_PER_METRE;
      this.world.x = x;
      this.world.y = y;
      this.lights.container.x = x;
      this.lights.container.y = y;
    }

    // §24.2 stages 1-5 and 9. Order is not negotiable: albedo and light are
    // gathered separately so the composite can multiply and then tone-map them.
    // Tone-mapping before accumulation would flatten the falloff instead of
    // preventing the clip.
    const renderer = this.app.renderer;
    renderer.render({ container: this.world, target: this.albedoRT, clear: true });
    renderer.render({ container: this.lights.container, target: this.lightRT, clear: true });
    renderer.render({ container: this.app.stage });
  }

  /**
   * The flame body, drawn into the albedo so the fire is a *shape* and not just
   * a bright patch of ground.
   *
   * Size and colour both track the tier, so the clock is legible at a glance
   * without a number anywhere on screen (§24.6) — a guttering fire is visibly a
   * small dull coal, a roaring one a broad pale flame.
   */
  private drawFlame(fire: FireView | null): void {
    this.fire.clear();
    if (!fire) return;

    const px = fire.pos.x * PIXELS_PER_METRE;
    const py = fire.pos.y * PIXELS_PER_METRE;

    if (fire.dead) {
      this.fire.circle(px, py, FIRE_CORE_RADIUS_M.embers * PIXELS_PER_METRE * 0.6).fill(0x2a1408);
      return;
    }

    const wobble = flicker(this.elapsed, FIRE_FLICKER_HZ, FIRE_FLICKER_AMPLITUDE * 2);
    const r = FIRE_CORE_RADIUS_M[fire.tier] * PIXELS_PER_METRE * wobble;

    // Two concentric bodies: a cooler outer flame and a hotter core, which is
    // what makes it read as burning rather than as a flat disc.
    this.fire.circle(px, py, r * 1.55).fill({ color: FIRE_LIGHT_COLOUR[fire.tier], alpha: 0.55 });
    this.fire.circle(px, py, r).fill(FIRE_CORE_COLOUR[fire.tier]);
  }
}
