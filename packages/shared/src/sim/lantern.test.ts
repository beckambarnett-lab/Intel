import { describe, expect, it } from 'vitest';
import {
  LANTERN_BLOOM_MULT,
  LANTERN_BLOOM_SEC,
  LANTERN_SHUTTER_SEC,
  LANTERN_STAGES,
  LANTERN_STAGE_ORDER,
  LANTERN_TANK,
  TICK_DT,
} from '../constants.js';
import { createLantern, createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, WorldState } from '../types.js';
import { step } from './index.js';
import { lanternSeenAt } from './lantern.js';
import { lanternRadius } from './lantern.js';

function worldWithPlayer(): WorldState {
  const world = createWorld(60, 40);
  world.players['p1'] = createPlayer('p1', 'test', { x: 30, y: 20 });
  return world;
}

function idle(seq: number): InputFrame {
  return emptyInput(seq);
}

function press(seq: number): InputFrame {
  return { ...emptyInput(seq), shutter: true };
}

/** Run n idle ticks. */
function settle(world: WorldState, ticks: number, from = 100): void {
  for (let i = 0; i < ticks; i++) step(world, { p1: idle(from + i) }, TICK_DT);
}

describe('shutter (Q37, Q40)', () => {
  it('starts at low and cycles hooded -> low -> full -> hooded', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;
    expect(ls.stage).toBe('low');

    step(world, { p1: press(1) }, TICK_DT);
    expect(ls.target).toBe('full');
    settle(world, 20);
    expect(ls.stage).toBe('full');

    step(world, { p1: press(2) }, TICK_DT);
    settle(world, 20, 200);
    expect(ls.stage).toBe('hooded');

    step(world, { p1: press(3) }, TICK_DT);
    settle(world, 20, 300);
    expect(ls.stage).toBe('low');
  });

  it('takes the documented 0.3s to move', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;

    step(world, { p1: press(1) }, TICK_DT);
    expect(ls.transition).toBeGreaterThan(0);
    expect(ls.stage).toBe('low');

    // One tick short of the transition, it has not arrived.
    const ticksToSettle = Math.ceil(LANTERN_SHUTTER_SEC / TICK_DT);
    settle(world, ticksToSettle - 2);
    expect(ls.stage).toBe('low');

    settle(world, 2, 500);
    expect(ls.stage).toBe('full');
  });

  it('sweeps the radius across the transition rather than jumping', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;

    step(world, { p1: press(1) }, TICK_DT);
    const mid = lanternRadius(ls);

    expect(mid).toBeGreaterThan(LANTERN_STAGES.low.radiusM);
    expect(mid).toBeLessThan(LANTERN_STAGES.full.radiusM);
  });

  it('blooms past the settled radius on opening, then relaxes (Q40)', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;

    step(world, { p1: press(1) }, TICK_DT);
    settle(world, Math.ceil(LANTERN_SHUTTER_SEC / TICK_DT));

    expect(ls.stage).toBe('full');
    expect(ls.bloom).toBeGreaterThan(0);
    expect(lanternRadius(ls)).toBeGreaterThan(LANTERN_STAGES.full.radiusM);
    expect(lanternRadius(ls)).toBeLessThanOrEqual(
      LANTERN_STAGES.full.radiusM * LANTERN_BLOOM_MULT,
    );

    settle(world, Math.ceil(LANTERN_BLOOM_SEC / TICK_DT) + 1, 600);
    expect(ls.bloom).toBe(0);
    expect(lanternRadius(ls)).toBeCloseTo(LANTERN_STAGES.full.radiusM, 6);
  });

  it('does not bloom on closing — only opening gives you away', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;

    // low -> full -> hooded, landing on a close.
    step(world, { p1: press(1) }, TICK_DT);
    settle(world, 20);
    settle(world, 20, 200); // let the opening bloom expire
    expect(ls.bloom).toBe(0);

    step(world, { p1: press(2) }, TICK_DT);
    settle(world, 20, 400);
    expect(ls.stage).toBe('hooded');
    expect(ls.bloom).toBe(0);
  });
});

describe('fuel (Q38)', () => {
  it('burns at the rate of the stage it is set to', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;

    // 20 ticks = one second at low.
    settle(world, 20);
    expect(LANTERN_TANK - ls.fuel).toBeCloseTo(LANTERN_STAGES.low.burnPerSec, 6);
  });

  it('gutters out and goes dark when the tank runs dry', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;
    ls.fuel = LANTERN_STAGES.low.burnPerSec * TICK_DT * 1.5;

    settle(world, 3);

    expect(ls.fuel).toBe(0);
    expect(ls.stage).toBe('hooded');
    expect(lanternRadius(ls)).toBe(0);
  });
});

/**
 * The shutter runs through the same replayed `step()` as movement, so a press
 * must survive reconciliation. If a held key were sent instead of an edge, the
 * replay would cycle the shutter once per pending frame.
 */
describe('determinism under replay', () => {
  it('replaying the same frames produces the same lantern state', () => {
    const frames: InputFrame[] = [press(1), idle(2), idle(3), press(4), idle(5), idle(6), idle(7)];

    const a = worldWithPlayer();
    const b = worldWithPlayer();
    for (const f of frames) {
      step(a, { p1: f }, TICK_DT);
      step(b, { p1: f }, TICK_DT);
    }

    expect(a.players['p1']!.lantern).toEqual(b.players['p1']!.lantern);
  });

  it('a single press cycles exactly one stage no matter how it is replayed', () => {
    const world = worldWithPlayer();
    const ls = world.players['p1']!.lantern;

    step(world, { p1: press(1) }, TICK_DT);
    expect(ls.target).toBe('full');

    // The same intent replayed as idle frames must not cycle again.
    settle(world, 30);
    expect(ls.stage).toBe('full');
    expect(ls.target).toBe('full');
  });
});

/**
 * Q40 makes the opening bloom "a tell that can get you caught". These are the
 * assertions that make that a mechanic rather than a visual effect.
 */
describe('how far off you can be seen (Q37/Q40)', () => {
  it('reads the Q37 table at rest', () => {
    const ls = createLantern();
    for (const stage of LANTERN_STAGE_ORDER) {
      ls.stage = stage;
      ls.target = stage;
      ls.transition = 0;
      ls.bloom = 0;
      expect(lanternSeenAt(ls)).toBeCloseTo(LANTERN_STAGES[stage].seenAtM, 5);
    }
  });

  it('sweeps rather than jumping while the shutter moves', () => {
    const ls = createLantern();
    ls.stage = 'hooded';
    ls.target = 'full';
    ls.transition = LANTERN_SHUTTER_SEC / 2;
    ls.bloom = 0;

    const mid = lanternSeenAt(ls);
    expect(mid).toBeGreaterThan(LANTERN_STAGES.hooded.seenAtM);
    expect(mid).toBeLessThan(LANTERN_STAGES.full.seenAtM);
  });

  it('gives you away from further than the stage you opened to, mid-bloom', () => {
    const ls = createLantern();
    ls.stage = 'low';
    ls.target = 'low';
    ls.transition = 0;
    ls.bloom = LANTERN_BLOOM_SEC;

    expect(lanternSeenAt(ls)).toBeGreaterThan(LANTERN_STAGES.low.seenAtM);
  });

  it('cannot be seen at all with a dry tank', () => {
    const ls = createLantern();
    ls.fuel = 0;
    expect(lanternSeenAt(ls)).toBe(0);
  });
});
