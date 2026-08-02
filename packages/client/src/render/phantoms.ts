import {
  PHANTOM_DESPAWN_M,
  PHANTOM_LIFETIME_SEC,
  PHANTOM_MAX_CONCURRENT,
  PHANTOM_MIN_ROT,
  PHANTOM_SPAWN_ATTEMPTS,
  PHANTOM_SPAWN_INTERVAL_SEC,
  PHANTOM_SPAWN_MAX_M,
  PHANTOM_SPAWN_MIN_M,
  PHANTOM_SPEED_MPS,
} from '@ember/shared';
import type { Vec2 } from '@ember/shared';

/**
 * A shape you are not sure you saw (Q49–Q52).
 *
 * Phantoms are client-only and exist nowhere in the sim: they are produced by
 * your own rotting memory, they are per-player like the memory itself (Q53),
 * and no other client ever hears about them. They are also the reason the
 * darkness stays tense once you have cleared an area — the map you are
 * navigating by is no longer evidence.
 */
export interface Phantom {
  id: number;
  pos: Vec2;
  /** Seconds since it appeared. */
  ageSec: number;
}

/**
 * Everything the spawner is allowed to ask about the world.
 *
 * Deliberately this narrow. `blockedAt` reads the TRUE occluder grid and
 * `rotAt` reads the memory field, and keeping them behind one interface with
 * two clearly labelled methods is what stops the second ever being mistaken
 * for the first (Q48).
 */
export interface PhantomEnv {
  /** Memory staleness at a world point, 0..1. 1 is fully rotten or never seen. */
  rotAt(x: number, y: number): number;
  /** Has this point ever been lit? A phantom is a memory; it needs one to live in. */
  seenAt(x: number, y: number): boolean;
  /** True geometry. A phantom never stands inside rock. */
  blockedAt(x: number, y: number): boolean;
  /** Is real light touching this point right now? Q51: that is fatal to them. */
  litAt(x: number, y: number): boolean;
}

/**
 * The population, and the rules that govern it.
 *
 * Kept free of PixiJS on purpose so the behaviour is testable without a
 * browser; `stage.ts` owns the drawing and passes in an env backed by the real
 * grid and the real memory field.
 */
export class PhantomField {
  readonly phantoms: Phantom[] = [];

  private rand: () => number;
  private nextId = 1;

  /**
   * `rand` is injected rather than seeded here so tests can be deterministic.
   * In the client it is a per-session PRNG: memory is per-player (Q53), so two
   * players standing in the same rotten clearing should not hallucinate the
   * same thing in the same place.
   */
  constructor(rand: () => number) {
    this.rand = rand;
  }

  update(env: PhantomEnv, viewer: Vec2, dtSec: number): void {
    this.drift(env, viewer, dtSec);
    this.trySpawn(env, viewer, dtSec);
  }

  /** Q54: your memory is wiped on revival, and its inventions go with it. */
  forget(): void {
    this.phantoms.length = 0;
  }

  /**
   * Q50: they move slowly, and toward you. Straight-line, through everything —
   * they are not in the world, so nothing in the world is in their way.
   */
  private drift(env: PhantomEnv, viewer: Vec2, dtSec: number): void {
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const p = this.phantoms[i];
      if (!p) continue;

      p.ageSec += dtSec;

      const dx = viewer.x - p.pos.x;
      const dy = viewer.y - p.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4) {
        const stride = (PHANTOM_SPEED_MPS * dtSec) / dist;
        p.pos.x += dx * stride;
        p.pos.y += dy * stride;
      }

      // Q51: any real light touching one dispels it instantly. That is the
      // relief beat, and it is why raising the lantern at a shape costs fuel.
      const dispelled = env.litAt(p.pos.x, p.pos.y);
      const expired = p.ageSec >= PHANTOM_LIFETIME_SEC;
      const lost = dist > PHANTOM_DESPAWN_M;

      if (dispelled || expired || lost) this.phantoms.splice(i, 1);
    }
  }

  /**
   * Q49: spawn chance scales with rot, landing at roughly one per 20s when the
   * memory in view is fully rotten.
   *
   * One roll per frame for *whether* to look, then the candidate's own rot
   * decides whether it takes. Rolling per candidate instead would multiply the
   * rate by the attempt budget, which would make PHANTOM_SPAWN_ATTEMPTS a
   * difficulty dial by accident.
   */
  private trySpawn(env: PhantomEnv, viewer: Vec2, dtSec: number): void {
    if (this.phantoms.length >= PHANTOM_MAX_CONCURRENT) return;
    if (this.rand() >= dtSec / PHANTOM_SPAWN_INTERVAL_SEC) return;

    for (let attempt = 0; attempt < PHANTOM_SPAWN_ATTEMPTS; attempt++) {
      const angle = this.rand() * Math.PI * 2;
      const range =
        PHANTOM_SPAWN_MIN_M + this.rand() * (PHANTOM_SPAWN_MAX_M - PHANTOM_SPAWN_MIN_M);

      const x = viewer.x + Math.cos(angle) * range;
      const y = viewer.y + Math.sin(angle) * range;

      if (env.blockedAt(x, y)) continue;
      // Somewhere you have been, that you cannot see now, and that you have
      // half forgotten. All three are required: a phantom in ground you have
      // never walked would be an invention rather than a misremembering.
      if (!env.seenAt(x, y)) continue;
      if (env.litAt(x, y)) continue;

      const r = env.rotAt(x, y);
      if (r < PHANTOM_MIN_ROT) continue;
      if (this.rand() >= r) continue;

      this.phantoms.push({ id: this.nextId++, pos: { x, y }, ageSec: 0 });
      return;
    }
  }
}
