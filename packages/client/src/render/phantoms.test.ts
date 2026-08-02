import {
  PHANTOM_DESPAWN_M,
  PHANTOM_LIFETIME_SEC,
  PHANTOM_MAX_CONCURRENT,
  PHANTOM_SPAWN_MAX_M,
  PHANTOM_SPAWN_MIN_M,
  PHANTOM_SPEED_MPS,
} from '@ember/shared';
import { describe, expect, it } from 'vitest';
import { PhantomField } from './phantoms.js';
import type { PhantomEnv } from './phantoms.js';

/** Rotten everywhere, open everywhere, dark everywhere: maximum spawn pressure. */
function rottenEnv(overrides: Partial<PhantomEnv> = {}): PhantomEnv {
  return {
    rotAt: () => 1,
    seenAt: () => true,
    blockedAt: () => false,
    litAt: () => false,
    ...overrides,
  };
}

/** A PRNG that always returns 0 — every probability gate passes. */
const alwaysSpawn = (): number => 0;

describe('phantoms', () => {
  it('appears only in memory you have actually been in', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv({ seenAt: () => false }), { x: 50, y: 50 }, 1);
    expect(field.phantoms).toHaveLength(0);
  });

  it('does not appear in memory that is still fresh (Q49)', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv({ rotAt: () => 0 }), { x: 50, y: 50 }, 1);
    expect(field.phantoms).toHaveLength(0);
  });

  it('never stands inside rock — the true grid still rules (Q48)', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv({ blockedAt: () => true }), { x: 50, y: 50 }, 1);
    expect(field.phantoms).toHaveLength(0);
  });

  it('spawns at arm’s length, never on top of you', () => {
    const field = new PhantomField(alwaysSpawn);
    const viewer = { x: 60, y: 60 };
    field.update(rottenEnv(), viewer, 1);

    expect(field.phantoms).toHaveLength(1);
    const p = field.phantoms[0]!;
    const dist = Math.hypot(p.pos.x - viewer.x, p.pos.y - viewer.y);
    expect(dist).toBeGreaterThanOrEqual(PHANTOM_SPAWN_MIN_M - 1e-6);
    expect(dist).toBeLessThanOrEqual(PHANTOM_SPAWN_MAX_M + 1e-6);
  });

  it('will not spawn into light (Q51)', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv({ litAt: () => true }), { x: 50, y: 50 }, 1);
    expect(field.phantoms).toHaveLength(0);
  });

  it('drifts toward the viewer, slowly (Q50)', () => {
    const field = new PhantomField(alwaysSpawn);
    const viewer = { x: 0, y: 0 };
    field.update(rottenEnv(), viewer, 1);

    const p = field.phantoms[0]!;
    const before = Math.hypot(p.pos.x, p.pos.y);
    // A dark, fully-spawned field: no new arrivals, just the drift.
    field.update(rottenEnv(), viewer, 1);
    const after = Math.hypot(p.pos.x, p.pos.y);

    expect(before - after).toBeCloseTo(PHANTOM_SPEED_MPS, 5);
  });

  it('is dispelled instantly by any real light (Q51)', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv(), { x: 50, y: 50 }, 1);
    expect(field.phantoms).toHaveLength(1);

    field.update(rottenEnv({ litAt: () => true }), { x: 50, y: 50 }, 0.05);
    expect(field.phantoms).toHaveLength(0);
  });

  it('expires rather than following you forever', () => {
    const field = new PhantomField(alwaysSpawn);
    const viewer = { x: 0, y: 0 };
    field.update(rottenEnv(), viewer, 1);
    const id = field.phantoms[0]!.id;

    // Hold it at range so the drift cannot end the test early, and let its
    // lifetime run out.
    const env = rottenEnv();
    for (let t = 0; t < PHANTOM_LIFETIME_SEC + 2; t++) {
      field.update(env, { x: 1000, y: 1000 }, 1);
    }

    expect(field.phantoms.some((p) => p.id === id)).toBe(false);
  });

  it('is forgotten once it falls far behind you', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv(), { x: 0, y: 0 }, 1);
    expect(field.phantoms).toHaveLength(1);

    // One step with the viewer far away: the drift runs, then the range check
    // finds it beyond the despawn distance.
    field.update(rottenEnv({ rotAt: () => 0 }), { x: PHANTOM_DESPAWN_M * 4, y: 0 }, 0.05);
    expect(field.phantoms).toHaveLength(0);
  });

  it('holds the population to a crowd you can still be unsure about', () => {
    const field = new PhantomField(alwaysSpawn);
    const env = rottenEnv();
    for (let i = 0; i < 50; i++) field.update(env, { x: 500, y: 500 }, 1);
    expect(field.phantoms.length).toBeLessThanOrEqual(PHANTOM_MAX_CONCURRENT);
  });

  it('spawns at roughly the Q49 rate — one per 20s in fully rotten memory', () => {
    // A real PRNG this time, and one phantom at a time so the population cap
    // cannot mask the rate.
    let state = 12345;
    const rand = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    const field = new PhantomField(rand);
    const env = rottenEnv();
    const dt = 1 / 60;
    let spawned = 0;
    let lastCount = 0;

    // Ten simulated minutes. Phantoms are cleared each step so the cap never
    // suppresses a spawn and we are measuring the rate alone.
    for (let i = 0; i < 600 * 60; i++) {
      field.update(env, { x: 500, y: 500 }, dt);
      if (field.phantoms.length > lastCount) spawned++;
      field.forget();
      lastCount = 0;
    }

    // 600s at one per 20s is 30. Generous bounds — this asserts the order of
    // magnitude is right, not the PRNG's exact stream.
    expect(spawned).toBeGreaterThan(18);
    expect(spawned).toBeLessThan(48);
  });

  it('forgets everything on revival (Q54)', () => {
    const field = new PhantomField(alwaysSpawn);
    field.update(rottenEnv(), { x: 50, y: 50 }, 1);
    expect(field.phantoms.length).toBeGreaterThan(0);

    field.forget();
    expect(field.phantoms).toHaveLength(0);
  });
});
