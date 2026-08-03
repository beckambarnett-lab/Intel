import {
  LANTERN_BLOOM_MULT,
  LANTERN_BLOOM_SEC,
  LANTERN_SHUTTER_SEC,
  LANTERN_STAGES,
  LANTERN_STAGE_ORDER,
} from '../constants.js';
import { lerp } from '../math.js';
import type { LanternStage, LanternState, WorldState } from '../types.js';

/** Where a stage sits in the shutter's travel. Hooded 0, low 1, full 2. */
function stageIndex(stage: LanternStage): number {
  const i = LANTERN_STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

function nextStage(stage: LanternStage): LanternStage {
  const i = stageIndex(stage);
  return LANTERN_STAGE_ORDER[(i + 1) % LANTERN_STAGE_ORDER.length] ?? stage;
}

/**
 * The light this lantern is actually throwing, in metres.
 *
 * Interpolated across the shutter movement so opening is a sweep rather than a
 * jump, and multiplied by the opening bloom while it lasts (Q40). Everything
 * that cares about the lantern — the renderer's mask, the server's culling,
 * and the creature sight checks in Step 6 — asks this one function, so they
 * can never disagree about how big the light is.
 */
export function lanternRadius(ls: LanternState): number {
  // ASSUMPTION (not settled in DESIGN.md): a dry lantern throws no light at
  // all. The alternative reading — that it falls back to hooded — leaves you a
  // free permanent 1.2m light and makes the tank (Q38) stop being a constraint.
  if (ls.fuel <= 0) return 0;

  const from = LANTERN_STAGES[ls.stage].radiusM;
  const to = LANTERN_STAGES[ls.target].radiusM;

  const t = ls.transition > 0 ? 1 - ls.transition / LANTERN_SHUTTER_SEC : 1;
  let radius = lerp(from, to, t);

  if (ls.bloom > 0) {
    // Flares on opening and settles back; the tell fades as the flame does.
    const strength = ls.bloom / LANTERN_BLOOM_SEC;
    radius *= lerp(1, LANTERN_BLOOM_MULT, strength);
  }

  return radius;
}

/**
 * How far off this lantern can be seen (Q37/Q59).
 *
 * The same interpolation `lanternRadius` uses, over the detection column of the
 * Q37 table instead of the radius column — so the range a creature spots you at
 * tracks the light you are *actually* throwing, mid-shutter and all.
 *
 * The bloom term is the important one. Q40 calls the flare on opening "a tell
 * that can get you caught", and this is the line that makes that literally
 * true: for a quarter of a second after you open up, you are visible from
 * further away than the stage you opened to. Opening at the wrong moment is
 * supposed to cost you.
 */
export function lanternSeenAt(ls: LanternState): number {
  if (ls.fuel <= 0) return 0;

  const from = LANTERN_STAGES[ls.stage].seenAtM;
  const to = LANTERN_STAGES[ls.target].seenAtM;

  const t = ls.transition > 0 ? 1 - ls.transition / LANTERN_SHUTTER_SEC : 1;
  let range = lerp(from, to, t);

  if (ls.bloom > 0) {
    const strength = ls.bloom / LANTERN_BLOOM_SEC;
    range *= lerp(1, LANTERN_BLOOM_MULT, strength);
  }

  return range;
}

/** True while the shutter is moving toward a wider stage. */
export function isOpening(ls: LanternState): boolean {
  return stageIndex(ls.target) > stageIndex(ls.stage);
}

/**
 * Tick stage 5 — lantern.
 *
 * Consumes the cycle intent recorded in stage 1, advances the shutter, and
 * burns fuel at the rate of whatever stage it is on. Runs after movement so a
 * player who opened up and ran has already moved: the light is where they are
 * now, not where they were.
 */
export function lantern(world: WorldState, dt: number): void {
  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const ls = player.lantern;

    if (ls.cycleRequested) {
      ls.cycleRequested = false;
      // Retarget mid-travel rather than queueing: the shutter is one lever, and
      // a player mashing F should end up where they stopped pressing it.
      ls.target = nextStage(ls.target);
      ls.transition = LANTERN_SHUTTER_SEC;
    }

    if (ls.transition > 0) {
      const opening = isOpening(ls);
      ls.transition -= dt;
      if (ls.transition <= 0) {
        ls.transition = 0;
        ls.stage = ls.target;
        if (opening) ls.bloom = LANTERN_BLOOM_SEC;
      }
    }

    if (ls.bloom > 0) {
      ls.bloom = Math.max(0, ls.bloom - dt);
    }

    // Burn at the stage being travelled toward — opening costs you immediately,
    // not once the shutter finishes moving.
    const burn = LANTERN_STAGES[ls.target].burnPerSec * dt;
    ls.fuel = Math.max(0, ls.fuel - burn);

    if (ls.fuel <= 0) {
      // Dry. It gutters shut on its own, and refuelling (Q39) is Step 4.
      ls.stage = 'hooded';
      ls.target = 'hooded';
      ls.transition = 0;
      ls.bloom = 0;
    }
  }
}
