import { describe, expect, it } from 'vitest';
import {
  FIRE_BASE_BURN_PER_SEC,
  FIRE_BURN_PER_EXTRA_PLAYER,
  FIRE_CAPACITY,
  FIRE_EMBER_GRACE_SEC,
  FIRE_ESCALATION_PERIOD_SEC,
  FIRE_ESCALATION_PER_10_MIN,
  FIRE_PERIMETER_MIN_FRAC,
  FIRE_SAFE_RADIUS_FRAC,
  FIRE_STOKE_RANGE_M,
  FIRE_STOKE_SEC,
  FIRE_TIERS,
  FUEL_VALUE,
  TICK_DT,
} from '../constants.js';
import { createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, WorldState } from '../types.js';
import { burnRatePerSec, lightRadiusForFraction, safeRadiusFor, tierForFraction } from './fire.js';
import { step } from './index.js';

const FIRE_AT = { x: 12, y: 20 };

function worldWith(playerCount: number, atFire = false): WorldState {
  const world = createWorld(60, 40);
  world.fire.pos = { ...FIRE_AT };

  for (let i = 0; i < playerCount; i++) {
    const id = `p${i + 1}`;
    const pos = atFire ? { x: FIRE_AT.x + 1, y: FIRE_AT.y } : { x: 40, y: 30 };
    world.players[id] = createPlayer(id, id, pos);
  }

  return world;
}

function idle(seq: number): InputFrame {
  return emptyInput(seq);
}

function hold(seq: number): InputFrame {
  return { ...emptyInput(seq), interact: true };
}

/** Run the sim for `seconds`, feeding every player the same frame. */
function run(world: WorldState, seconds: number, frame: (seq: number) => InputFrame = idle): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    const inputs: Record<string, InputFrame> = {};
    for (const id of Object.keys(world.players)) inputs[id] = frame(i + 1);
    step(world, inputs, TICK_DT);
  }
}

/**
 * The headline number in the whole design: a full fire lasts five minutes.
 * Everything about how far you dare walk is calibrated against it.
 */
describe('burn rate (Q1-Q4)', () => {
  it('empties a full fire in exactly five minutes, solo', () => {
    const world = worldWith(1);

    run(world, 5 * 60 - 1);
    expect(world.fire.fuel).toBeGreaterThan(0);

    run(world, 1);
    expect(world.fire.fuel).toBe(0);
  });

  it('is exactly the base rate for one player at the start of the run', () => {
    const world = worldWith(1);
    expect(burnRatePerSec(world)).toBeCloseTo(FIRE_BASE_BURN_PER_SEC, 9);
  });

  it('burns 8% faster per player past the first (Q3)', () => {
    expect(burnRatePerSec(worldWith(2))).toBeCloseTo(
      FIRE_BASE_BURN_PER_SEC * (1 + FIRE_BURN_PER_EXTRA_PLAYER),
      9,
    );
    expect(burnRatePerSec(worldWith(4))).toBeCloseTo(
      FIRE_BASE_BURN_PER_SEC * (1 + FIRE_BURN_PER_EXTRA_PLAYER * 3),
      9,
    );
  });

  /**
   * The escalation is a step at each ten-minute mark, not a continuous ramp.
   * A ramp would start eating into the very first fire and the five minute
   * promise above would quietly become four minutes fifty-three.
   */
  it('steps up 10% at each ten-minute mark (Q4)', () => {
    const world = worldWith(1);

    world.tick = Math.floor((FIRE_ESCALATION_PERIOD_SEC - 1) / TICK_DT);
    expect(burnRatePerSec(world)).toBeCloseTo(FIRE_BASE_BURN_PER_SEC, 9);

    world.tick = Math.ceil(FIRE_ESCALATION_PERIOD_SEC / TICK_DT);
    expect(burnRatePerSec(world)).toBeCloseTo(
      FIRE_BASE_BURN_PER_SEC * (1 + FIRE_ESCALATION_PER_10_MIN),
      9,
    );

    world.tick = Math.ceil((FIRE_ESCALATION_PERIOD_SEC * 3) / TICK_DT);
    expect(burnRatePerSec(world)).toBeCloseTo(
      FIRE_BASE_BURN_PER_SEC * (1 + FIRE_ESCALATION_PER_10_MIN * 3),
      9,
    );
  });

  it('never drives fuel below zero', () => {
    const world = worldWith(4);
    run(world, 60 * 6);
    expect(world.fire.fuel).toBe(0);
  });
});

