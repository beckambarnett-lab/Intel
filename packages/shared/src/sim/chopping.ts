import { CHOP_RANGE_M, CHOP_SWINGS, CHOP_SWING_SEC, CHOP_YIELD_LOGS } from '../constants.js';
import { setTile } from '../grid.js';
import { distance } from '../math.js';
import type { TickInputs, Tree, WorldState } from '../types.js';
import { spawnItem } from './items.js';

/**
 * Chopping (§3).
 *
 * Six swings of 0.7s, held down, interruptible, for four logs (Q16). It is
 * slow on purpose: it is the loudest thing you routinely do (Q17), and the
 * four seconds you spend stationary and noisy is the price of the wood.
 */

/** The nearest standing tree in range of this position, if any. */
export function treeInRange(world: WorldState, pos: { x: number; y: number }): Tree | null {
  let best: Tree | null = null;
  let bestDist = Infinity;

  for (const id of Object.keys(world.trees)) {
    const tree = world.trees[id];
    if (!tree || tree.felled) continue;

    const d = distance(pos, tree.pos);
    if (d <= CHOP_RANGE_M && d < bestDist) {
      best = tree;
      bestDist = d;
    }
  }

  return best;
}

/**
 * Tick stage 7 — chopping.
 *
 * Progress lives on the player rather than the tree, so two people swinging at
 * the same trunk each land their own swings — and neither inherits the other's
 * progress if one of them runs.
 */
export function chopping(world: WorldState, inputs: TickInputs, dt: number): void {
  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const frame = inputs[id];
    const holding = frame?.interact === true;
    const target = treeInRange(world, player.pos);

    // Interrupted: let go, walked off, felled it, or never had an axe (Q15).
    if (!holding || !target || !player.hasAxe) {
      player.chop = null;
      continue;
    }

    // Damage lives on the trunk, not on the chopper. Walking away — or being
    // driven away — loses you the swing you were mid-way through and nothing
    // more: you cannot un-chop a tree, and a system that reset a 4.2s job every
    // time something interrupted you would make chopping impossible exactly
    // when creatures start showing up to interrupt it.
    if (!player.chop || player.chop.treeId !== target.id) {
      player.chop = {
        treeId: target.id,
        swingProgress: 0,
        swings: CHOP_SWINGS - target.swingsLeft,
      };
    }

    const chop = player.chop;
    chop.swingProgress += dt;
    if (chop.swingProgress < CHOP_SWING_SEC) continue;

    chop.swingProgress -= CHOP_SWING_SEC;
    target.swingsLeft = Math.max(0, target.swingsLeft - 1);
    chop.swings = CHOP_SWINGS - target.swingsLeft;

    if (target.swingsLeft <= 0) {
      fell(world, target);
      player.chop = null;
    }
  }
}

/**
 * Bring a tree down.
 *
 * The trunk stops occluding the moment it falls (Q20) — the grid is mutable,
 * and since both the lighting mask and collision read the grid directly, the
 * new sightline opens the same frame. Clearing a lane home is a real strategy,
 * and it is permanent: trees never come back (Q18).
 */
export function fell(world: WorldState, tree: Tree): void {
  if (tree.felled) return;

  tree.felled = true;
  tree.swingsLeft = 0;
  setTile(world.grid, tree.tx, tree.ty, 0);

  for (let i = 0; i < CHOP_YIELD_LOGS; i++) {
    // Spread the logs around the stump so they are individually pickable
    // rather than stacked into one indistinguishable heap.
    const angle = (i / CHOP_YIELD_LOGS) * Math.PI * 2;
    spawnItem(world, 'log', {
      x: tree.pos.x + Math.cos(angle) * 0.6,
      y: tree.pos.y + Math.sin(angle) * 0.6,
    });
  }
}
