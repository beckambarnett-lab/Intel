import { describe, expect, it } from 'vitest';
import {
  PERCEPTION_RETENTION_SEC,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
  step,
} from '@ember/shared';
import type { InputFrame, LanternStage, WorldState } from '@ember/shared';
import { CreatureMind } from '../creature/mind.js';
import { buildDirectorContext } from './context.js';
import type { DirectorContext } from './context.js';

/**
 * The most important test in the project (DESIGN.md §19).
 *
 * It asserts the one property the whole enemy design rests on: **the director
 * cannot know anything the pack has not perceived.** Not "is instructed not
 * to" — cannot.
 *
 * This has to be mechanical because the failure is undetectable by playing. An
 * enemy handed live positions reads as uncannily good, not as broken. Nobody
 * reports it. The way it actually gets introduced is not sabotage but a
 * reasonable-looking commit that passes the model a bit more of the world to
 * make it smarter, and this test is the only thing standing in front of that.
 */

const WORLD_W = 600;
const WORLD_H = 120;

let mind: CreatureMind;

function world(): WorldState {
  mind = new CreatureMind(7);
  const w = createWorld(WORLD_W, WORLD_H, createGrid(WORLD_W, WORLD_H));
  w.fire.pos = { x: 20, y: 20 };
  w.players['p1'] = createPlayer('p1', 'p1', { x: 300, y: 60 });
  // One near enough to see a full lantern, one far away doing its own thing.
  w.creatures['c1'] = createCreature('c1', { x: 340, y: 60 });
  w.creatures['c2'] = createCreature('c2', { x: 80, y: 60 });
  return w;
}

const player = (w: WorldState) => w.players['p1']!;

function setLantern(w: WorldState, stage: LanternStage): void {
  const ls = player(w).lantern;
  ls.stage = stage;
  ls.target = stage;
  ls.transition = 0;
  ls.bloom = 0;
  ls.fuel = 999;
}

const still = (seq: number): InputFrame => emptyInput(seq);
const creepWest = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: -1, creep: true });

function context(w: WorldState): DirectorContext {
  return buildDirectorContext(mind.log.snapshot());
}

/**
 * Every position in the context that is a *claim about a player*.
 *
 * A creature's own position is deliberately excluded. Where the pack is
 * standing is its own business and is not knowledge about anybody else — a
 * creature that happens to walk near a hidden player has not learned anything,
 * it has just walked somewhere. The claims that could leak are the observations
 * and the beliefs.
 */
function playerClaimsIn(ctx: DirectorContext): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const e of ctx.events) out.push(e.pos);
  for (const c of ctx.creatures) if (c.believes) out.push(c.believes.pos);
  return out;
}

/** How close the director's picture comes to where the player actually is. */
function closestToPlayer(ctx: DirectorContext, w: WorldState): number {
  const truth = player(w).pos;
  let closest = Infinity;
  for (const p of playerClaimsIn(ctx)) {
    closest = Math.min(closest, Math.hypot(p.x - truth.x, p.y - truth.y));
  }
  return closest;
}

function run(
  w: WorldState,
  seconds: number,
  frame: (seq: number) => InputFrame,
  onTick?: () => void,
): void {
  const hooks = mind.hooks();
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    step(w, { p1: frame(i + 1) }, TICK_DT, hooks);
    onTick?.();
  }
}

