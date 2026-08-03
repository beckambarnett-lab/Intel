import {
  FIRE_BASE_BURN_PER_SEC,
  FIRE_BURN_PER_EXTRA_PLAYER,
  FIRE_EMBER_GRACE_SEC,
  FIRE_ESCALATION_PERIOD_SEC,
  FIRE_ESCALATION_PER_10_MIN,
  FIRE_NOMINAL_FUEL,
  FIRE_PERIMETER_MIN_FUEL,
  FIRE_RADIUS_ANCHORS,
  FIRE_RADIUS_LOG_COEFF,
  FIRE_SAFE_RADIUS_FRAC,
  FIRE_TIERS,
} from '../constants.js';
import { lerp } from '../math.js';
import { elapsedSec } from '../types.js';
import type { Fire, FireTier, WorldState } from '../types.js';

/**
 * The clock.
 *
 * Wood is the only clock in EMBER, and this is where it runs out. Everything
 * that makes the game a game — going out for wood, how far you dare go, when
 * you turn back — is downstream of these numbers.
 *
 * There is no cap on the fuel (DECISIONS §6). Everything here is therefore
 * keyed to absolute fuel rather than to a fraction of a capacity that no longer
 * exists, and each function has two halves: at or below FIRE_NOMINAL_FUEL it is
 * arithmetically identical to the capped version, and above it the fire keeps
 * scaling — wider, and hungrier in exact proportion.
 */

/**
 * How much faster than nominal this fire eats, 1 at or below nominal.
 *
 * The whole price of an uncapped fire is this one number. A fire carrying `n`
 * times nominal burns `n` times as fast, so the radius you buy is rented rather
 * than owned, and no wood is saved by over-stoking: 7500 fuel (300 logs) burns
 * at 25/sec, which is one whole log a second.
 *
 * `max(1, …)` and not the bare ratio, so that below nominal nothing changes at
 * all — a fire on its last log must not burn in slow motion, or the five-minute
 * clock the entire game is paced against stops being five minutes.
 */
export function overstokeMultiplier(fuel: number): number {
  return Math.max(1, fuel / FIRE_NOMINAL_FUEL);
}

/**
 * Burn rate in fuel per second (Q2–Q4, DECISIONS §6).
 *
 * Scales with how much is on the fire, with the number of players sharing it,
 * and steps up every ten minutes of run time. The escalation is a step rather
 * than a continuous ramp because Q2 and the Step 3 gate both promise that a
 * nominal fire lasts *exactly* five minutes — which is only true if the
 * multiplier is still 1.0 for the whole of the first ten-minute period.
 *
 * Above nominal this makes the drain proportional to what is left, so an
 * over-stoked fire decays exponentially back toward nominal with a time constant
 * of FIRE_NOMINAL_FUEL / base seconds — about five minutes per e-fold — and then
 * burns down normally from there.
 */
export function burnRatePerSec(world: WorldState): number {
  const players = Object.keys(world.players).length;
  const crowd = 1 + FIRE_BURN_PER_EXTRA_PLAYER * Math.max(0, players - 1);

  const periods = Math.floor(elapsedSec(world) / FIRE_ESCALATION_PERIOD_SEC);
  const escalation = 1 + FIRE_ESCALATION_PER_10_MIN * periods;

  return FIRE_BASE_BURN_PER_SEC * overstokeMultiplier(world.fire.fuel) * crowd * escalation;
}

/**
 * The tier a fuel level sits in (Q5). Drives audio and VFX only.
 *
 * Everything from `roaring` upward is `roaring`, however big the fire gets —
 * see FIRE_TIERS for why there is no tier above it.
 */
export function tierForFuel(fuel: number): FireTier {
  for (const tier of FIRE_TIERS) {
    if (fuel >= tier.minFuel) return tier.name;
  }
  return 'embers';
}

/**
 * Light radius for a fuel level (Q5, DECISIONS §6).
 *
 * Below nominal: interpolated along the anchor curve rather than stepped per
 * tier — a fire that jumped 6m wider on crossing a threshold would read as a
 * bug, and the threshold would become a thing to play around rather than a thing
 * to feel.
 *
 * Above nominal: logarithmic, so the fire keeps growing without limit but the
 * lit area grows slower than the wood does. Linear growth would put the radius
 * somewhere past 300m on a serious hoard, and the two things that scale with it
 * — the shadowcaster's polygon and the memory field's stamp — are what draws the
 * frame. See FIRE_RADIUS_LOG_COEFF for the measurements that set the rate.
 *
 * The two halves meet at nominal by construction: the log term is zero there,
 * and it is added to whatever the anchor curve's top happens to be, so retuning
 * the roaring radius moves both halves together and cannot open a seam.
 */
