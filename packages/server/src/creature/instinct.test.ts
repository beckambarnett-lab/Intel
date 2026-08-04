import { describe, expect, it } from 'vitest';
import {
  CREATURE_KILL_RANGE_M,
  CREATURE_RESPAWN_SEC,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
} from '@ember/shared';
import type { InputFrame, LanternStage, SimHooks, WorldState } from '@ember/shared';
import { step } from '@ember/shared';
import { killCreature } from './instinct.js';
import { CreatureMind } from './mind.js';

/**
 * A fresh mind per world, so belief never leaks between test cases.
 * `hooks()` is exactly what Room passes to `step()`, so these exercise the
 * real wiring rather than a test-only arrangement of the same functions.
 */
let mind: CreatureMind;
let hooks: SimHooks;

function world(): WorldState {
  mind = new CreatureMind(1);
  hooks = mind.hooks();
  const w = createWorld(200, 60, createGrid(200, 60));
  // Fire well out of the way unless a test wants it.
  w.fire.pos = { x: 5, y: 5 };
  w.creatures['c1'] = createCreature('c1', { x: 100, y: 30 });
  w.players['p1'] = createPlayer('p1', 'p1', { x: 140, y: 30 });
  return w;
}

const creature = (w: WorldState) => w.creatures['c1']!;
const player = (w: WorldState) => w.players['p1']!;

function setLantern(w: WorldState, stage: LanternStage): void {
  const ls = player(w).lantern;
  ls.stage = stage;
  ls.target = stage;
  ls.transition = 0;
  ls.bloom = 0;
  // Keep the tank full so a long test never goes dark by accident.
  ls.fuel = 50;
}

const still = (seq: number): InputFrame => emptyInput(seq);
const creepEast = (seq: number): InputFrame => ({
  ...emptyInput(seq),
  moveX: 1,
  creep: true,
});

function run(w: WorldState, seconds: number, frame: (seq: number) => InputFrame = still): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(w, { p1: frame(i + 1) }, TICK_DT, hooks);
}

const gap = (w: WorldState) =>
  Math.hypot(player(w).pos.x - creature(w).pos.x, player(w).pos.y - creature(w).pos.y);

describe('creature instinct — the hunt', () => {
  it('closes on a lantern it can see', () => {
    const w = world();
    setLantern(w, 'full');
    const before = gap(w);

    run(w, 2);

    expect(gap(w)).toBeLessThan(before);
    expect(creature(w).contact?.via).toBe('light');
  });

  it('reaches you, and reaching you kills (Q62)', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 104, y: 30 };

    // Watch for the moment of contact rather than the state at the end: once
    // you are dead nothing senses you any more, so the creature loses interest
    // and sweeps away, and the final gap says nothing about what happened.
    let closest = Infinity;
    const ticks = Math.round(4 / TICK_DT);
    for (let i = 0; i < ticks; i++) {
      step(w, { p1: still(i + 1) }, TICK_DT, hooks);
      if (player(w).alive) closest = Math.min(closest, gap(w));
    }

    expect(player(w).alive).toBe(false);
    expect(closest).toBeLessThanOrEqual(CREATURE_KILL_RANGE_M + 0.5);
  });

  it('commits to a charge once it is close and can see you', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 108, y: 30 };

    run(w, 0.5);

    expect(creature(w).stance).toBe('charge');
  });

  it('sweeps, and keeps moving, when it has sensed nothing at all', () => {
    const w = world();
    setLantern(w, 'hooded');
    // Far enough that neither light nor sound reaches it.
    player(w).pos = { x: 190, y: 55 };
    const start = { ...creature(w).pos };

    run(w, 5);

    expect(creature(w).contact).toBeNull();
    expect(creature(w).stance).toBe('sweep');
    expect(Math.hypot(creature(w).pos.x - start.x, creature(w).pos.y - start.y)).toBeGreaterThan(1);
  });
});

