import {
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
  MEMORY_PROPERLY_LIT_FRAC,
  MEMORY_WRITE_MARGIN_M,
  PIXELS_PER_METRE,
  PLAYER_RADIUS,
  TILE_M,
  canSee,
  isBlockedAt,
  isOpaqueTile,
  mulberry32,
  visibilityPolygon,
} from '@ember/shared';
import type { DroppedLanternView, FireView, OccluderGrid, Vec2, WorldItem } from '@ember/shared';
import { Application, Container, Graphics, RenderTexture, Text, TextStyle } from 'pixi.js';
import type { RenderedCreature, RenderedPlayer } from '../net.js';
import { Composite } from './composite.js';
import { HorizonBloom } from './hud.js';
import { LightField } from './lighting.js';
import type { Light } from './lighting.js';
import { MemoryField } from './memory.js';
import { PhantomField } from './phantoms.js';
import type { PhantomEnv } from './phantoms.js';
import { SeenField } from './seen.js';
import { drawSilhouette } from './silhouette.js';

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

/** A lantern set down on the ground (Q41). */
const DROPPED_LANTERN_DOT_M = 0.26;

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
  droppedLantern: 0xffdca8,
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
  /**
   * Phantoms AND creatures, drawn into one layer by one function.
   *
   * Q52 requires that a real creature in stale memory and a phantom invented by
   * that memory be indistinguishable. Sharing a draw call is the only version
   * of that guarantee which cannot drift: there is no second code path to
   * accidentally give one of them a tell.
   */
  private figureLayer = new Graphics();
  private bodies = new Container();
  private lights = new LightField();
  private bloom = new HorizonBloom();
  private sprites = new Map<string, { holder: Container }>();
  private labelStyle!: TextStyle;

  /** Albedo: the world in full colour, unlit. */
  private albedoRT!: RenderTexture;
  /** Light: every source's coloured falloff, clipped to line of sight. */
  private lightRT!: RenderTexture;
  /** Memory: how long ago you last saw each pixel (Q46). Null until the map lands. */
  private memory: MemoryField | null = null;
  /** The same field on the CPU, for decisions the shader cannot make. */
  private seen: SeenField | null = null;
  /**
   * Q53: memory is per-player, so its hallucinations are too. Seeded from the
   * session rather than from the map — two players standing in the same rotten
   * clearing must not see the same thing in the same place.
   */
  private phantoms = new PhantomField(mulberry32((Math.random() * 0xffffffff) >>> 0));
  private composite: Composite | null = null;
  /** Map bounds in metres, so drawMap can tell a resize from a redraw. */
  private worldW = 0;
  private worldH = 0;
  /** Seconds since start, for flicker and for memory's clock. */
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
    // Memory and the composite are NOT built here. Both bind textures sized to
    // the map, which is not known until the welcome message lands, and a
    // shader's bound resources cannot be swapped afterwards — attempting it
    // throws inside Pixi's bind group on the first frame. drawMap builds them.

    this.labelStyle = new TextStyle({
      fill: COLOUR.label,
      fontSize: 11,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    });

    this.world.addChild(this.ground);
    this.world.addChild(this.occluders);
    this.world.addChild(this.woodpile);
    this.world.addChild(this.itemLayer);
    // Figures go into the albedo alongside everything else, which is what makes
    // Q52 work: they are dimmed, drained and warped by the memory layer exactly
    // as anything else standing in that same stale ground would be.
    this.world.addChild(this.figureLayer);
    this.world.addChild(this.fire);
    this.world.addChild(this.bodies);

    // The world and the light field are NOT on the stage. Each is rendered to
    // its own texture and combined by the composite pass, which is the only
    // thing the stage actually draws — it is inserted beneath the bloom by
    // buildPipeline once the map arrives.
    //
    // The previous renderer used the light field as a mask *and* left it in the
    // display list, so the screen showed the light field itself — a white disc
    // — instead of the lit world underneath it.
    //
    // Above the composite and in screen space: the bloom is glow in the air over
    // the treeline, not a lit surface, so it is not subject to line of sight.
    this.app.stage.addChild(this.bloom.container);

    window.addEventListener('resize', () => this.handleResize());
  }

  /** Render targets are screen-sized, so they have to be rebuilt on resize. */
  private handleResize(): void {
    const { width, height } = this.app.screen;
    if (width === this.albedoRT.width && height === this.albedoRT.height) return;

    // Order matters throughout: the composite goes first, while the textures it
    // samples are still alive. Destroying a texture out from under a live
    // shader and only then tearing the shader down walks Pixi's bind group over
    // freed resources.
    this.teardownComposite();

    this.albedoRT.destroy(true);
    this.lightRT.destroy(true);
    this.albedoRT = RenderTexture.create({ width, height, resolution: 1 });
    this.lightRT = RenderTexture.create({ width, height, resolution: 1 });
    // The last-seen texture is world-sized and survives this: resizing the
    // window must not cost you your memory of the wood.
    this.memory?.resizeScreen(width, height);

    // Rebuilt, never rebound — see Composite.destroy.
    this.buildComposite(width, height);
  }

  private teardownComposite(): void {
    if (!this.composite) return;
    this.app.stage.removeChild(this.composite.mesh);
    this.composite.destroy();
    this.composite = null;
  }

  /**
   * Build the composite against the current render targets.
   *
   * Called once when the map arrives and again on every resize. Each call
   * discards the previous pass entirely: swapping the textures a live shader
   * samples is what was crashing the renderer on frame one.
   */
  private buildComposite(width: number, height: number): void {
    const memory = this.memory;
    if (!memory) return;

    this.teardownComposite();

    this.composite = new Composite(this.albedoRT, this.lightRT, memory.viewTexture);
    this.composite.resize(width, height);
    // Beneath the bloom, which is drawn in screen space on top of everything.
    this.app.stage.addChildAt(this.composite.mesh, 0);
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

    // drawMap runs again every time a felled tree clears a tile (Q20), so both
    // memory stores are sized rather than rebuilt — losing your map because
    // someone chopped a trunk would be a very strange rule.
    if (!this.memory || this.worldW !== widthM || this.worldH !== heightM) {
      // Composite first — it samples the memory field's view texture.
      this.teardownComposite();
      this.memory?.destroy();
      this.memory = new MemoryField(widthM, heightM, this.app.screen.width, this.app.screen.height);
      this.seen = new SeenField(widthM, heightM);
      this.worldW = widthM;
      this.worldH = heightM;
      this.buildComposite(this.app.screen.width, this.app.screen.height);
    }

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
    creatures: RenderedCreature[],
    lanterns: DroppedLanternView[],
    worldItems: WorldItem[],
    cameraTargetM: { x: number; y: number } | null,
    dtSec: number,
  ): void {
    // Until the welcome message lands there is no map, no memory field and no
    // composite — and nothing meaningful to draw.
    const composite = this.composite;
    if (!composite) return;

    this.elapsed += dtSec;

    // Items are drawn inside the masked world container, so wood in the dark
    // is invisible even though we hold it in memory — and the server did not
    // send it anyway (Q21).
    this.itemLayer.clear();
    for (const dl of lanterns) {
      // A small warm body so a decoy reads as an object you left, not as a
      // patch of ground that happens to be lit.
      this.itemLayer
        .circle(dl.pos.x * PIXELS_PER_METRE, dl.pos.y * PIXELS_PER_METRE, DROPPED_LANTERN_DOT_M * PIXELS_PER_METRE)
        .fill(COLOUR.droppedLantern);
    }
    for (const item of worldItems) {
      const r = (item.kind === 'log' ? ITEM_DOT_M.log : ITEM_DOT_M.branch) * PIXELS_PER_METRE;
      this.itemLayer
        .circle(item.pos.x * PIXELS_PER_METRE, item.pos.y * PIXELS_PER_METRE, r)
        .fill(item.kind === 'log' ? COLOUR.log : COLOUR.branch);
    }

    // Named for what it holds: the ids drawn this frame. Not to be confused
    // with `this.seen`, which is the memory field.
    const drawnIds = new Set<string>();

    for (const p of players) {
      drawnIds.add(p.id);
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
      if (drawnIds.has(id)) continue;
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
    // Q41: a lantern on the ground throws exactly the light it threw in your
    // hand. Added to the same list, so it casts the same shadows, writes the
    // same memory and dispels the same phantoms — a decoy is a real light.
    for (const dl of lanterns) {
      if (dl.radiusM <= 0) continue;
      lights.push({
        pos: dl.pos,
        radiusM: dl.radiusM,
        colour: LANTERN_LIGHT_COLOUR,
        intensity:
          LANTERN_LIGHT_INTENSITY *
          flicker(this.elapsed + dl.pos.x, LANTERN_FLICKER_HZ, LANTERN_FLICKER_AMPLITUDE),
      });
    }

    // Cast once, used three times — the light field draws them, memory stamps
    // them, and the phantoms are dispelled by them. Casting per consumer would
    // triple the most expensive work in the frame.
    const polys = lights.map((l) => visibilityPolygon(grid, l.pos, l.radiusM));

    const camera = cameraTargetM;
    const offset: Vec2 = camera
      ? {
          x: this.app.screen.width / 2 - camera.x * PIXELS_PER_METRE,
          y: this.app.screen.height / 2 - camera.y * PIXELS_PER_METRE,
        }
      : { x: this.world.x, y: this.world.y };

    // What gets committed to memory, and how much of each light commits it.
    //
    // Only lights you could actually be looking at refresh your memory (Q53) —
    // without that gate the bonfire's own polygon keeps camp permanently fresh
    // from 800m away, which is precisely the kind of lie this system exists to
    // stop the map telling. And only the properly-lit core of each one records
    // anything (Q55), so the outer edge of your beam shows you new ground
    // without yet committing it.
    const remembered = camera
      ? lights
          .map((light, i) => ({
            pos: light.pos,
            radiusM: light.radiusM * MEMORY_PROPERLY_LIT_FRAC,
            full: light.radiusM,
            poly: polys[i] ?? [],
          }))
          .filter((r) => this.onScreen(r.pos, r.full, camera))
      : [];

    this.memory?.write(
      this.app.renderer,
      remembered,
      remembered.map((r) => r.poly),
      this.elapsed,
    );
    for (const r of remembered) {
      this.seen?.mark(grid, r.pos, r.radiusM, this.elapsed);
    }

    // Phantoms move and are dispelled BEFORE they are drawn, so a phantom that
    // walked into your light this frame never reaches the albedo at all (Q51).
    this.updatePhantoms(grid, lights, camera, dtSec, creatures);

    this.lights.update(lights, polys);
    this.drawFlame(fire);

    this.bloom.update(fire, cameraTargetM, this.app.screen, dtSec);

    if (camera) {
      this.world.x = offset.x;
      this.world.y = offset.y;
      this.lights.container.x = offset.x;
      this.lights.container.y = offset.y;
    }

    // §24.2 stages 1-5 and 9. Order is not negotiable: albedo, light and memory
    // are gathered separately so the composite can multiply, tone-map and then
    // cross-fade them. Tone-mapping before accumulation would flatten the
    // falloff instead of preventing the clip.
    const renderer = this.app.renderer;
    renderer.render({ container: this.world, target: this.albedoRT, clear: true });
    renderer.render({ container: this.lights.container, target: this.lightRT, clear: true });
    this.memory?.renderView(renderer, this.elapsed, offset);
    renderer.render({ container: this.app.stage });
  }

  /**
   * Q54: on revival your memory is wiped, hallucinations and all.
   *
   * Death arrives in Step 8; the wipe lives here because it belongs to the
   * memory system rather than to whatever ends up calling it.
   */
  forget(): void {
    this.memory?.forget(this.app.renderer);
    this.seen?.forget();
    this.phantoms.forget();
  }

  /** Could this light's polygon reach the viewport at all? */
  private onScreen(pos: Vec2, radiusM: number, camera: Vec2): boolean {
    const halfW = this.app.screen.width / (2 * PIXELS_PER_METRE);
    const halfH = this.app.screen.height / (2 * PIXELS_PER_METRE);
    const slack = radiusM + MEMORY_WRITE_MARGIN_M;
    return Math.abs(pos.x - camera.x) <= halfW + slack && Math.abs(pos.y - camera.y) <= halfH + slack;
  }

  /**
   * Spawn, drift and dispel (Q49–Q52), then draw what survived.
   *
   * Note which store answers which question in the env below. `blockedAt` reads
   * the TRUE occluder grid and `rotAt` reads memory — a phantom is placed by
   * what you have forgotten and constrained by what is actually there, and the
   * two are never swapped (Q48).
   */
  private updatePhantoms(
    grid: OccluderGrid,
    lights: Light[],
    camera: Vec2 | null,
    dtSec: number,
    creatures: RenderedCreature[],
  ): void {
    this.figureLayer.clear();

    // Real hunters first, through the identical draw call the phantoms use.
    // The server only sent these because this player can see them (Q122).
    for (const c of creatures) {
      const facing = Math.atan2(camera ? camera.y - c.y : 0, camera ? camera.x - c.x : 1);
      drawSilhouette(this.figureLayer, c.x, c.y, facing);
    }

    const seen = this.seen;
    if (!camera || !seen) return;

    const now = this.elapsed;
    const env: PhantomEnv = {
      rotAt: (x, y) => seen.rotAt(x, y, now),
      seenAt: (x, y) => seen.seenAt(x, y),
      blockedAt: (x, y) => isBlockedAt(grid, x, y),
      // Full radii here, not the reduced ones memory records with: Q51 dispels
      // on any real light touching them, which includes the dim outer edge of
      // a beam that would never have committed the ground to memory.
      litAt: (x, y) => lights.some((l) => canSee(grid, l.pos, l.radiusM, { x, y })),
    };

    this.phantoms.update(env, camera, dtSec);

    for (const phantom of this.phantoms.phantoms) {
      // Facing the player, because they are always coming toward you (Q50).
      const facing = Math.atan2(camera.y - phantom.pos.y, camera.x - phantom.pos.x);
      drawSilhouette(this.figureLayer, phantom.pos.x, phantom.pos.y, facing);
    }
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
