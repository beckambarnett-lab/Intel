import { PLAYER_CREEP_MULT, PLAYER_RADIUS, PLAYER_SPRINT_MULT, PLAYER_WALK_SPEED } from '../constants.js';
import { isBlockedAt } from '../grid.js';
import { clamp, clampToUnit } from '../math.js';
import type { TickInputs, WorldState } from '../types.js';
import { canSprint } from './weight.js';

/**
 * Tick stage 1 — record intent. Nothing moves and nothing is scaled here.
 *
 * Speed used to be applied at this stage, back when load was the only input to
 * it. Weight is its own stage now (stage 2), so this records what the player
 * asked for and stage 3 works out what that actually amounts to.
 */
export function applyInputs(world: WorldState, inputs: TickInputs): void {
  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const frame = inputs[id];
    if (!frame) {
      player.intent = { x: 0, y: 0, sprint: false, creep: false };
      continue;
    }

    if (frame.shutter) player.lantern.cycleRequested = true;

    const dir = clampToUnit({ x: frame.moveX, y: frame.moveY });
    player.intent = { x: dir.x, y: dir.y, sprint: frame.sprint, creep: frame.creep };
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

    const intent = player.intent;

    // speedMul comes from stage 2, which has already seen this tick's load.
    let speed = PLAYER_WALK_SPEED * player.speedMul;
    if (intent.creep) {
      speed *= PLAYER_CREEP_MULT;
    } else if (intent.sprint && canSprint(player.loadKg)) {
      speed *= PLAYER_SPRINT_MULT;
    }

    player.vel.x = intent.x * speed;
    player.vel.y = intent.y * speed;

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
