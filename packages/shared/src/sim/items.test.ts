import { describe, expect, it } from 'vitest';
import {
  CARRY_CAPACITY_KG,
  DEPOSIT_RANGE_M,
  DEPOSIT_SEC_PER_ITEM,
  FIRE_NOMINAL_FUEL,
  FIRE_STOKE_RANGE_M,
  FIRE_STOKE_SEC,
  FUEL_VALUE,
  MASS_KG,
  PICKUP_RANGE_M,
  TICK_DT,
} from '../constants.js';
import { carriedMassKg, createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, WorldState } from '../types.js';
import { burnRatePerSec } from './fire.js';
import { step } from './index.js';
import { itemInRange, spawnItem } from './items.js';

const FIRE_AT = { x: 12, y: 20 };
const PILE_AT = { x: 12, y: 24 };

function worldWith(atFire = false, logs = 12): WorldState {
  const world = createWorld(60, 40);
  world.fire.pos = { ...FIRE_AT };
  world.woodpile.pos = { ...PILE_AT };

  const pos = atFire ? { x: FIRE_AT.x + 1, y: FIRE_AT.y } : { x: 40, y: 30 };
  const player = createPlayer('p1', 'p1', pos);
  player.carrying.log = logs;
  world.players['p1'] = player;

  return world;
}

const idle = (seq: number): InputFrame => emptyInput(seq);
const hold = (seq: number): InputFrame => ({ ...emptyInput(seq), interact: true });
const panic = (seq: number): InputFrame => ({ ...emptyInput(seq), panicDrop: true });

function run(world: WorldState, seconds: number, frame: (seq: number) => InputFrame = idle): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(world, { p1: frame(i + 1) }, TICK_DT);
}

const me = (world: WorldState) => world.players['p1']!;

describe('stoking (Q8, Q9)', () => {
  it('takes the documented 1.2s channel to land one log', () => {
    const world = worldWith(true);
    world.fire.fuel = 100;
    const before = world.fire.fuel;
    const logsBefore = me(world).carrying.log;

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    expect(me(world).carrying.log).toBe(logsBefore);

    run(world, 2 * TICK_DT, hold);
    expect(me(world).carrying.log).toBe(logsBefore - 1);
    expect(world.fire.fuel).toBeGreaterThan(before);
  });

  it('is interrupted by letting go, and banks nothing', () => {
    const world = worldWith(true);
    world.fire.fuel = 100;
    const logsBefore = me(world).carrying.log;

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    run(world, TICK_DT, idle);
    expect(me(world).stokeProgress).toBe(0);

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    expect(me(world).carrying.log).toBe(logsBefore);
  });

  it('is interrupted by walking out of range (Q8)', () => {
    const world = worldWith(true);
    world.fire.fuel = 100;
    const logsBefore = me(world).carrying.log;

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    me(world).pos.x = FIRE_AT.x + FIRE_STOKE_RANGE_M + 1;
    run(world, TICK_DT, hold);

    expect(me(world).stokeProgress).toBe(0);
    expect(me(world).carrying.log).toBe(logsBefore);
  });

  it('cannot be done from out of range at all', () => {
    const world = worldWith(false);
    const logsBefore = me(world).carrying.log;
    run(world, FIRE_STOKE_SEC * 3, hold);
    expect(me(world).carrying.log).toBe(logsBefore);
  });

  /**
   * This replaces "will not burn a log for a sliver of fuel on a nearly full
   * fire (Q9)", which was the test that made Q9's hard cap the spec: at 299 of
   * 300 it refused the log rather than waste 24 of its 25 fuel.
   *
   * With the cap gone (DECISIONS §6) there is no sliver and nothing to waste —
   * the fire takes the log whole and gets bigger. The protection worth keeping
   * from the old test is the other half of what it checked: that a stoke either
   * consumes the wood and banks all of its fuel, or does neither.
   */
  it('takes the log on a fire that is already at nominal, and banks all of it', () => {
    const world = worldWith(true);
    world.fire.fuel = FIRE_NOMINAL_FUEL - 1;
    const logsBefore = me(world).carrying.log;

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(me(world).carrying.log).toBe(logsBefore - 1);
    // Burned a little over the channel, so allow for the drain rather than
    // asserting the sum exactly.
    expect(world.fire.fuel).toBeGreaterThan(FIRE_NOMINAL_FUEL + FUEL_VALUE.log - 5);
  });

  /**
   * DECISIONS §6: there is no level at which the fire stops accepting wood, and
   * holding the key keeps putting it on. Twelve logs is what used to fill an
   * empty fire (Q10) — now it is just the first twelve.
   */
  it('keeps accepting wood indefinitely, one log per channel', () => {
    const world = worldWith(true, 20);
    world.fire.fuel = FIRE_NOMINAL_FUEL;

    run(world, (FIRE_STOKE_SEC + TICK_DT) * 12, hold);

    expect(me(world).carrying.log).toBeLessThanOrEqual(8);
    expect(world.fire.fuel).toBeGreaterThan(FIRE_NOMINAL_FUEL * 1.8);
  });

  /**
   * A branch is worth 8 and a log 25 (Q10). The fallback used to be about fit —
   * there were fuel levels where the branch went on and the log would not — and
   * now it is only about what you are carrying.
   */
  it('falls back to a branch when there are no logs left', () => {
    const world = worldWith(true, 0);
    me(world).carrying.branch = 1;
    world.fire.fuel = 100;

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(me(world).carrying.branch).toBe(0);
  });

  it('prefers the log when carrying both', () => {
    const world = worldWith(true, 1);
    me(world).carrying.branch = 1;
    world.fire.fuel = 100;

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(me(world).carrying.log).toBe(0);
    expect(me(world).carrying.branch).toBe(1);
  });

  it('adds the documented fuel value of a log (Q10)', () => {
    const world = worldWith(true);
    world.fire.fuel = 100;

    const before = world.fire.fuel;
    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    const burned = burnRatePerSec(world) * (FIRE_STOKE_SEC + TICK_DT);
    expect(world.fire.fuel).toBeCloseTo(before + FUEL_VALUE.log - burned, 1);
  });

  it('stops when you run out of wood', () => {
    const world = worldWith(true, 1);
    world.fire.fuel = 10;

    run(world, FIRE_STOKE_SEC * 4, hold);

    expect(me(world).carrying.log).toBe(0);
    expect(me(world).stokeProgress).toBe(0);
  });
});

