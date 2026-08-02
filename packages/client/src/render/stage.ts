import {
  BLOOM_TIER_BRIGHTNESS,
  PIXELS_PER_METRE,
  PLAYER_RADIUS,
  TILE_M,
  isOpaqueTile,
} from '@ember/shared';
import type { FireView, OccluderGrid, Vec2, WorldItem } from '@ember/shared';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderedPlayer } from '../net.js';
import { HorizonBloom } from './hud.js';
import { LightField } from './lighting.js';
import type { Light } from './lighting.js';

/** How bright the flame sprite itself looks, by tier. */
function fireBodyAlpha(fire: FireView): number {
  if (fire.dead) return 0.15;
  return BLOOM_TIER_BRIGHTNESS[fire.tier];
}

/** Radius of a dropped item's marker, metres. */
const ITEM_DOT_M = { log: 0.22, branch: 0.14 } as const;

const COLOUR = {
  ground: 0x14141a,
  grid: 0x1c1c24,
  occluder: 0x2c2c36,
  occluderEdge: 0x3a3a48,
  fire: 0xff9436,
  log: 0x8a6a44,
  branch: 0x6d5c46,
  woodpile: 0x4a3a2a,
  localPlayer: 0xffb454, // firelight orange — the one warm colour (Q128)
  remotePlayer: 0x7d8ea3,
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

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x000000,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    mount.appendChild(this.app.canvas);

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

    // The light field shares the world's transform, so both are added to the
    // stage and moved together by the camera below.
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.lights.container);
    this.world.mask = this.lights.container;

    // Above the mask and in screen space: the bloom is glow in the air over the
    // treeline, not a lit surface, so it is not subject to line of sight.
    this.app.stage.addChild(this.bloom.container);
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

    this.fire.clear();
    this.fire
      .circle(firePos.x * PIXELS_PER_METRE, firePos.y * PIXELS_PER_METRE, 0.6 * PIXELS_PER_METRE)
      .fill(COLOUR.fire);

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
  ): void {
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
    if (fire) lights.push({ pos: fire.pos, radiusM: fire.lightRadiusM });
    for (const p of players) {
      lights.push({ pos: { x: p.x, y: p.y }, radiusM: p.lightRadiusM });
    }
    this.lights.update(grid, lights);

    // The fire's own body dims as it dies, so a guttering fire is a coal rather
    // than a flame even before you read the tier.
    this.fire.alpha = fire ? fireBodyAlpha(fire) : 1;

    this.bloom.update(fire, cameraTargetM, this.app.screen);

    if (cameraTargetM) {
      const x = this.app.screen.width / 2 - cameraTargetM.x * PIXELS_PER_METRE;
      const y = this.app.screen.height / 2 - cameraTargetM.y * PIXELS_PER_METRE;
      this.world.x = x;
      this.world.y = y;
      this.lights.container.x = x;
      this.lights.container.y = y;
    }
  }
}
