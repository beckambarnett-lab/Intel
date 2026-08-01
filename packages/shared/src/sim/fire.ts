import {
  FIRE_BASE_BURN_PER_SEC,
  FIRE_BURN_PER_EXTRA_PLAYER,
  FIRE_CAPACITY,
  FIRE_EMBER_GRACE_SEC,
  FIRE_ESCALATION_PERIOD_SEC,
  FIRE_ESCALATION_PER_10_MIN,
  FIRE_PERIMETER_MIN_FRAC,
  FIRE_RADIUS_ANCHORS,
  FIRE_SAFE_RADIUS_FRAC,
  FIRE_STOKE_RANGE_M,
  FIRE_STOKE_SEC,
  FIRE_TIERS,
  FUEL_VALUE,
} from '../constants.js';
import { distance, lerp } from '../math.js';
import { elapsedSec } from '../types.js';
import type { Fire, FireTier, TickInputs, WorldState } from '../types.js';

/**
 * The clock.
 *
 * Wood is the only clock in EMBER, and this is where it runs out. Everything
 * that makes the game a game — going out for wood, how far you dare go, when
 * you turn back — is downstream of these numbers.
 */

/** Fuel as a fraction of capacity, 0..1. */
export function fuelFraction(fire: Fire): number {
  return fire.fuel / FIRE_CAPACITY;
}

/**
 * Burn rate in fuel per second (Q2–Q4).
 *
 * Scales with the number of players sharing the fire, and steps up every ten
 * minutes of run time. The escalation is a step rather than a continuous ramp
 * because Q2 and the Step 3 gate both promise that a full fire lasts *exactly*
 * five minutes — which is only true if the multiplier is still 1.0 for the
 * whole of the first ten-minute period.
 */
export function burnRatePerSec(world: WorldState): number {
  const players = Object.keys(world.players).length;
  const crowd = 1 + FIRE_BURN_PER_EXTRA_PLAYER * Math.max(0, players - 1);

  const periods = Math.floor(elapsedSec(world) / FIRE_ESCALATION_PERIOD_SEC);
  const escalation = 1 + FIRE_ESCALATION_PER_10_MIN * periods;

  return FIRE_BASE_BURN_PER_SEC * crowd * escalation;
}

/** The tier a fuel fraction sits in (Q5). Drives audio and VFX only. */
export function tierForFraction(frac: number): FireTier {
  for (const tier of FIRE_TIERS) {
    if (frac >= tier.minFrac) return tier.name;
  }
  return 'embers';
}

/**
 * Light radius for a fuel fraction (Q5), interpolated along the anchor curve
 * rather than stepped per tier — a fire that jumped 6m wider on crossing a
 * threshold would read as a bug, and the threshold would become a thing to
 * play around rather than a thing to feel.
 */
export function lightRadiusForFraction(frac: number): number {
  const first = FIRE_RADIUS_ANCHORS[0];
  const last = FIRE_RADIUS_ANCHORS[FIRE_RADIUS_ANCHORS.length - 1];
  if (!first || !last) return 0;

  if (frac <= first.frac) return first.radiusM;
  if (frac >= last.frac) return last.radiusM;

  for (let i = 1; i < FIRE_RADIUS_ANCHORS.length; i++) {
    const a = FIRE_RADIUS_ANCHORS[i - 1];
    const b = FIRE_RADIUS_ANCHORS[i];
    if (!a || !b) continue;
    if (frac <= b.frac) {
      const span = b.frac - a.frac;
      const t = span > 0 ? (frac - a.frac) / span : 0;
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
 */
export function safeRadiusFor(frac: number, lightRadiusM: number): number {
  if (frac < FIRE_PERIMETER_MIN_FRAC) return 0;
  return lightRadiusM * FIRE_SAFE_RADIUS_FRAC;
}

/** Recompute everything derived from fuel. */
function refresh(fire: Fire): void {
  const frac = fuelFraction(fire);
  fire.tier = tierForFraction(frac);
  fire.lightRadiusM = fire.dead ? 0 : lightRadiusForFraction(frac);
  fire.safeRadiusM = fire.dead ? 0 : safeRadiusFor(frac, fire.lightRadiusM);
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
 * Tick stage 8 — the stoking channel (Q8/Q9).
 *
 * Lives here rather than in the items system it shares a stage with, because
 * everything it touches is fire state. Step 4 owns the rest of stage 8 —
 * pickup, drop and the woodpile — and will call this alongside them.
 *
 * The channel is interruptible by design: releasing `E`, walking out of range,
 * or running out of wood all drop the progress rather than banking it. Feeding
 * the fire has to be a commitment you can be scared out of.
 */
export function stoke(world: WorldState, inputs: TickInputs, dt: number): void {
  const f = world.fire;

  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const frame = inputs[id];
    const wants = frame?.interact === true;
    const inRange = distance(player.pos, f.pos) <= FIRE_STOKE_RANGE_M;
    const hasWood = player.carriedLogs > 0;
    // ASSUMPTION (Q9 sets the cap but not this edge): the whole log has to fit,
    // or the channel does not start. Capping a partial log instead would burn a
    // full log for a sliver of fuel every time you topped up a nearly-full
    // fire — the cap is meant to stop you front-loading the run, not to eat
    // your wood. The practical effect is that a fire above 275 is simply full.
    const roomFor = f.fuel + FUEL_VALUE.log <= FIRE_CAPACITY;

    if (!wants || !inRange || !hasWood || !roomFor || f.dead) {
      player.stokeProgress = 0;
      continue;
    }

    player.stokeProgress += dt;
    if (player.stokeProgress < FIRE_STOKE_SEC) continue;

    // Channel complete: one log onto the fire. The cap is belt and braces —
    // `roomFor` above already guarantees it fits (Q9).
    player.stokeProgress = 0;
    player.carriedLogs -= 1;
    f.fuel = Math.min(FIRE_CAPACITY, f.fuel + FUEL_VALUE.log);

    if (f.fuel > 0) f.emberSecLeft = FIRE_EMBER_GRACE_SEC;
    refresh(f);
  }
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
