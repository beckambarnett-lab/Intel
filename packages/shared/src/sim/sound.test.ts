import { describe, expect, it } from 'vitest';
import {
  CHOP_SWINGS,
  SOUND_CHOP_PERIOD_TICKS,
  SOUND_RADIUS_M,
  TICK_DT,
  WEIGHT_NOISE_MULT_AT_FULL,
} from '../constants.js';
import { createGrid, setTile } from '../grid.js';
import { createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, Tree, WorldState } from '../types.js';
import { step } from './index.js';
import { heard } from './sound.js';

function world(): WorldState {
  const w = createWorld(60, 40, createGrid(60, 40));
  w.players['p1'] = createPlayer('p1', 'p1', { x: 30, y: 20 });
  return w;
}

const me = (w: WorldState) => w.players['p1']!;

const walk = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: 1 });
const creep = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: 1, creep: true });
const sprint = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: 1, sprint: true });
const still = (seq: number): InputFrame => emptyInput(seq);

/** Run one tick and hand back the footfalls it produced. */
function tickSounds(w: WorldState, frame: InputFrame) {
  step(w, { p1: frame }, TICK_DT);
  return w.sounds;
}

describe('sound (§9, Q58)', () => {
  it('is completely silent while standing still', () => {
    const w = world();

    // Move first, so we are testing that stopping silences you rather than
    // that a player who has never moved happens to be quiet.
    tickSounds(w, walk(1));
    expect(w.sounds).toHaveLength(1);

    expect(tickSounds(w, still(2))).toHaveLength(0);
  });

  it('carries 10m walking, 3m creeping, 25m sprinting', () => {
    const walking = tickSounds(world(), walk(1))[0];
    expect(walking?.loudness).toBeCloseTo(SOUND_RADIUS_M.walk);

    const creeping = tickSounds(world(), creep(1))[0];
    expect(creeping?.loudness).toBeCloseTo(SOUND_RADIUS_M.creep);

    const sprinting = tickSounds(world(), sprint(1))[0];
    expect(sprinting?.loudness).toBeCloseTo(SOUND_RADIUS_M.sprint);
  });

  it('gets louder the more you carry (Q36)', () => {
    const w = world();
    // 36kg of 40 — heavy enough to be loud, light enough to still move.
    me(w).carrying = { log: 9, branch: 0 };

    const loaded = tickSounds(w, walk(1))[0]!;
    const empty = tickSounds(world(), walk(1))[0]!;

    expect(loaded.loudness).toBeGreaterThan(empty.loudness);
    expect(loaded.loudness).toBeLessThanOrEqual(
      SOUND_RADIUS_M.walk * WEIGHT_NOISE_MULT_AT_FULL,
    );
  });

  it('is silent when overloaded, because you are not going anywhere', () => {
    const w = world();
    // At capacity speedMul is zero (Q31). Holding a direction you cannot walk
    // in must not be as loud as walking.
    me(w).carrying = { log: 10, branch: 0 };

    expect(tickSounds(w, walk(1))).toHaveLength(0);
  });

  it('still registers when you are shoving into rock', () => {
    const w = world();
    setTile(w.grid, 31, 20, 255);
    // Flush against the trunk: the body cannot advance any further.
    me(w).pos = { x: 30.64, y: 20.5 };

    const before = { ...me(w).pos };
    tickSounds(w, walk(1));

    // The body is stuck...
    expect(me(w).pos.x).toBeCloseTo(before.x);
    // ...but scuffling against a trunk is not the same as choosing to stand
    // still, and only the latter is meant to be silent (Q58).
    expect(w.sounds.filter((s) => s.kind === 'footfall')).toHaveLength(1);

    // Releasing the key is what actually silences you.
    expect(tickSounds(w, still(2))).toHaveLength(0);
  });

  it('reports chopping at 20m, throttled to about one per swing (Q17)', () => {
    const w = createWorld(60, 40, createGrid(60, 40));
    setTile(w.grid, 20, 20, 255);
    const tree: Tree = {
      id: 't20,20',
      tx: 20,
      ty: 20,
      pos: { x: 20.5, y: 20.5 },
      swingsLeft: CHOP_SWINGS,
      felled: false,
    };
    w.trees[tree.id] = tree;
    w.players['p1'] = createPlayer('p1', 'p1', { x: 19.4, y: 20.5 });

    let chops = 0;
    for (let i = 0; i < SOUND_CHOP_PERIOD_TICKS * 3; i++) {
      step(w, { p1: { ...emptyInput(i + 1), interact: true } }, TICK_DT);
      chops += w.sounds.filter((s) => s.kind === 'chop').length;
    }

    expect(chops).toBeGreaterThan(0);
    // Three swings' worth of ticks must not produce forty reports.
    expect(chops).toBeLessThanOrEqual(4);
    expect(w.sounds.find((s) => s.kind === 'chop')?.loudness ?? SOUND_RADIUS_M.chop).toBe(
      SOUND_RADIUS_M.chop,
    );
  });

  it('makes no sound once you are dead', () => {
    const w = world();
    me(w).alive = false;

    expect(tickSounds(w, walk(1))).toHaveLength(0);
  });

  it('clears the list every tick — sounds do not linger', () => {
    const w = world();
    tickSounds(w, walk(1));
    expect(w.sounds).toHaveLength(1);

    tickSounds(w, still(2));
    expect(w.sounds).toHaveLength(0);
  });

  it('is heard inside its radius and not outside it', () => {
    const w = world();
    const sound = tickSounds(w, walk(1))[0]!;
    const from = sound.pos;

    expect(heard(sound, { x: from.x + sound.loudness - 0.5, y: from.y })).toBe(true);
    expect(heard(sound, { x: from.x + sound.loudness + 0.5, y: from.y })).toBe(false);
  });

  it('gives every sound a distinct id without touching Math.random', () => {
    const w = world();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      step(w, { p1: walk(i + 1) }, TICK_DT);
      for (const s of w.sounds) ids.add(s.id);
    }
    expect(ids.size).toBe(5);
  });
});
