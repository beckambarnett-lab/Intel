import { describe, expect, it } from 'vitest';
import {
  CHOP_RANGE_M,
  CHOP_SWINGS,
  CHOP_SWING_SEC,
  CHOP_YIELD_LOGS,
  TICK_DT,
} from '../constants.js';
import { createGrid, isOpaqueTile, setTile } from '../grid.js';
import { raycastLOS } from '../los.js';
import { createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, Tree, WorldState } from '../types.js';
import { step } from './index.js';

const TREE_TILE = { x: 20, y: 20 };

/** A world with one standing tree, and a player next to it holding an axe. */
function worldWithTree(atTree = true): WorldState {
  const world = createWorld(60, 40, createGrid(60, 40));
  setTile(world.grid, TREE_TILE.x, TREE_TILE.y, 255);

  const tree: Tree = {
    id: 't20,20',
    tx: TREE_TILE.x,
    ty: TREE_TILE.y,
    pos: { x: TREE_TILE.x + 0.5, y: TREE_TILE.y + 0.5 },
    swingsLeft: CHOP_SWINGS,
    felled: false,
  };
  world.trees[tree.id] = tree;

  const pos = atTree ? { x: TREE_TILE.x - 0.6, y: TREE_TILE.y + 0.5 } : { x: 5, y: 5 };
  world.players['p1'] = createPlayer('p1', 'p1', pos);

  return world;
}

const idle = (seq: number): InputFrame => emptyInput(seq);
const hold = (seq: number): InputFrame => ({ ...emptyInput(seq), interact: true });

function run(world: WorldState, seconds: number, frame: (seq: number) => InputFrame = idle): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(world, { p1: frame(i + 1) }, TICK_DT);
}

const me = (world: WorldState) => world.players['p1']!;
const tree = (world: WorldState) => world.trees['t20,20']!;

/** Total time to fell a tree at the documented rates: 6 x 0.7s. */
const FELL_SEC = CHOP_SWINGS * CHOP_SWING_SEC;

describe('chopping (Q16)', () => {
  it('takes six swings of 0.7s to bring a tree down', () => {
    const world = worldWithTree();

    run(world, FELL_SEC - CHOP_SWING_SEC, hold);
    expect(tree(world).felled).toBe(false);

    run(world, CHOP_SWING_SEC + TICK_DT, hold);
    expect(tree(world).felled).toBe(true);
  });

  it('counts swings as it goes', () => {
    const world = worldWithTree();
    run(world, CHOP_SWING_SEC * 2 + TICK_DT, hold);

    expect(me(world).chop?.swings).toBe(2);
    expect(tree(world).swingsLeft).toBe(CHOP_SWINGS - 2);
  });

  it('is interrupted by letting go, losing the swing in progress', () => {
    const world = worldWithTree();

    run(world, CHOP_SWING_SEC * 2 + CHOP_SWING_SEC / 2, hold);
    expect(tree(world).swingsLeft).toBe(CHOP_SWINGS - 2);

    run(world, TICK_DT, idle);
    expect(me(world).chop).toBeNull();
    // The half-finished swing is gone; the two that landed are not.
    expect(tree(world).swingsLeft).toBe(CHOP_SWINGS - 2);
  });

  /**
   * Damage is a property of the trunk, not of the session. Being driven off a
   * tree by a creature and coming back to find it untouched would make the
   * whole wood economy unworkable in the late game — which is exactly when
   * things start interrupting you.
   */
  it('remembers the damage when you come back to it', () => {
    const world = worldWithTree();

    run(world, CHOP_SWING_SEC * 3 + TICK_DT, hold);
    run(world, TICK_DT, idle);
    expect(tree(world).felled).toBe(false);

    // Three more finishes it, not six.
    run(world, CHOP_SWING_SEC * 3 + TICK_DT, hold);
    expect(tree(world).felled).toBe(true);
  });

  it('shows progress against the trunk, not against this attempt', () => {
    const world = worldWithTree();

    run(world, CHOP_SWING_SEC * 2 + TICK_DT, hold);
    run(world, TICK_DT, idle);
    run(world, TICK_DT, hold);

    expect(me(world).chop?.swings).toBe(2);
  });

  it('is interrupted by walking away', () => {
    const world = worldWithTree();

    run(world, CHOP_SWING_SEC * 2, hold);
    me(world).pos = { x: 5, y: 5 };
    run(world, TICK_DT, hold);

    expect(me(world).chop).toBeNull();
  });

  it('does nothing out of range', () => {
    const world = worldWithTree(false);
    run(world, FELL_SEC * 2, hold);

    expect(tree(world).felled).toBe(false);
    expect(me(world).chop).toBeNull();
  });

  it('needs an axe (Q15)', () => {
    const world = worldWithTree();
    me(world).hasAxe = false;

    run(world, FELL_SEC * 2, hold);

    expect(tree(world).felled).toBe(false);
    expect(me(world).chop).toBeNull();
  });

  it('yields four logs (Q16)', () => {
    const world = worldWithTree();
    run(world, FELL_SEC + TICK_DT, hold);

    // Items runs at stage 8, after chopping at stage 7, so a log that lands
    // within arm's reach is picked up on the same tick by the `E` still being
    // held — keep holding it and you gather the rest. Four either way.
    const onGround = Object.values(world.items).filter((i) => i.kind === 'log').length;
    expect(onGround + me(world).carrying.log).toBe(CHOP_YIELD_LOGS);

    for (const log of Object.values(world.items)) {
      const d = Math.hypot(log.pos.x - tree(world).pos.x, log.pos.y - tree(world).pos.y);
      expect(d).toBeLessThan(CHOP_RANGE_M);
    }
  });

  it('lets you gather the whole yield by keeping E held', () => {
    const world = worldWithTree();
    run(world, FELL_SEC + TICK_DT, hold);

    // Walk a slow circle round the stump with E down.
    const ring: [number, number][] = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    for (const [dx, dy] of ring) {
      me(world).pos = { x: tree(world).pos.x + dx * 0.6, y: tree(world).pos.y + dy * 0.6 };
      run(world, TICK_DT * 2, hold);
    }

    expect(me(world).carrying.log).toBe(CHOP_YIELD_LOGS);
    expect(Object.values(world.items).filter((i) => i.kind === 'log')).toHaveLength(0);
  });

  it('does not respawn — a felled tree stays felled (Q18)', () => {
    const world = worldWithTree();
    run(world, FELL_SEC + TICK_DT, hold);
    expect(tree(world).felled).toBe(true);

    run(world, 120, hold);

    expect(tree(world).felled).toBe(true);
    // No second yield, and no new trunk where the old one stood.
    const onGround = Object.values(world.items).filter((i) => i.kind === 'log').length;
    expect(onGround + me(world).carrying.log).toBe(CHOP_YIELD_LOGS);
  });
});

