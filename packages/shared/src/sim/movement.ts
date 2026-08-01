import {
  CARRY_CAPACITY_KG,
  PLAYER_CREEP_MULT,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULT,
  PLAYER_WALK_SPEED,
  SPRINT_LOAD_LIMIT,
  WEIGHT_SPEED_DEPTH,
  WEIGHT_SPEED_EXP,
} from '../constants.js';
import { clamp, clampToUnit } from '../math.js';
import type { TickInputs, WorldState } from '../types.js';

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
 * Tick stage 1 — turn intent into velocity. No positions change here; movement
 * is a separate stage so that every system in between sees a consistent world.
 */
export function applyInputs(world: WorldState, inputs: TickInputs): void {
  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const frame = inputs[id];
    if (!frame) {
      player.vel.x = 0;
      player.vel.y = 0;
      continue;
    }

    const dir = clampToUnit({ x: frame.moveX, y: frame.moveY });

    let speed = PLAYER_WALK_SPEED * speedMultiplierForLoad(player.loadKg);
    if (frame.creep) {
      speed *= PLAYER_CREEP_MULT;
    } else if (frame.sprint && canSprint(player.loadKg)) {
      speed *= PLAYER_SPRINT_MULT;
    }

    player.vel.x = dir.x * speed;
    player.vel.y = dir.y * speed;
  }
}

/**
 * Tick stage 3 — integrate and collide.
 *
 * Step 1 collides against the sandbox rectangle only. Step 2 swaps this for the
 * OccluderGrid; the signature deliberately does not change when it does.
 */
export function integrate(world: WorldState, dt: number): void {
  const maxX = world.bounds.w - PLAYER_RADIUS;
  const maxY = world.bounds.h - PLAYER_RADIUS;

  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    player.pos.x = clamp(player.pos.x + player.vel.x * dt, PLAYER_RADIUS, maxX);
    player.pos.y = clamp(player.pos.y + player.vel.y * dt, PLAYER_RADIUS, maxY);
  }
}