/**
 * Q23: the fire can be fed from the pile as well as from hand. Hand first, so
 * that what you just hauled back goes on before the reserve does.
 */
describe('feeding from the woodpile (Q23)', () => {
  it('burns the pile when your hands are empty', () => {
    const world = worldWith(true, 0);
    world.woodpile.pos = { x: FIRE_AT.x + 1, y: FIRE_AT.y };
    world.woodpile.contents.log = 3;
    world.fire.fuel = 100;

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(world.woodpile.contents.log).toBe(2);
  });

  it('uses what you are carrying before it touches the pile', () => {
    const world = worldWith(true, 2);
    world.woodpile.pos = { x: FIRE_AT.x + 1, y: FIRE_AT.y };
    world.woodpile.contents.log = 3;
    world.fire.fuel = 100;

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(me(world).carrying.log).toBe(1);
    expect(world.woodpile.contents.log).toBe(3);
  });
});

describe('the woodpile (Q22)', () => {
  it('deposits one item per 0.25s', () => {
    const world = worldWith(false, 4);
    me(world).pos = { ...PILE_AT };

    run(world, DEPOSIT_SEC_PER_ITEM + TICK_DT, hold);

    expect(me(world).carrying.log).toBe(3);
    expect(world.woodpile.contents.log).toBe(1);
  });

  it('takes an entire load with enough time, and has no capacity limit', () => {
    const world = worldWith(false, 8);
    me(world).pos = { ...PILE_AT };

    run(world, DEPOSIT_SEC_PER_ITEM * 10, hold);

    expect(me(world).carrying.log).toBe(0);
    expect(world.woodpile.contents.log).toBe(8);
  });

  it('does nothing from out of range', () => {
    const world = worldWith(false, 4);
    me(world).pos = { x: PILE_AT.x + DEPOSIT_RANGE_M + 1, y: PILE_AT.y };

    run(world, DEPOSIT_SEC_PER_ITEM * 4, hold);

    expect(me(world).carrying.log).toBe(4);
    expect(world.woodpile.contents.log).toBe(0);
  });
});