describe('creature instinct — the counterplay (Step 6 gate)', () => {
  /**
   * The behaviour Step 6 exists to produce: you are seen, you kill your light,
   * you move somewhere else quietly, and it loses you.
   *
   * This is the test that says the light economy works. If a creature could
   * still find a dark, silent, relocated player, the shutter would stop being a
   * decision and the whole game would come apart.
   */
  it('loses a player who goes dark and relocates', () => {
    const w = world();
    setLantern(w, 'full');

    // Seen once, clearly.
    run(w, 0.5);
    const seenAt = { ...creature(w).contact!.pos };
    expect(creature(w).contact).not.toBeNull();

    // Shutter closed, and creep away — creeping carries only 3m (Q58).
    setLantern(w, 'hooded');

    // Track how close it ever got to the spot it last had you. Checking where
    // it merely ended up would prove nothing: after giving up it sweeps, so a
    // creature that never went at all and one that went and moved on can sit
    // the same distance away at the final tick.
    let closestToSeen = Infinity;
    const ticks = Math.round(16 / TICK_DT);
    for (let i = 0; i < ticks; i++) {
      step(w, { p1: creepEast(i + 1) }, TICK_DT, hooks);
      closestToSeen = Math.min(
        closestToSeen,
        Math.hypot(creature(w).pos.x - seenAt.x, creature(w).pos.y - seenAt.y),
      );
    }

    expect(player(w).alive).toBe(true);
    expect(creature(w).contact).toBeNull();
    expect(creature(w).stance).toBe('sweep');

    // It committed to where it last had you...
    expect(closestToSeen).toBeLessThan(2);
    // ...and that is nowhere near where you actually are.
    expect(gap(w)).toBeGreaterThan(10);
  });

  it('calls out when it loses the trail', () => {
    const w = world();
    setLantern(w, 'full');
    run(w, 0.5);

    setLantern(w, 'hooded');

    let heardLost = false;
    const ticks = Math.round(16 / TICK_DT);
    for (let i = 0; i < ticks; i++) {
      step(w, { p1: creepEast(i + 1) }, TICK_DT, hooks);
      if (creature(w).vocalizing === 'lost') heardLost = true;
    }

    expect(heardLost).toBe(true);
  });

  it('standing still where it last saw you is still fatal', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 115, y: 30 };

    // Going dark is necessary but not sufficient — it walks to where you were,
    // and you are still standing there.
    run(w, 0.5);
    setLantern(w, 'hooded');
    run(w, 10, still);

    expect(player(w).alive).toBe(false);
  });
});

describe('creature instinct — the camp perimeter (Q7)', () => {
  it('cannot cross the fire safe radius while the fire holds', () => {
    const w = world();
    w.fire.pos = { x: 100, y: 30 };
    step(w, {}, TICK_DT, hooks);
    const safe = w.fire.safeRadiusM;
    expect(safe).toBeGreaterThan(0);

    // Put the player at the fire and light them up, so the creature wants in.
    player(w).pos = { x: 100, y: 30 };
    setLantern(w, 'full');
    creature(w).pos = { x: 130, y: 30 };

    run(w, 12);

    const toFire = Math.hypot(
      creature(w).pos.x - w.fire.pos.x,
      creature(w).pos.y - w.fire.pos.y,
    );
    expect(toFire).toBeGreaterThanOrEqual(safe - 0.6);
    expect(player(w).alive).toBe(true);
  });

  it('may enter once the fire drops below Low and the perimeter fails', () => {
    const w = world();
    w.fire.pos = { x: 100, y: 30 };
    w.fire.fuel = 1; // guttering: below FIRE_PERIMETER_MIN_FRAC
    step(w, {}, TICK_DT, hooks);
    expect(w.fire.safeRadiusM).toBe(0);

    player(w).pos = { x: 101, y: 30 };
    setLantern(w, 'full');
    creature(w).pos = { x: 112, y: 30 };

    run(w, 8);

    expect(player(w).alive).toBe(false);
  });
});

describe('creature instinct — death and return (Q57)', () => {
  it('comes back from the lair after five minutes', () => {
    const w = world();
    killCreature(creature(w));
    expect(creature(w).alive).toBe(false);

    run(w, CREATURE_RESPAWN_SEC - 5);
    expect(creature(w).alive).toBe(false);

    run(w, 6);
    expect(creature(w).alive).toBe(true);
    // Back at its anchor, and already sweeping outward from it again.
    const fromAnchor = Math.hypot(
      creature(w).pos.x - creature(w).anchor.x,
      creature(w).pos.y - creature(w).anchor.y,
    );
    expect(fromAnchor).toBeLessThan(10);
  });

  it('is silent and harmless while dead', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 102, y: 30 };
    killCreature(creature(w));

    run(w, 3);

    expect(player(w).alive).toBe(true);
    expect(w.sounds.filter((s) => s.sourceId === 'c1')).toHaveLength(0);
  });
});