describe('tiers and radii (Q5, Q6)', () => {
  it('names each tier at its documented fuel fraction', () => {
    expect(tierForFraction(1)).toBe('roaring');
    expect(tierForFraction(0.8)).toBe('roaring');
    expect(tierForFraction(0.5)).toBe('burning');
    expect(tierForFraction(0.2)).toBe('low');
    expect(tierForFraction(0.05)).toBe('guttering');
    expect(tierForFraction(0)).toBe('embers');
  });

  it('hits each tier’s documented radius at the centre of its band', () => {
    // Anchored at band centres — see FIRE_RADIUS_ANCHORS for why.
    for (const [i, tier] of FIRE_TIERS.entries()) {
      const upper = i === 0 ? 1 : FIRE_TIERS[i - 1]!.minFrac;
      const centre = (tier.minFrac + upper) / 2;
      expect(lightRadiusForFraction(centre)).toBeCloseTo(tier.radiusM, 6);
    }
  });

  it('interpolates smoothly instead of stepping at tier boundaries', () => {
    // Either side of the roaring/burning boundary at 75%.
    const below = lightRadiusForFraction(0.749);
    const above = lightRadiusForFraction(0.751);
    expect(Math.abs(above - below)).toBeLessThan(0.1);
  });

  it('grows monotonically with fuel', () => {
    let previous = -1;
    for (let frac = 0; frac <= 1.0001; frac += 0.01) {
      const r = lightRadiusForFraction(frac);
      expect(r).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = r;
    }
  });

  it('clamps outside the anchor range', () => {
    expect(lightRadiusForFraction(0)).toBeCloseTo(FIRE_TIERS[FIRE_TIERS.length - 1]!.radiusM, 6);
    expect(lightRadiusForFraction(1)).toBeCloseTo(FIRE_TIERS[0]!.radiusM, 6);
  });

  it('keeps the safe radius at 70% of the light while the fire holds (Q6)', () => {
    const light = lightRadiusForFraction(0.8);
    expect(safeRadiusFor(0.8, light)).toBeCloseTo(light * FIRE_SAFE_RADIUS_FRAC, 6);
  });

  it('collapses the perimeter entirely below Low (Q7)', () => {
    const justUnder = FIRE_PERIMETER_MIN_FRAC - 0.001;
    expect(safeRadiusFor(justUnder, lightRadiusForFraction(justUnder))).toBe(0);
    expect(safeRadiusFor(0, 1.5)).toBe(0);
  });
});

describe('the ember scramble (L15, Q7)', () => {
  it('enters embers at zero fuel with the full grace period', () => {
    const world = worldWith(1);
    run(world, 5 * 60);

    expect(world.fire.fuel).toBe(0);
    expect(world.fire.tier).toBe('embers');
    expect(world.fire.emberSecLeft).toBeCloseTo(FIRE_EMBER_GRACE_SEC, 1);
    expect(world.outcome).toBeNull();
  });

  it('ends the run when the countdown expires, and not a moment before', () => {
    const world = worldWith(1);
    run(world, 5 * 60);

    run(world, FIRE_EMBER_GRACE_SEC - 1);
    expect(world.outcome).toBeNull();
    expect(world.fire.dead).toBe(false);

    run(world, 1.5);
    expect(world.outcome).toBe('embersDied');
    expect(world.fire.dead).toBe(true);
    expect(world.fire.lightRadiusM).toBe(0);
  });

  it('is relightable with wood, resetting the grace period', () => {
    const world = worldWith(1, true);
    run(world, 5 * 60);
    expect(world.fire.fuel).toBe(0);

    // Half the grace gone, then someone gets a log on.
    run(world, 30);
    expect(world.fire.emberSecLeft).toBeLessThan(FIRE_EMBER_GRACE_SEC / 2 + 1);

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(world.fire.fuel).toBeGreaterThan(0);
    expect(world.fire.emberSecLeft).toBeCloseTo(FIRE_EMBER_GRACE_SEC, 1);
    expect(world.outcome).toBeNull();
  });

  /**
   * Stoking runs at tick stage 8 and the loss check at stage 14, so a log that
   * lands on the very last tick still counts. Ordering these the other way
   * round would make the last second of the scramble a lie.
   */
  it('a log on the final tick saves the run', () => {
    const world = worldWith(1, true);
    run(world, 5 * 60);

    // Channel up to one tick short of completing.
    run(world, FIRE_STOKE_SEC - TICK_DT, hold);
    // Burn the rest of the grace away with the channel still held.
    const remaining = world.fire.emberSecLeft;
    run(world, remaining, hold);

    expect(world.outcome).toBeNull();
    expect(world.fire.fuel).toBeGreaterThan(0);
  });

  it('stays dead once the run has ended', () => {
    const world = worldWith(1, true);
    run(world, 5 * 60 + FIRE_EMBER_GRACE_SEC + 1);
    expect(world.outcome).toBe('embersDied');

    const logsBefore = world.players['p1']!.carriedLogs;
    run(world, 5, hold);

    expect(world.fire.fuel).toBe(0);
    expect(world.fire.dead).toBe(true);
    // And it does not silently eat your wood trying.
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);
  });
});

