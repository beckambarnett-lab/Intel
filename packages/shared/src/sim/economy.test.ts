import { describe, expect, it } from 'vitest';
import {
  CARRY_CAPACITY_KG,
  CHOP_SWINGS,
  CHOP_SWING_SEC,
  CHOP_YIELD_LOGS,
  FIRE_BASE_BURN_PER_SEC,
  FIRE_STOKE_SEC,
  FUEL_VALUE,
  MASS_KG,
  SANDBOX_MAP_SEED,
} from '../constants.js';
import { sandboxMap } from '../grid.js';

/**
 * Step 4's gate is that a solo player can keep the fire alive for fifteen
 * minutes by chopping and hauling. That is a claim about the economy, and it
 * is checkable without a player: the wood has to exist, and the round trip has
 * to fit in the time the fire gives you.
 *
 * These are feasibility bounds, not balance. They are here to fail loudly if
 * someone retunes a number in a way that makes the gate unreachable.
 */
const TARGET_SEC = 15 * 60;

describe('the wood economy sustains the gate', () => {
  const map = sandboxMap(SANDBOX_MAP_SEED);

  /** Fuel a solo fire needs over the target, at the un-escalated base rate. */
  const fuelNeeded = FIRE_BASE_BURN_PER_SEC * TARGET_SEC;

  it('has far more wood on the map than fifteen minutes needs', () => {
    const fromTrees = map.trees.length * CHOP_YIELD_LOGS * FUEL_VALUE.log;
    const fromDeadfall = map.deadfall.length * FUEL_VALUE.branch;

    expect(fromTrees + fromDeadfall).toBeGreaterThan(fuelNeeded);
  });

  it('leaves enough time to gather it', () => {
    const logsNeeded = fuelNeeded / FUEL_VALUE.log;
    const treesNeeded = logsNeeded / CHOP_YIELD_LOGS;

    const choppingSec = treesNeeded * CHOP_SWINGS * CHOP_SWING_SEC;
    const stokingSec = logsNeeded * FIRE_STOKE_SEC;

    // What is left over is the travel budget: walking out, finding a trunk in
    // the dark and hauling back. If chopping and stoking alone ate the clock,
    // the gate would be arithmetically impossible however well you played.
    const overhead = choppingSec + stokingSec;
    expect(overhead).toBeLessThan(TARGET_SEC * 0.5);
  });

  it('needs several trips, because you cannot carry it in one', () => {
    const logsNeeded = fuelNeeded / FUEL_VALUE.log;
    const logsPerTrip = Math.floor(CARRY_CAPACITY_KG / MASS_KG.log);

    // The point of the weight system: hauling is a repeated decision, not one
    // trip. If this ever collapses to a single trip, weight has stopped
    // mattering and Q31 is doing nothing.
    expect(Math.ceil(logsNeeded / logsPerTrip)).toBeGreaterThan(2);
  });
});
