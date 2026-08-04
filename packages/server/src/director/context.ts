import type { PerceptionSnapshot } from './perception.js';

/**
 * The director's entire view of the world.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE MAY IMPORT `./perception.js` AND NOTHING ELSE. EVER.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Not the shared package, not the world, not the types, not a helper that
 * happens to reach one of those. That single import is the fairness boundary
 * (Q114), and it is enforced three ways: by an ESLint `no-restricted-imports`
 * rule, by a CI-blocking test that reads this file's own source, and by the
 * fact that `PerceptionSnapshot` is a closed structure only the creature
 * sensing path can fill.
 *
 * Why so heavy-handed for one import line: an enemy handed live player
 * positions does not read as a cheating enemy, it reads as an uncannily good
 * one. No playtester files that bug. The game just quietly stops being fair,
 * and the only defence is making the leak impossible to write rather than
 * unlikely to be written. DESIGN.md Step 10 is explicit that this is the trap —
 * "do not help the model by adding player positions to the context" — and the
 * whole point of a structural boundary is that a future edit under deadline
 * cannot take that shortcut without deleting a rule and a test on the way.
 *
 * Everything here is deliberately a *digest*, not a view onto live state. There
 * is no world reference to dereference, no entity to follow, nothing that
 * updates after it is built.
 */

/** A thing the pack saw or heard, aged into something a commander can use. */
export interface ContextEvent {
  kind: 'light' | 'sound';
  /** Where it happened, as observed. */
  pos: { x: number; y: number };
  /** Seconds ago. Staleness is most of what makes a report worth acting on. */
  ageSec: number;
  /** 0..1. Brightness for a light, relative loudness for a sound. */
  strength: number;
  /** Which creature reported it. */
  by: string;
}

export interface ContextCreature {
  id: string;
  pos: { x: number; y: number };
  health: number;
  stance: string;
  /** Where this creature believes somebody is, if it believes anything. */
  believes: { pos: { x: number; y: number }; confidence: number } | null;
}

export interface DirectorContext {
  elapsedSec: number;
  /** The pack, reporting on itself. */
  creatures: ContextCreature[];
  /** What has been perceived recently, newest first. */
  events: ContextEvent[];
  /** Only when a creature can currently see the camp. */
  fireTier: string | null;
  /**
   * True when nothing has been perceived at all.
   *
   * Worth stating explicitly rather than leaving the model to infer it from an
   * empty list. Most windows of a run genuinely contain nothing, and a director
   * that treats "no news" as a puzzle to solve will invent significance that is
   * not there — which is how a strategist starts hallucinating a hunt.
   */
  blind: boolean;
}

/** Ticks per second. Local by necessity: this file imports nothing. */
const TICKS_PER_SEC = 20;

/** How many events to carry. Keeps the dynamic block small (Q118). */
const MAX_EVENTS = 24;

/**
 * Build the director's context from perception, and from nothing else.
 *
 * A pure function of its argument. That is not a style preference — it is what
 * makes the boundary testable: given a snapshot, the output is fully
 * determined, so a test can assert exactly which facts can possibly appear.
 */
export function buildDirectorContext(snapshot: PerceptionSnapshot): DirectorContext {
  const events: ContextEvent[] = [];

  for (const light of snapshot.lights) {
    events.push({
      kind: 'light',
      pos: { x: round(light.pos.x), y: round(light.pos.y) },
      ageSec: round((snapshot.tick - light.tick) / TICKS_PER_SEC),
      strength: round(light.brightness),
      by: light.by,
    });
  }

  for (const sound of snapshot.sounds) {
    events.push({
      kind: 'sound',
      pos: { x: round(sound.pos.x), y: round(sound.pos.y) },
      ageSec: round((snapshot.tick - sound.tick) / TICKS_PER_SEC),
      // Normalised against the loudest thing in the game, a gunshot at 60m.
      strength: round(Math.min(1, sound.loudness / 60)),
      by: sound.by,
    });
  }

  events.sort((a, b) => a.ageSec - b.ageSec);
  const recent = events.slice(0, MAX_EVENTS);

  const creatures: ContextCreature[] = snapshot.creatures
    .filter((c) => c.alive)
    .map((c) => ({
      id: c.id,
      pos: { x: round(c.pos.x), y: round(c.pos.y) },
      health: c.health,
      stance: c.stance,
      believes: c.believes
        ? {
            pos: { x: round(c.believes.pos.x), y: round(c.believes.pos.y) },
            // Mass is unbounded; the director wants a confidence, not a number
            // whose scale it would have to be taught.
            confidence: round(Math.min(1, c.believes.mass)),
          }
        : null,
    }));

  return {
    elapsedSec: round(snapshot.elapsedSec),
    creatures,
    events: recent,
    fireTier: snapshot.fireTier,
    blind: recent.length === 0 && creatures.every((c) => c.believes === null),
  };
}

/** One decimal place. Metre-fractions are noise to a commander, and tokens. */
function round(v: number): number {
  return Math.round(v * 10) / 10;
}
