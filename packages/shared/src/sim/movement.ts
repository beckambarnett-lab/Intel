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
import { isBlockedAt } from '../grid.js';
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

    if (frame.shutter) player.lantern.cycleRequested = true;

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
 * Collision reads the true occluder grid and nothing else (Q48). When Step 5
 * adds the rotting memory of the world, that map will lie about how the world
 * looks; it must never be consulted about where the walls are, or players will
 * walk into trees that are not there.
 *
 * Axes are resolved separately so that running into a wall at an angle slides
 * along it instead of stopping dead — sticking on geometry you cannot see is
 * miserable, and in the dark you often cannot see it.
 */
export function integrate(world: WorldState, dt: number): void {
  const maxX = world.bounds.w - PLAYER_RADIUS;
  const maxY = world.bounds.h - PLAYER_RADIUS;

  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const wantX = clamp(player.pos.x + player.vel.x * dt, PLAYER_RADIUS, maxX);
    const wantY = clamp(player.pos.y + player.vel.y * dt, PLAYER_RADIUS, maxY);

    if (!blockedForBody(world, wantX, player.pos.y)) player.pos.x = wantX;
    if (!blockedForBody(world, player.pos.x, wantY)) player.pos.y = wantY;
  }
}

/**
 * Would a body of PLAYER_RADIUS centred here overlap solid rock?
 *
 * Tested at the four extremes of the body rather than at its centre: a 0.35m
 * radius against 1m tiles means a centre-only test lets you stand half inside
 * a trunk, and half inside a trunk is where you get stuck.
 */
function blockedForBody(world: WorldState, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    isBlockedAt(world.grid, x - r, y - r) ||
    isBlockedAt(world.grid, x + r, y - r) ||
    isBlockedAt(world.grid, x - r, y + r) ||
    isBlockedAt(world.grid, x + r, y + r)
  );
}
