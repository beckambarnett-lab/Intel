import { describe, expect, it } from 'vitest';
import {
  BELIEF_CELL_M,
  FIRE_CAPACITY,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
} from '@ember/shared';
import type { InputFrame, LanternStage, WorldState } from '@ember/shared';
import { step } from '@ember/shared';
import { totalBelief } from './belief.js';
import { CreatureMind } from './mind.js';
import { personalityFor } from './personality.js';

/**
 * A seed whose first creature is talkative enough to call the others in.
 *
 * Personalities are deterministic but arbitrary, so a test about summoning has
 * to pick a run in which the caller is actually inclined to call. Searching for
 * one keeps the test honest — it exercises the real personality path rather
 * than reaching in and overwriting a trait.
 */
function seedWithVocalC1(): number {
  for (let seed = 1; seed < 500; seed++) {
    if (personalityFor('c1', seed).vocality > 0.6) return seed;
  }
  throw new Error('no vocal seed found');
}

let mind: CreatureMind;

function world(seed = 1): WorldState {
  mind = new CreatureMind(seed);
  const w = createWorld(200, 60, createGrid(200, 60));
  w.fire.pos = { x: 5, y: 5 };
  w.creatures['c1'] = createCreature('c1', { x: 100, y: 30 });
  w.players['p1'] = createPlayer('p1', 'p1', { x: 140, y: 30 });
  return w;
}

const player = (w: WorldState) => w.players['p1']!;

function setLantern(w: WorldState, stage: LanternStage): void {
  const ls = player(w).lantern;
  ls.stage = stage;
  ls.target = stage;
  ls.transition = 0;
  ls.bloom = 0;
  ls.fuel = 50;
}

const still = (seq: number): InputFrame => emptyInput(seq);
const creepEast = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: 1, creep: true });

function run(w: WorldState, seconds: number, frame: (seq: number) => InputFrame = still): void {
  const ticks = Math.round(seconds / TICK_DT);
  const hooks = mind.hooks();
  for (let i = 0; i < ticks; i++) step(w, { p1: frame(i + 1) }, TICK_DT, hooks);
}

const belief = (id: string) => totalBelief(mind.peek(id)!.belief);

describe('personality', () => {
  it('is stable for a given run and different between creatures', () => {
    const a = personalityFor('c1', 42);
    expect(personalityFor('c1', 42)).toEqual(a);

    const b = personalityFor('c2', 42);
    expect(b).not.toEqual(a);
  });

  it('varies between runs, so the same creature is not the same twice', () => {
    expect(personalityFor('c1', 1)).not.toEqual(personalityFor('c1', 2));
  });

  it('never produces a harmless one', () => {
    // The point of personality is that a creature is recognisable, not that one
    // of them can be safely ignored. Every trait stays near the middle.
    for (let seed = 1; seed < 60; seed++) {
      for (const id of ['c1', 'c2', 'c3', 'c4']) {
        const p = personalityFor(id, seed);
        for (const v of Object.values(p)) {
          expect(v).toBeGreaterThan(0.1);
          expect(v).toBeLessThan(0.9);
        }
      }
    }
  });
});

describe('belief in play', () => {
  it('stays completely empty against a player who emits nothing', () => {
    const w = world();
    setLantern(w, 'hooded');
    player(w).pos = { x: 190, y: 55 };

    run(w, 12);

    // Nothing sensed means nothing believed. This is the fairness rule in
    // miniature: there is no path from a true position into the field that does
    // not pass through something the creature actually perceived.
    expect(belief('c1')).toBe(0);
  });

  it('builds from a sighting', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 120, y: 30 };

    run(w, 1);

    expect(belief('c1')).toBeGreaterThan(0);
  });

  it('searches an area rather than orbiting a point once you are gone', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 118, y: 30 };

    // Seen, then gone.
    run(w, 1);
    setLantern(w, 'hooded');

    const visited = new Set<string>();
    const ticks = Math.round(30 / TICK_DT);
    const hooks = mind.hooks();
    for (let i = 0; i < ticks; i++) {
      step(w, { p1: creepEast(i + 1) }, TICK_DT, hooks);
      const c = w.creatures['c1']!;
      visited.add(
        `${Math.floor(c.pos.x / BELIEF_CELL_M)},${Math.floor(c.pos.y / BELIEF_CELL_M)}`,
      );
    }

    // Checking ground removes it from consideration, so the search works
    // outward. A creature that orbited one peak would sit in one or two cells.
    expect(visited.size).toBeGreaterThanOrEqual(3);
  });
});

describe('calling the pack in', () => {
  it('hands belief to a creature in earshot, and not to one outside it', () => {
    const seed = seedWithVocalC1();
    const w = world(seed);

    setLantern(w, 'full');
    player(w).pos = { x: 106, y: 30 };
    // Near enough to hear the call, too far to see the lantern itself.
    w.creatures['c2'] = createCreature('c2', { x: 162, y: 30 });
    // Beyond the call's 80m reach.
    w.creatures['c3'] = createCreature('c3', { x: 196, y: 55 });

    run(w, 3);

    expect(belief('c1')).toBeGreaterThan(0);
    expect(belief('c2')).toBeGreaterThan(0);
    expect(belief('c3')).toBe(0);
  });
});

describe('the pack', () => {
  it('spreads out instead of piling onto the same place', () => {
    const w = world();
    setLantern(w, 'hooded');
    player(w).pos = { x: 195, y: 55 };

    // Three creatures stacked on one spot with identical anchors.
    for (const id of ['c1', 'c2', 'c3']) {
      w.creatures[id] = createCreature(id, { x: 100, y: 30 });
    }

    run(w, 20);

    const positions = ['c1', 'c2', 'c3'].map((id) => w.creatures[id]!.pos);
    let closest = Infinity;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        closest = Math.min(
          closest,
          Math.hypot(positions[i]!.x - positions[j]!.x, positions[i]!.y - positions[j]!.y),
        );
      }
    }

    // Four hunters that clump cover a quarter of the ground and read as one
    // animal with four bodies.
    expect(closest).toBeGreaterThan(5);
  });

  it('leans on the camp as the fire fails, without a mode switching on', () => {
    const w = world();
    w.fire.pos = { x: 40, y: 30 };
    setLantern(w, 'hooded');
    player(w).pos = { x: 195, y: 55 };
    w.creatures['c1'] = createCreature('c1', { x: 150, y: 30 });

    // Healthy fire: it has no reason to come near, and the perimeter holds
    // anyway, so crowding it would just look foolish.
    w.fire.fuel = FIRE_CAPACITY;
    run(w, 12);
    const whileHealthy = Math.hypot(
      w.creatures['c1']!.pos.x - w.fire.pos.x,
      w.creatures['c1']!.pos.y - w.fire.pos.y,
    );

    // Guttering: the pull comes on gradually as the numbers move.
    const w2 = world();
    w2.fire.pos = { x: 40, y: 30 };
    setLantern(w2, 'hooded');
    player(w2).pos = { x: 195, y: 55 };
    w2.creatures['c1'] = createCreature('c1', { x: 150, y: 30 });
    w2.fire.fuel = FIRE_CAPACITY * 0.05;
    run(w2, 12);
    const whileFailing = Math.hypot(
      w2.creatures['c1']!.pos.x - w2.fire.pos.x,
      w2.creatures['c1']!.pos.y - w2.fire.pos.y,
    );

    expect(whileFailing).toBeLessThan(whileHealthy);
  });
});