describe('the fairness boundary, end to end (Q114)', () => {
  it('shows the director nothing at all about a player who emits nothing', () => {
    const w = world();
    setLantern(w, 'hooded');
    // Hooded and motionless: no light past 4m, and silence is exact (Q58).
    run(w, 45, still);

    const ctx = context(w);

    expect(ctx.blind).toBe(true);
    expect(ctx.events).toHaveLength(0);
    for (const c of ctx.creatures) expect(c.believes).toBeNull();
  });

  it('shows it something once the player actually gives themselves away', () => {
    const w = world();
    setLantern(w, 'full');
    run(w, 2, still);

    const ctx = context(w);

    expect(ctx.blind).toBe(false);
    expect(ctx.events.length).toBeGreaterThan(0);
    expect(ctx.events.some((e) => e.kind === 'light')).toBe(true);
  });

  it('goes blind again after the player breaks contact and waits it out', () => {
    const w = world();

    // Seen clearly.
    setLantern(w, 'full');
    run(w, 3, still);
    expect(context(w).blind).toBe(false);

    // Dark, and away — creeping carries 3m, far short of the creature.
    setLantern(w, 'hooded');
    run(w, 70, creepWest);
    // Then simply wait, well past the retention window.
    run(w, PERCEPTION_RETENTION_SEC / 2 + 10, still);

    const ctx = context(w);

    // The director's picture must decay to nothing, exactly as the pack's does.
    // If any part of the pipeline were reading live state, this is where it
    // would show: the context would keep tracking a player who has been dark
    // and silent for a minute and a half.
    expect(ctx.blind).toBe(true);
    expect(ctx.events).toHaveLength(0);
  });

  it('never tracks a dark, silent player, at any moment of a long run', () => {
    const w = world();

    /**
     * The continuous form of the assertion, checked every tick rather than at
     * the end: at no point may the director's picture sit on top of a player
     * unless the pack has genuinely sensed one recently.
     */
    let lastGenuineSenseTick = -Infinity;
    let worstUnjustified = Infinity;

    const check = (): void => {
      for (const id of Object.keys(w.creatures)) {
        const c = w.creatures[id];
        // Track the newest tick any creature genuinely sensed something.
        // Comparing against `w.tick` directly would never match: `step()`
        // increments the tick at the end, so by the time this runs the counter
        // has already moved past the tick the contact was stamped with.
        if (c?.contact) lastGenuineSenseTick = Math.max(lastGenuineSenseTick, c.contact.tick);
      }

      const sinceSenseSec = (w.tick - lastGenuineSenseTick) * TICK_DT;
      // Allow the retention window: an old observation legitimately lingers.
      if (sinceSenseSec <= PERCEPTION_RETENTION_SEC) return;

      worstUnjustified = Math.min(worstUnjustified, closestToPlayer(context(w), w));
    };

    setLantern(w, 'hooded');
    run(w, 30, still, check);

    // A brief flash, then dark and away before it can close the distance.
    setLantern(w, 'full');
    run(w, 3, still, check);

    setLantern(w, 'hooded');
    run(w, 70, creepWest, check);
    run(w, 60, still, check);
    run(w, 40, creepWest, check);

    // The player has to have survived, or this proves nothing: a corpse stops
    // emitting, and a test that passes because there was nobody left to leak
    // would be worse than no test at all.
    expect(player(w).alive).toBe(true);

    // Outside the retention window, nothing the director is being told about a
    // player may be anywhere near where that player actually is.
    expect(worstUnjustified).toBeGreaterThan(20);
  });

  it('withholds the fire tier unless a creature can actually see the camp', () => {
    const w = world();
    setLantern(w, 'hooded');

    // Camp is at x=20; both creatures are far to the east with clear ground, so
    // line of sight exists and the tier is legitimately known.
    run(w, 1, still);
    expect(context(w).fireTier).not.toBeNull();

    // Wall the camp off completely.
    const w2 = world();
    for (let y = 0; y < WORLD_H; y++) {
      w2.grid.cells[y * w2.grid.w + 40] = 255;
    }
    setLantern(w2, 'hooded');
    run(w2, 1, still);

    // The run's clock is the single most valuable fact in the game. It has to
    // be earned by having something standing where it can see the flame.
    expect(context(w2).fireTier).toBeNull();
  });

  it('reports belief as a confidence, never as a fix on a live position', () => {
    const w = world();
    setLantern(w, 'full');
    run(w, 3, still);

    const seenAt = { ...player(w).pos };

    // Go dark and move a long way. Belief must stay where it was earned and
    // rot, not follow.
    setLantern(w, 'hooded');
    run(w, 40, creepWest);

    const ctx = context(w);
    const believed = ctx.creatures.map((c) => c.believes).filter((b) => b !== null);

    for (const b of believed) {
      const toTruth = Math.hypot(b!.pos.x - player(w).pos.x, b!.pos.y - player(w).pos.y);
      const toSeen = Math.hypot(b!.pos.x - seenAt.x, b!.pos.y - seenAt.y);
      // Anchored to the observation, not to the player.
      expect(toSeen).toBeLessThan(toTruth);
    }
  });
});