describe('pickup and drop (Q15, Q21, Q35)', () => {
  it('picks up a branch you are standing on, instantly and with no tool', () => {
    const world = worldWith(false, 0);
    spawnItem(world, 'branch', { x: me(world).pos.x, y: me(world).pos.y });

    run(world, TICK_DT, hold);

    expect(me(world).carrying.branch).toBe(1);
    expect(Object.keys(world.items)).toHaveLength(0);
  });

  it('does not reach an item out of range', () => {
    const world = worldWith(false, 0);
    spawnItem(world, 'branch', {
      x: me(world).pos.x + PICKUP_RANGE_M + 0.5,
      y: me(world).pos.y,
    });

    run(world, TICK_DT * 4, hold);

    expect(me(world).carrying.branch).toBe(0);
    expect(Object.keys(world.items)).toHaveLength(1);
  });

  it('dumps everything on Q, in one tick (Q35)', () => {
    const world = worldWith(false, 5);
    me(world).carrying.branch = 3;

    run(world, TICK_DT, panic);

    expect(me(world).carrying.log).toBe(0);
    expect(me(world).carrying.branch).toBe(0);
    expect(Object.keys(world.items)).toHaveLength(8);
  });

  it('leaves the dropped wood exactly where it fell (Q21)', () => {
    const world = worldWith(false, 2);
    const at = { ...me(world).pos };

    run(world, TICK_DT, panic);
    run(world, 30);

    // Persists indefinitely — nothing decays it, and nothing tidies it up.
    expect(Object.keys(world.items)).toHaveLength(2);
    for (const item of Object.values(world.items)) {
      expect(Math.hypot(item.pos.x - at.x, item.pos.y - at.y)).toBeLessThan(1.5);
    }
  });

  it('finds the nearest item rather than an arbitrary one', () => {
    const world = worldWith(false, 0);
    const here = me(world).pos;
    spawnItem(world, 'log', { x: here.x + 1.0, y: here.y });
    const near = spawnItem(world, 'branch', { x: here.x + 0.2, y: here.y });

    expect(itemInRange(world, here)?.id).toBe(near.id);
  });
});

describe('weight is what you are carrying (Q33, Q34)', () => {
  it('derives load from the mass table', () => {
    const world = worldWith(false, 3);
    me(world).carrying.branch = 2;

    run(world, TICK_DT);

    expect(me(world).loadKg).toBeCloseTo(3 * MASS_KG.log + 2 * MASS_KG.branch, 6);
    expect(carriedMassKg(me(world).carrying)).toBeCloseTo(me(world).loadKg, 6);
  });

  it('slows you down as the load goes on, without any slot limit stopping you', () => {
    const world = worldWith(false, 0);
    run(world, TICK_DT);
    const empty = me(world).speedMul;

    me(world).carrying.log = 5;
    run(world, TICK_DT);
    const laden = me(world).speedMul;

    expect(empty).toBeCloseTo(1, 6);
    expect(laden).toBeLessThan(empty);
  });

  it('lets you pick up past capacity and stops you dead for it (Q31)', () => {
    const world = worldWith(false, 0);
    // No refusal anywhere — Q34 has no slots, so the curve is the only limit.
    me(world).carrying.log = Math.ceil(CARRY_CAPACITY_KG / MASS_KG.log) + 1;

    run(world, TICK_DT);

    expect(me(world).loadKg).toBeGreaterThan(CARRY_CAPACITY_KG);
    expect(me(world).speedMul).toBe(0);
  });
});

describe('determinism', () => {
  it('produces identical item state from identical inputs', () => {
    const build = (): WorldState => {
      const w = worldWith(true, 4);
      spawnItem(w, 'branch', { x: FIRE_AT.x + 1, y: FIRE_AT.y });
      return w;
    };

    const a = build();
    const b = build();

    for (let i = 0; i < 120; i++) {
      const frame = i === 40 ? panic(i + 1) : i % 2 === 0 ? hold(i + 1) : idle(i + 1);
      step(a, { p1: frame }, TICK_DT);
      step(b, { p1: frame }, TICK_DT);
    }

    expect(a.items).toEqual(b.items);
    expect(a.players).toEqual(b.players);
    expect(a.woodpile).toEqual(b.woodpile);
  });
});
