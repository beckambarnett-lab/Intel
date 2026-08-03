import { describe, expect, it } from 'vitest';
import { SOUND_RADIUS_M, WEIGHT_NOISE_MULT_AT_FULL, CARRY_CAPACITY_KG, MASS_KG } from '../constants.js';
import { createPlayer, createWorld } from '../types.js';
import type { WorldState } from '../types.js';
import { emitSounds, loudestAudibleAt } from './sound.js';
import { weight } from './weight.js';

function worldWith(setup: (w: WorldState) => void): WorldState {
  const world = createWorld(60, 40);
  world.players['p1'] = createPlayer('p1', 'p1', { x: 20, y: 20 });
  setup(world);
  return world;
}

const walk = (w: WorldState, speed: number): void => {
  const p = w.players['p1']!;
  p.vel = { x: speed, y: 0 };
};

describe('sound emission (Q58)', () => {
  it('is truly silent when you stand still — not merely quiet', () => {
    const world = worldWith(() => {});
    emitSounds(world);
    expect(world.sounds).toHaveLength(0);
  });

  it('is silent at a hair of residual velocity too', () => {
    const world = worldWith((w) => walk(w, 0.01));
    emitSounds(world);
    expect(world.sounds).toHaveLength(0);
  });

  it('carries 10m at a walk', () => {
    const world = worldWith((w) => walk(w, 4));
    emitSounds(world);
    expect(world.sounds[0]?.loudnessM).toBeCloseTo(SOUND_RADIUS_M.walk, 5);
    expect(world.sounds[0]?.kind).toBe('footfall');
  });

  it('carries 25m at a sprint and 3m at a creep', () => {
    const sprinting = worldWith((w) => {
      walk(w, 6);
      w.players['p1']!.intent.sprint = true;
    });
    emitSounds(sprinting);
    expect(sprinting.sounds[0]?.loudnessM).toBeCloseTo(SOUND_RADIUS_M.sprint, 5);

    const creeping = worldWith((w) => {
      walk(w, 1.5);
      w.players['p1']!.intent.creep = true;
    });
    emitSounds(creeping);
    expect(creeping.sounds[0]?.loudnessM).toBeCloseTo(SOUND_RADIUS_M.creep, 5);
  });

  it('gets louder with load (Q36)', () => {
    const world = worldWith((w) => {
      walk(w, 4);
      w.players['p1']!.carrying.log = Math.floor(CARRY_CAPACITY_KG / MASS_KG.log);
    });
    weight(world);
    emitSounds(world);

    const loud = world.sounds[0]?.loudnessM ?? 0;
    expect(loud).toBeGreaterThan(SOUND_RADIUS_M.walk);
    expect(loud).toBeLessThanOrEqual(SOUND_RADIUS_M.walk * WEIGHT_NOISE_MULT_AT_FULL + 1e-6);
  });

  it('carries 20m while chopping, standing still or not (Q17)', () => {
    const world = worldWith((w) => {
      w.players['p1']!.chop = { treeId: 't1', swingProgress: 0, swings: 0 };
    });
    emitSounds(world);

    const chop = world.sounds.find((s) => s.kind === 'chop');
    expect(chop?.loudnessM).toBeCloseTo(SOUND_RADIUS_M.chop, 5);
  });

  it('lives exactly one tick', () => {
    const world = worldWith((w) => walk(w, 4));
    emitSounds(world);
    expect(world.sounds).toHaveLength(1);
    // Stop moving; the previous tick's noise must not linger.
    world.players['p1']!.vel = { x: 0, y: 0 };
    emitSounds(world);
    expect(world.sounds).toHaveLength(0);
  });

  it('makes no noise once you are dead', () => {
    const world = worldWith((w) => {
      walk(w, 4);
      w.players['p1']!.alive = false;
    });
    emitSounds(world);
    expect(world.sounds).toHaveLength(0);
  });
});

describe('hearing', () => {
  it('is bounded by the emitter’s own radius, not the listener’s', () => {
    const world = worldWith((w) => walk(w, 4));
    emitSounds(world);

    // A walk carries 10m. 9m away hears it; 11m away does not.
    expect(loudestAudibleAt(world, { x: 29, y: 20 })).not.toBeNull();
    expect(loudestAudibleAt(world, { x: 31, y: 20 })).toBeNull();
  });

  it('picks the loudest thing, not the nearest', () => {
    const world = worldWith((w) => {
      walk(w, 4);
      w.players['p2'] = createPlayer('p2', 'p2', { x: 25, y: 20 });
      w.players['p2']!.vel = { x: 6, y: 0 };
      w.players['p2']!.intent.sprint = true;
    });
    emitSounds(world);

    const heard = loudestAudibleAt(world, { x: 22, y: 20 });
    expect(heard?.loudnessM).toBeCloseTo(SOUND_RADIUS_M.sprint, 5);
  });
});