export function lightRadiusForFuel(fuel: number): number {
  const first = FIRE_RADIUS_ANCHORS[0];
  const last = FIRE_RADIUS_ANCHORS[FIRE_RADIUS_ANCHORS.length - 1];
  if (!first || !last) return 0;

  if (fuel > FIRE_NOMINAL_FUEL) {
    return last.radiusM + FIRE_RADIUS_LOG_COEFF * Math.log(fuel / FIRE_NOMINAL_FUEL);
  }

  if (fuel <= first.fuel) return first.radiusM;
  if (fuel >= last.fuel) return last.radiusM;

  for (let i = 1; i < FIRE_RADIUS_ANCHORS.length; i++) {
    const a = FIRE_RADIUS_ANCHORS[i - 1];
    const b = FIRE_RADIUS_ANCHORS[i];
    if (!a || !b) continue;
    if (fuel <= b.fuel) {
      const span = b.fuel - a.fuel;
      const t = span > 0 ? (fuel - a.fuel) / span : 0;
      return lerp(a.radiusM, b.radiusM, t);
    }
  }

  return last.radiusM;
}

/**
 * How close creatures may come (Q6/Q7).
 *
 * Seventy percent of the light while the fire holds, and nothing at all once
 * it drops below Low — that is the perimeter failing, and it is what makes the
 * ember scramble frightening rather than merely inconvenient.
 *
 * With no cap on the fuel this is also the reward for over-stoking: the safe
 * perimeter grows with the light, so a 46m fire keeps them 32m out.
 */
export function safeRadiusFor(fuel: number, lightRadiusM: number): number {
  if (fuel < FIRE_PERIMETER_MIN_FUEL) return 0;
  return lightRadiusM * FIRE_SAFE_RADIUS_FRAC;
}

/** Q7: does the camp perimeter hold at this fuel level? */
export function perimeterHolds(fire: Fire): boolean {
  return !fire.dead && fire.fuel >= FIRE_PERIMETER_MIN_FUEL;
}

/**
 * Recompute everything derived from fuel.
 *
 * Exported because a freshly created fire has no radius until something works
 * it out, and anything that reads the fire before the next tick — a player
 * joining between ticks, for one — would see an unlit camp.
 */
export function refreshFire(fire: Fire): void {
  refresh(fire);
}

function refresh(fire: Fire): void {
  fire.tier = tierForFuel(fire.fuel);
  fire.lightRadiusM = fire.dead ? 0 : lightRadiusForFuel(fire.fuel);
  fire.safeRadiusM = fire.dead ? 0 : safeRadiusFor(fire.fuel, fire.lightRadiusM);
}

/**
 * Tick stage 6 — fire.
 *
 * Drains fuel, recomputes the tier and both radii, and runs the ember
 * countdown. It does NOT declare the run over: that is stage 14's job, which
 * runs after stoking at stage 8, so a log thrown on at the last possible tick
 * still saves the run.
 */
export function fire(world: WorldState, dt: number): void {
  const f = world.fire;

  if (f.dead) {
    refresh(f);
    return;
  }

  // No players, no run. The room ticks from the moment the server process
  // starts, which is typically long before anyone connects; burning through
  // that would mean joining a run that had already been lost. The camp keeps
  // its light — it just does not consume anything.
  if (Object.keys(world.players).length === 0) {
    refresh(f);
    return;
  }

  world.runSec += dt;

  if (f.fuel > 0) {
    f.fuel = Math.max(0, f.fuel - burnRatePerSec(world) * dt);
    // Still burning, so the grace period is untouched and full.
    if (f.fuel > 0) f.emberSecLeft = FIRE_EMBER_GRACE_SEC;
  }

  if (f.fuel <= 0) {
    // Embers (L15). Sixty seconds to find wood.
    f.emberSecLeft = Math.max(0, f.emberSecLeft - dt);
  }

  refresh(f);
}

/**
 * Tick stage 14 — win and lose.
 *
 * Only one of Q135's two failure states exists yet. The all-ghosts case needs
 * Step 8 and the amulet needs Step 12.
 */
export function winLose(world: WorldState): void {
  if (world.outcome !== null) return;

  const f = world.fire;
  if (f.fuel <= 0 && f.emberSecLeft <= 0) {
    f.dead = true;
    f.lightRadiusM = 0;
    f.safeRadiusM = 0;
    world.outcome = 'embersDied';
  }
}
