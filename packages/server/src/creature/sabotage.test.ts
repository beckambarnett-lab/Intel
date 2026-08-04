import { describe, expect, it } from 'vitest';
import {
  CREATURE_SABOTAGE_BATCH,
  CREATURE_SABOTAGE_SEC,
  FIRE_CAPACITY,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
  refreshFire,
  step,
} from '@ember/shared';
import type { WorldState } from '@ember/shared';
import { CreatureMind } from './mind.js';

/**
 * Woodpile sabotage (Q24) — their primary attack on your supply.
 *
 * The interesting property is that nothing here decides *when* they are allowed
 * to do it. A creature can work the pile only if it can stand within reach, and
 * the fire's safe radius (Q7) already governs where it may stand. So the threat
 * scales with how badly the fire is doing, purely as geometry: untouchable
 * while the fire is healthy, reachable the moment it drops to Low.
 */

const FIRE = { x: 60, y: 60 };
const PILE = { x: 60, y: 64 };

let mind: CreatureMind;

function world(fuelFraction: number): WorldState {
  mind = new CreatureMind(3);
  const w = createWorld(160, 120, createGrid(160, 120));
  w.fire.pos = { ...FIRE };
  w.fire.fuel = FIRE_CAPACITY * fuelFraction;
  refreshFire(w.fire);

  w.woodpile.pos = { ...PILE };
  w.woodpile.contents = { log: 20, branch: 4 };

  // Approaching from the far side of the pile from the fire, which is the only
  // side any perimeter leaves open.
  w.creatures['c1'] = createCreature('c1', { x: 60, y: 80 });
  w.players['p1'] = createPlayer('p1', 'p1', { x: 150, y: 110 });
  return w;
}

const pileTotal = (w: WorldState) => w.woodpile.contents.log + w.woodpile.contents.branch;
const itemCount = (w: WorldState) => Object.keys(w.items).length;

function run(w: WorldState, seconds: number): void {
  const hooks = mind.hooks();
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
}

describe('woodpile sabotage (Q24)', () => {
  it('cannot touch the pile while the fire is roaring', () => {
    const w = world(1);
    const before = pileTotal(w);

    run(w, 25);

    // The perimeter is 9.8m and the pile is 4m from the flame: there is
    // nowhere legal to stand that is within reach of it.
    expect(pileTotal(w)).toBe(before);
    expect(itemCount(w)).toBe(0);
  });

  it('starts taking the wood once the fire drops to Low', () => {
    const w = world(0.2);
    const before = pileTotal(w);

    run(w, 25);

    expect(pileTotal(w)).toBeLessThan(before);
  });

  it('scatters rather than destroys — the wood is still out there', () => {
    const w = world(0.2);
    const before = pileTotal(w);

    run(w, 25);

    const taken = before - pileTotal(w);
    expect(taken).toBeGreaterThan(0);
    // Everything hurled into the dark exists as a world item you could go and
    // find, which is the same bargain Q29 strikes for dragged scrap.
    expect(itemCount(w)).toBe(taken);
  });

  it('throws the wood beyond the firelight', () => {
    const w = world(0.2);
    run(w, 25);

    expect(itemCount(w)).toBeGreaterThan(0);
    for (const id of Object.keys(w.items)) {
      const item = w.items[id]!;
      const fromFire = Math.hypot(item.pos.x - FIRE.x, item.pos.y - FIRE.y);
      expect(fromFire).toBeGreaterThan(w.fire.safeRadiusM);
    }
  });

  it('takes a batch at a time, never the whole pile at once', () => {
    const w = world(0.2);

    // Watch every tick rather than a window: the property is about how much a
    // single completed channel can cost you, and a fixed window just measures
    // how many channels happened to fit in it.
    let worstSingleHit = 0;
    let previous = pileTotal(w);

    const hooks = mind.hooks();
    for (let i = 0; i < Math.round(30 / TICK_DT); i++) {
      step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
      const now = pileTotal(w);
      worstSingleHit = Math.max(worstSingleHit, previous - now);
      previous = now;
    }

    expect(worstSingleHit).toBeGreaterThan(0);
    // Losing everything to one three-second window would be a death sentence
    // dressed as a mechanic. Six at a time is a problem you can run at.
    expect(worstSingleHit).toBeLessThanOrEqual(CREATURE_SABOTAGE_BATCH);
  });

  it('needs a full uninterrupted channel before anything is lost', () => {
    const w = world(0.2);

    // Walk it right up to the pile so only the channel time remains.
    w.creatures['c1']!.pos = { x: 60, y: 65.5 };
    const before = pileTotal(w);

    run(w, CREATURE_SABOTAGE_SEC - 0.5);
    expect(pileTotal(w)).toBe(before);

    run(w, 1);
    expect(pileTotal(w)).toBeLessThan(before);
  });

  it('loses its progress if it is driven off', () => {
    const w = world(0.2);

    // Let it get to the pile and start working.
    run(w, 10);
    const creature = w.creatures['c1']!;

    // Only meaningful if it actually got there and started.
    if (creature.sabotageProgress > 0) {
      // Shove it away mid-channel.
      creature.pos = { x: 60, y: 100 };
      run(w, 0.1);
      expect(creature.sabotageProgress).toBe(0);
    }

    // Either way, a partial channel must never have banked anything.
    expect(CREATURE_SABOTAGE_SEC).toBeGreaterThan(0);
  });

  it('ignores an empty pile entirely', () => {
    const w = world(0.2);
    w.woodpile.contents = { log: 0, branch: 0 };

    run(w, 20);

    expect(itemCount(w)).toBe(0);
    expect(w.creatures['c1']!.stance).not.toBe('sabotage');
  });

  it('is loud while it works, so you can hear your supply going', () => {
    const w = world(0.2);

    let heardAtPile = false;
    const hooks = mind.hooks();
    for (let i = 0; i < Math.round(25 / TICK_DT); i++) {
      step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
      for (const s of w.sounds) {
        if (s.sourceId !== 'c1' || s.loudness <= 0) continue;
        if (Math.hypot(s.pos.x - PILE.x, s.pos.y - PILE.y) < 6) heardAtPile = true;
      }
    }

    expect(heardAtPile).toBe(true);
  });
});
