import { describe, expect, it } from 'vitest';
import {
  FIRE_BASE_BURN_PER_SEC,
  FIRE_BURN_PER_EXTRA_PLAYER,
  FIRE_EMBER_GRACE_SEC,
  FIRE_ESCALATION_PERIOD_SEC,
  FIRE_ESCALATION_PER_10_MIN,
  FIRE_NOMINAL_FUEL,
  FIRE_PERIMETER_MIN_FUEL,
  FIRE_RADIUS_LOG_COEFF,
  FIRE_SAFE_RADIUS_FRAC,
  FIRE_STOKE_RANGE_M,
  FIRE_STOKE_SEC,
  FIRE_TIERS,
  FUEL_VALUE,
  TICK_DT,
} from '../constants.js';
import { createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, WorldState } from '../types.js';
import {
  burnRatePerSec,
  lightRadiusForFuel,
  overstokeMultiplier,
  safeRadiusFor,
  tierForFuel,
} from './fire.js';
import { step } from './index.js';

const FIRE_AT = { x: 12, y: 20 };

function worldWith(playerCount: number, atFire = false, logs = 12): WorldState {
  const world = createWorld(60, 40);
  world.fire.pos = { ...FIRE_AT };
  // Somewhere the woodpile cannot be mistaken for being in reach of the fire.
  world.woodpile.pos = { x: 50, y: 5 };

  for (let i = 0; i < playerCount; i++) {
    const id = `p${i + 1}`;
    const pos = atFire ? { x: FIRE_AT.x + 1, y: FIRE_AT.y } : { x: 40, y: 30 };
    const player = createPlayer(id, id, pos);
    player.carrying.log = logs;
    world.players[id] = player;
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
 * The headline number in the whole design: a nominal fire lasts five minutes.
 * Everything about how far you dare walk is calibrated against it.
 *
 * Removing the fuel cap (DECISIONS §6) had to leave this untouched, which is
 * what `max(1, …)` in overstokeMultiplier buys: at or below FIRE_NOMINAL_FUEL
 * the burn rate is arithmetically what it always was, so every number below is
 * the same number it was before the cap came off.
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

    world.runSec = FIRE_ESCALATION_PERIOD_SEC - 1;
    expect(burnRatePerSec(world)).toBeCloseTo(FIRE_BASE_BURN_PER_SEC, 9);

    world.runSec = FIRE_ESCALATION_PERIOD_SEC;
    expect(burnRatePerSec(world)).toBeCloseTo(
      FIRE_BASE_BURN_PER_SEC * (1 + FIRE_ESCALATION_PER_10_MIN),
      9,
    );

    world.runSec = FIRE_ESCALATION_PERIOD_SEC * 3;
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

/**
 * The room starts ticking when the server process boots, which on a dev server
 * is long before anyone opens a tab. If the fire burned during that, you would
 * arrive to a run that had already been lost — which is exactly what happened.
 * There is no run until somebody is in the camp (Q124: no drop-in).
 */
describe('an empty camp has no clock', () => {
  it('does not burn a single unit of fuel with nobody connected', () => {
    const world = worldWith(0);
    run(world, 10 * 60);

    expect(world.fire.fuel).toBe(FIRE_NOMINAL_FUEL);
    expect(world.fire.dead).toBe(false);
    expect(world.outcome).toBeNull();
  });

  it('does not run the ember countdown either', () => {
    const world = worldWith(0);
    world.fire.fuel = 0;

    run(world, FIRE_EMBER_GRACE_SEC * 2);

    expect(world.fire.emberSecLeft).toBe(FIRE_EMBER_GRACE_SEC);
    expect(world.outcome).toBeNull();
  });

  it('does not bank escalation while the server idles', () => {
    const world = worldWith(0);
    run(world, FIRE_ESCALATION_PERIOD_SEC * 3);

    // Someone finally joins: they should get a fresh run at the base rate.
    world.players['p1'] = createPlayer('p1', 'p1', { x: 40, y: 30 });
    expect(burnRatePerSec(world)).toBeCloseTo(FIRE_BASE_BURN_PER_SEC, 9);
  });

  it('still lights the camp, so you do not arrive to a black screen', () => {
    const world = worldWith(0);
    run(world, 60);
    expect(world.fire.lightRadiusM).toBeGreaterThan(0);
  });
});

describe('tiers and radii (Q5, Q6)', () => {
  /**
   * The same six fuel levels this asserted when the thresholds were fractions
   * of a 300 capacity — 1.0, 0.8, 0.5, 0.2, 0.05 and 0 — multiplied out. If the
   * absolute thresholds in FIRE_TIERS were converted wrongly this is what says
   * so, because every one of these sits inside a band rather than on an edge.
   */
  it('names each tier at its documented fuel level', () => {
    expect(tierForFuel(300)).toBe('roaring');
    expect(tierForFuel(240)).toBe('roaring');
    expect(tierForFuel(150)).toBe('burning');
    expect(tierForFuel(60)).toBe('low');
    expect(tierForFuel(15)).toBe('guttering');
    expect(tierForFuel(0)).toBe('embers');
  });

  /** DECISIONS §6: no tier above roaring, however much wood is on it. */
  it('calls an over-stoked fire roaring, all the way up', () => {
    expect(tierForFuel(FIRE_NOMINAL_FUEL + 1)).toBe('roaring');
    expect(tierForFuel(7500)).toBe('roaring');
    expect(tierForFuel(1e6)).toBe('roaring');
  });

  /**
   * Q7 is "never while fire >= Low", so the perimeter threshold and the `low`
   * tier's threshold are the same fact written twice. They were both 0.15 and
   * are now both 45; this is what stops one being retuned without the other.
   */
  it('fails the perimeter at exactly the Low threshold', () => {
    const low = FIRE_TIERS.find((t) => t.name === 'low');
    expect(low?.minFuel).toBe(FIRE_PERIMETER_MIN_FUEL);
  });

  it('hits each tier’s documented radius at the centre of its band', () => {
    // Anchored at band centres — see FIRE_RADIUS_ANCHORS for why.
    for (const [i, tier] of FIRE_TIERS.entries()) {
      const upper = i === 0 ? FIRE_NOMINAL_FUEL : FIRE_TIERS[i - 1]!.minFuel;
      const centre = (tier.minFuel + upper) / 2;
      expect(lightRadiusForFuel(centre)).toBeCloseTo(tier.radiusM, 6);
    }
  });

  it('interpolates smoothly instead of stepping at tier boundaries', () => {
    // Either side of the roaring/burning boundary, formerly 75% of capacity.
    const below = lightRadiusForFuel(224.7);
    const above = lightRadiusForFuel(225.3);
    expect(Math.abs(above - below)).toBeLessThan(0.1);
  });

  it('grows monotonically with fuel, well past nominal', () => {
    let previous = -1;
    for (let fuel = 0; fuel <= 30000; fuel += 3) {
      const r = lightRadiusForFuel(fuel);
      expect(r).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = r;
    }
  });

  it('clamps at the bottom of the anchor range', () => {
    expect(lightRadiusForFuel(0)).toBeCloseTo(FIRE_TIERS[FIRE_TIERS.length - 1]!.radiusM, 6);
  });

  /**
   * This is the one assertion the cap removal genuinely inverts.
   *
   * It used to say the radius CLAMPED at the top of the anchor range: a full
   * fire threw the roaring radius and nothing you did made it bigger, which was
   * the visible face of Q9's hard cap. Now nominal is where the curve hands over
   * rather than where it stops. What has to be protected instead is the seam —
   * that the two halves agree exactly at nominal, so a fire crossing 300 in
   * either direction does not jump.
   */
  it('meets the anchor curve exactly at nominal, then keeps growing', () => {
    const roaring = FIRE_TIERS[0]!.radiusM;
    expect(lightRadiusForFuel(FIRE_NOMINAL_FUEL)).toBeCloseTo(roaring, 9);
    expect(lightRadiusForFuel(FIRE_NOMINAL_FUEL - 1e-9)).toBeCloseTo(roaring, 6);
    expect(lightRadiusForFuel(FIRE_NOMINAL_FUEL + 1e-9)).toBeCloseTo(roaring, 6);

    expect(lightRadiusForFuel(FIRE_NOMINAL_FUEL * 2)).toBeGreaterThan(roaring);
  });

  /**
   * Logarithmic and not linear (DECISIONS §6): every doubling of the fuel is
   * worth the same flat number of metres, so the lit area cannot outrun the
   * shadowcaster. Linear growth would put 300 logs somewhere past 300m.
   */
  it('adds a flat radius per doubling of fuel, not a flat radius per log', () => {
    const perDouble = FIRE_RADIUS_LOG_COEFF * Math.LN2;
    for (const fuel of [600, 1200, 2400, 4800, 9600]) {
      const step = lightRadiusForFuel(fuel * 2) - lightRadiusForFuel(fuel);
      expect(step).toBeCloseTo(perDouble, 6);
    }
  });

  /** The number the coefficient was actually chosen to produce. */
  it('throws 46m with 300 logs on it', () => {
    expect(lightRadiusForFuel(300 * FUEL_VALUE.log)).toBeCloseTo(46.2, 1);
  });

  it('keeps the safe radius at 70% of the light while the fire holds (Q6)', () => {
    const light = lightRadiusForFuel(240);
    expect(safeRadiusFor(240, light)).toBeCloseTo(light * FIRE_SAFE_RADIUS_FRAC, 6);
  });

  /** The perimeter is bought with wood too — it grows with an over-stoked fire. */
  it('grows the safe radius with an over-stoked fire', () => {
    const light = lightRadiusForFuel(7500);
    expect(safeRadiusFor(7500, light)).toBeCloseTo(light * FIRE_SAFE_RADIUS_FRAC, 6);
    expect(safeRadiusFor(7500, light)).toBeGreaterThan(30);
  });

  it('collapses the perimeter entirely below Low (Q7)', () => {
    const justUnder = FIRE_PERIMETER_MIN_FUEL - 0.3;
    expect(safeRadiusFor(justUnder, lightRadiusForFuel(justUnder))).toBe(0);
    expect(safeRadiusFor(0, 1.5)).toBe(0);
  });
});

/**
 * The price of an uncapped fire (DECISIONS §6).
 *
 * Radius is bought at the rate the wood burns and never any cheaper, which is
 * the whole of the balance: over-stoking is renting light, not banking it.
 */
describe('over-stoking (DECISIONS §6)', () => {
  it('changes nothing at or below nominal', () => {
    expect(overstokeMultiplier(0)).toBe(1);
    expect(overstokeMultiplier(1)).toBe(1);
    expect(overstokeMultiplier(FIRE_NOMINAL_FUEL / 2)).toBe(1);
    expect(overstokeMultiplier(FIRE_NOMINAL_FUEL)).toBe(1);
  });

  it('burns a whole log a second with 300 logs on the fire', () => {
    const fuel = 300 * FUEL_VALUE.log;
    expect(fuel).toBe(7500);

    const world = worldWith(1);
    world.fire.fuel = fuel;
    expect(burnRatePerSec(world)).toBeCloseTo(FUEL_VALUE.log, 9);
  });

  it('scales the burn in exact proportion to the fuel', () => {
    const world = worldWith(1);
    for (const multiple of [2, 5, 10, 25, 100]) {
      world.fire.fuel = FIRE_NOMINAL_FUEL * multiple;
      expect(burnRatePerSec(world)).toBeCloseTo(FIRE_BASE_BURN_PER_SEC * multiple, 9);
    }
  });

  /**
   * The crowd and escalation multipliers still apply on top, so a big fire in a
   * big group late in a run is punishing in all three ways at once.
   */
  it('compounds with the crowd and escalation multipliers', () => {
    const world = worldWith(4);
    world.fire.fuel = FIRE_NOMINAL_FUEL * 10;
    world.runSec = FIRE_ESCALATION_PERIOD_SEC * 2;

    expect(burnRatePerSec(world)).toBeCloseTo(
      FIRE_BASE_BURN_PER_SEC *
        10 *
        (1 + FIRE_BURN_PER_EXTRA_PLAYER * 3) *
        (1 + FIRE_ESCALATION_PER_10_MIN * 2),
      9,
    );
  });

  /**
   * Proportional drain is exponential decay: the fire falls back toward nominal
   * with a time constant of nominal/base seconds, which is five minutes per
   * e-fold. 300 logs is ln(25) e-folds away, so about sixteen minutes.
   */
  it('decays back to nominal in about sixteen minutes from 300 logs', () => {
    const world = worldWith(1);
    world.fire.fuel = 7500;

    // Escalation would muddy the constant; this is the decay law on its own.
    run(world, 5 * 60);
    expect(world.fire.fuel).toBeCloseTo(7500 / Math.E, 0);

    // Stop the clock stepping up so the remaining fall is pure decay.
    let sec = 300;
    while (world.fire.fuel > FIRE_NOMINAL_FUEL && sec < 3000) {
      world.runSec = 0;
      run(world, 10);
      sec += 10;
    }

    expect(sec / 60).toBeGreaterThan(15);
    expect(sec / 60).toBeLessThan(17);
  });

  it('never lets a nearly dead fire burn in slow motion', () => {
    const world = worldWith(1);
    world.fire.fuel = 1;
    expect(burnRatePerSec(world)).toBeCloseTo(FIRE_BASE_BURN_PER_SEC, 9);
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

    const logsBefore = world.players['p1']!.carrying.log;
    run(world, 5, hold);

    expect(world.fire.fuel).toBe(0);
    expect(world.fire.dead).toBe(true);
    // And it does not silently eat your wood trying.
    expect(world.players['p1']!.carrying.log).toBe(logsBefore);
  });
});

/**
 * The whole of DECISIONS §6 in one run: 300 logs on the fire, left alone.
 *
 * Traced rather than reasoned about. Every waypoint below was read off the sim
 * and then checked against the closed form — above nominal the drain is
 * proportional, which is exponential decay with a five-minute e-fold, so the
 * fall from 7500 to 300 is ln(25) e-folds and the rest is the ordinary
 * five-minute clock with the Q4 escalation on top.
 *
 * What it protects is that the two halves of the curve compose into one run: an
 * enormous fire is a normal fire with a long expensive prologue, it passes
 * through every tier in order on the way down, and it still ends in embers.
 */
describe('an over-stoked fire burning down (DECISIONS §6)', () => {
  /** Fuel, radius and tier at a given minute of a solo run from 300 logs. */
  function traceFrom(fuel: number): { at: (min: number) => WorldState; world: WorldState } {
    const world = worldWith(1);
    world.fire.fuel = fuel;
    let elapsed = 0;
    return {
      world,
      at: (min: number) => {
        run(world, min * 60 - elapsed);
        elapsed = min * 60;
        return world;
      },
    };
  }

  it('starts at 46m, burning a log a second', () => {
    const world = worldWith(1);
    world.fire.fuel = 7500;
    run(world, TICK_DT);

    expect(burnRatePerSec(world)).toBeGreaterThan(24);
    expect(world.fire.lightRadiusM).toBeCloseTo(46.2, 0);
    expect(world.fire.safeRadiusM).toBeCloseTo(32.3, 0);
    expect(world.fire.tier).toBe('roaring');
  });

  /**
   * The radius decays gently even though the fuel is collapsing — that is the
   * logarithm doing its job. Five minutes in, four fifths of the wood is gone
   * and the fire is still 36m across.
   */
  it('sheds fuel far faster than it sheds radius', () => {
    const t = traceFrom(7500);

    expect(t.at(1).fire.lightRadiusM).toBeCloseTo(44.2, 0);
    expect(t.at(5).fire.fuel).toBeCloseTo(2759, -1);
    expect(t.at(5).fire.lightRadiusM).toBeCloseTo(36.2, 0);
    expect(t.at(10).fire.lightRadiusM).toBeCloseTo(26.2, 0);
    expect(t.at(15).fire.lightRadiusM).toBeCloseTo(15.2, 0);
  });

  /**
   * Every tier in order, and roaring holds for sixteen and a half minutes of it.
   * The last four minutes are the ordinary Step 3 burn-down, unchanged.
   */
  it('passes down through every tier and ends in embers', () => {
    const world = worldWith(1);
    world.fire.fuel = 7500;

    const seen: { tier: string; min: number }[] = [];
    let last = '';
    for (let sec = 0; sec < 25 * 60 && world.outcome === null; sec += TICK_DT) {
      run(world, TICK_DT);
      if (world.fire.tier !== last) {
        seen.push({ tier: world.fire.tier, min: sec / 60 });
        last = world.fire.tier;
      }
    }

    expect(seen.map((s) => s.tier)).toEqual(['roaring', 'burning', 'low', 'guttering', 'embers']);
    expect(seen[1]!.min).toBeCloseTo(16.7, 0);
    expect(seen[2]!.min).toBeCloseTo(18.3, 0);
    expect(seen[3]!.min).toBeCloseTo(19.4, 0);
    expect(seen[4]!.min).toBeCloseTo(20.1, 0);
    expect(world.outcome).toBe('embersDied');
  });

  /**
   * The price, stated as a ratio: 300 logs bought about 21 minutes, where the
   * same wood drip-fed at nominal would have bought a little over two hours.
   * Over-stoking rents light — it never banks it.
   */
  it('wastes wood in exact proportion to the light it buys', () => {
    const world = worldWith(1);
    world.fire.fuel = 7500;
    run(world, 25 * 60);

    expect(world.outcome).toBe('embersDied');
    expect(world.runSec / 60).toBeGreaterThan(20);
    expect(world.runSec / 60).toBeLessThan(22);
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
