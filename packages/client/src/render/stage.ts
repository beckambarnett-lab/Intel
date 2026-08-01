import { PIXELS_PER_METRE, PLAYER_RADIUS } from '@ember/shared';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderedPlayer } from '../net.js';

const COLOUR = {
  ground: 0x14141a,
  grid: 0x1e1e27,
  wall: 0x3a3a48,
  localPlayer: 0xffb454, // firelight orange — the one warm colour (Q128)
  remotePlayer: 0x7d8ea3,
  label: 0xc8c4bd,
} as const;

/**
 * Step 1 renderer: a lit rectangle with debug bodies, enough to see that
 * movement and netcode are correct.
 *
 * Everything here is placeholder. Step 2 replaces the flat draw with the
 * lighting mask, at which point the ground stops being visible by default and
 * the game starts looking like itself.
 */
export class Stage {
  private app = new Application();
  private world = new Container();
  private ground = new Graphics();
  private bodies = new Container();
  private sprites = new Map<string, { holder: Container }>();
  private labelStyle!: TextStyle;

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      background: COLOUR.ground,
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
    this.world.addChild(this.bodies);
    this.app.stage.addChild(this.world);
  }

  /** Draw the sandbox floor. Called once bounds are known. */
  drawBounds(widthM: number, heightM: number): void {
    const w = widthM * PIXELS_PER_METRE;
    const h = heightM * PIXELS_PER_METRE;

    this.ground.clear();
    this.ground.rect(0, 0, w, h).fill(COLOUR.ground);

    // A metre grid, so speed and distance are readable while tuning.
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

    this.ground.rect(0, 0, w, h).stroke({ width: 2, color: COLOUR.wall });
  }

  render(players: RenderedPlayer[], cameraTargetM: { x: number; y: number } | null): void {
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

    if (cameraTargetM) {
      this.world.x = this.app.screen.width / 2 - cameraTargetM.x * PIXELS_PER_METRE;
      this.world.y = this.app.screen.height / 2 - cameraTargetM.y * PIXELS_PER_METRE;
    }
  }
}
