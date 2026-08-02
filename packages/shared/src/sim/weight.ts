import {
  CARRY_CAPACITY_KG,
  SPRINT_LOAD_LIMIT,
  WEIGHT_NOISE_MULT_AT_FULL,
  WEIGHT_SPEED_DEPTH,
  WEIGHT_SPEED_EXP,
} from '../constants.js';
import { carriedMassKg } from '../types.js';
import type { WorldState } from '../types.js';

/**
 * Weight (§5).
 *
 * The central trade in the game: wood is the only clock, wood is heavy, and
 * heavy is both slow and loud. Every trip out is a bet on how much you can
 * carry back before something finds you.
 *
 * There is no grid and there are no slots (Q34) — you carry what you can bear.
 */

/**
 * Speed penalty from carried weight (Q31):
 *
 *   speed = 1 - 0.6 * (load / capacity) ^ 1.5
 *
 * Empty 100%, half load 79%, full load 40%. At or over capacity you cannot
 * move at all — the plan is explicit that overloading is a hard stop, not a
 * crawl, because it must be a decision you feel before you commit to it.
 */
export function speedMultiplierForLoad(loadKg: number): number {
  const frac = loadKg / CARRY_CAPACITY_KG;
  if (frac >= 1) return 0;
  return 1 - WEIGHT_SPEED_DEPTH * Math.pow(frac, WEIGHT_SPEED_EXP);
}

/** Sprint is locked above half load (Q32). */
export function canSprint(loadKg: number): boolean {
  return loadKg / CARRY_CAPACITY_KG < SPRINT_LOAD_LIMIT;
}

/**
 * How much louder a load makes you (Q36): 1.0 empty, +50% at full capacity.
 *
 * Nothing consumes this until creatures can hear in Step 6. It is computed
 * here anyway because it belongs to weight, and because the moment sound
 * exists this is what ties the wood economy directly to the duel.
 */
export function noiseMultiplierForLoad(loadKg: number): number {
  const frac = Math.min(1, loadKg / CARRY_CAPACITY_KG);
  return 1 + (WEIGHT_NOISE_MULT_AT_FULL - 1) * frac;
}

/**
 * Tick stage 2 — weight.
 *
 * Recomputes each player's load from what they are actually carrying, then the
 * speed and noise multipliers that follow from it. Runs between intent
 * (stage 1) and movement (stage 3) so that a log picked up last tick is
 * slowing you down this one.
 */
export function weight(world: WorldState): void {
  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    player.loadKg = carriedMassKg(player.carrying);
    player.speedMul = speedMultiplierForLoad(player.loadKg);
    player.noiseMul = noiseMultiplierForLoad(player.loadKg);
  }
}