/**
 * Q20 — the payoff that makes chopping more than a resource tap. A felled tree
 * stops occluding permanently, so clearing a lane home is a real strategy, and
 * the grid has to actually be mutable for that to be true.
 */
describe('felling changes the world (Q20)', () => {
  it('clears the occluder tile', () => {
    const world = worldWithTree();
    expect(isOpaqueTile(world.grid, TREE_TILE.x, TREE_TILE.y)).toBe(true);

    run(world, FELL_SEC + TICK_DT, hold);

    expect(isOpaqueTile(world.grid, TREE_TILE.x, TREE_TILE.y)).toBe(false);
  });

  it('opens a sightline that was blocked a moment earlier', () => {
    const world = worldWithTree();
    const from = { x: TREE_TILE.x - 3, y: TREE_TILE.y + 0.5 };
    const to = { x: TREE_TILE.x + 4, y: TREE_TILE.y + 0.5 };

    expect(raycastLOS(world.grid, from, to)).toBe(false);

    run(world, FELL_SEC + TICK_DT, hold);

    // Same query, same grid object — this is what the lighting mask re-reads
    // every frame, which is why the light opens up the moment the tree goes.
    expect(raycastLOS(world.grid, from, to)).toBe(true);
  });

  it('lets you walk through where the trunk was', () => {
    const world = worldWithTree();
    run(world, FELL_SEC + TICK_DT, hold);

    // Walk east, straight through the old trunk.
    const east = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: 1 });
    const startX = me(world).pos.x;
    run(world, 2, east);

    expect(me(world).pos.x).toBeGreaterThan(startX + 2);
  });
});

describe('determinism', () => {
  it('produces identical state from identical inputs', () => {
    const a = worldWithTree();
    const b = worldWithTree();

    for (let i = 0; i < 200; i++) {
      const frame = i % 7 === 0 ? idle(i + 1) : hold(i + 1);
      step(a, { p1: frame }, TICK_DT);
      step(b, { p1: frame }, TICK_DT);
    }

    expect(a.trees).toEqual(b.trees);
    expect(a.items).toEqual(b.items);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
  });
});