describe('stoking (Q8, Q9)', () => {
  it('takes the documented 1.2s channel to land one log', () => {
    const world = worldWith(1, true);
    world.fire.fuel = 100;
    const before = world.fire.fuel;
    const logsBefore = world.players['p1']!.carriedLogs;

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);

    run(world, 2 * TICK_DT, hold);
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore - 1);
    // Net of the fuel that burned away during the channel.
    expect(world.fire.fuel).toBeGreaterThan(before);
  });

  it('is interrupted by letting go, and banks nothing', () => {
    const world = worldWith(1, true);
    const logsBefore = world.players['p1']!.carriedLogs;

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    run(world, TICK_DT, idle);
    expect(world.players['p1']!.stokeProgress).toBe(0);

    // Starting again has to pay the full channel over.
    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);
  });

  it('is interrupted by walking out of range (Q8)', () => {
    const world = worldWith(1, true);
    const logsBefore = world.players['p1']!.carriedLogs;

    run(world, FIRE_STOKE_SEC - 2 * TICK_DT, hold);
    world.players['p1']!.pos.x = FIRE_AT.x + FIRE_STOKE_RANGE_M + 1;
    run(world, TICK_DT, hold);

    expect(world.players['p1']!.stokeProgress).toBe(0);
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);
  });

  it('cannot be done from out of range at all', () => {
    const world = worldWith(1, false); // spawned away from the fire
    const logsBefore = world.players['p1']!.carriedLogs;

    run(world, FIRE_STOKE_SEC * 3, hold);
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);
  });

  it('hard caps at capacity and does not consume a log to overfill (Q9)', () => {
    const world = worldWith(1, true);
    expect(world.fire.fuel).toBe(FIRE_CAPACITY);

    const logsBefore = world.players['p1']!.carriedLogs;
    // The fire is full, so the channel never even starts.
    run(world, FIRE_STOKE_SEC + TICK_DT, hold);
    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);
    expect(world.fire.fuel).toBeLessThanOrEqual(FIRE_CAPACITY);
  });

  /**
   * A log has to fit whole or not go on at all — otherwise topping up a
   * nearly-full fire silently burns a full log for a couple of points of fuel.
   */
  it('will not burn a log for a sliver of fuel on a nearly full fire', () => {
    const world = worldWith(1, true);
    world.fire.fuel = FIRE_CAPACITY - 1;
    const logsBefore = world.players['p1']!.carriedLogs;

    run(world, FIRE_STOKE_SEC * 2, hold);

    expect(world.players['p1']!.carriedLogs).toBe(logsBefore);
    expect(world.fire.fuel).toBeLessThanOrEqual(FIRE_CAPACITY);
  });

  it('accepts a log the moment a whole one fits, and reaches exactly capacity', () => {
    const world = worldWith(1, true);
    world.fire.fuel = FIRE_CAPACITY - FUEL_VALUE.log;
    const logsBefore = world.players['p1']!.carriedLogs;

    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    expect(world.players['p1']!.carriedLogs).toBe(logsBefore - 1);
    expect(world.fire.fuel).toBeLessThanOrEqual(FIRE_CAPACITY);
    expect(world.fire.fuel).toBeGreaterThan(FIRE_CAPACITY - FUEL_VALUE.log);
  });

  it('stops when you run out of wood', () => {
    const world = worldWith(1, true);
    world.players['p1']!.carriedLogs = 1;
    world.fire.fuel = 10;

    run(world, FIRE_STOKE_SEC * 4, hold);

    expect(world.players['p1']!.carriedLogs).toBe(0);
    expect(world.players['p1']!.stokeProgress).toBe(0);
  });

  it('adds the documented fuel value of a log (Q10)', () => {
    const world = worldWith(1, true);
    world.fire.fuel = 100;

    const before = world.fire.fuel;
    run(world, FIRE_STOKE_SEC + TICK_DT, hold);

    const burned = burnRatePerSec(world) * (FIRE_STOKE_SEC + TICK_DT);
    expect(world.fire.fuel).toBeCloseTo(before + FUEL_VALUE.log - burned, 1);
  });
});

describe('determinism', () => {
  it('produces identical fire state from identical inputs', () => {
    const a = worldWith(2, true);
    const b = worldWith(2, true);

    for (let i = 0; i < 200; i++) {
      const frame = i % 3 === 0 ? hold(i + 1) : idle(i + 1);
      const inputs = { p1: frame, p2: frame };
      step(a, inputs, TICK_DT);
      step(b, inputs, TICK_DT);
    }

    expect(a.fire).toEqual(b.fire);
    expect(a.players).toEqual(b.players);
  });
});
