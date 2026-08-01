import {
  LANTERN_STAGES,
  VISIBILITY_HYSTERESIS_MS,
  createPlayer,
  createWorld,
  fillRect,
} from '@ember/shared';
import type { Player, PlayerId, WorldState } from '@ember/shared';
import { describe, expect, it } from 'vitest';
import { VisibilityIndex, fireViewFor } from './visibility.js';

const FIRE = { x: 10, y: 10 };
const FIRE_RADIUS = 6;

function world(): WorldState {
  const w = createWorld(80, 40);
  w.fire.pos = { ...FIRE };
  // Pinned rather than derived from fuel: these tests are about who can see
  // whom at a given light radius, not about how the fire got there.
  w.fire.lightRadiusM = FIRE_RADIUS;
  return w;
}

function addPlayer(w: WorldState, id: PlayerId, x: number, y: number): Player {
  const p = createPlayer(id, id, { x, y });
  w.players[id] = p;
  return p;
}

function idsVisibleTo(
  index: VisibilityIndex,
  w: WorldState,
  viewer: PlayerId,
  now = 0,
): string[] {
  return index
    .visibleTo(w, viewer, now)
    .map((p) => p.id)
    .sort();
}

/**
 * These tests are the executable form of the rule in CLAUDE.md: the server
 * never sends a client anything it cannot see. Every one of them is a claim
 * about what is absent from the payload, which is the only kind of claim that
 * can catch this regressing.
 */
describe('per-player visibility culling (Q122)', () => {
  it('always includes yourself, wherever you are', () => {
    const w = world();
    addPlayer(w, 'p1', 70, 35); // far from the fire, alone in the dark
    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1']);
  });

  it('does NOT send a player standing in the dark across the map', () => {
    const w = world();
    addPlayer(w, 'p1', 10, 10);
    addPlayer(w, 'p2', 70, 35);
    const index = new VisibilityIndex();

    // p2 is well outside p1's lantern and outside the firelight.
    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1']);
  });

  it('sends a player inside your own lantern light', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    // Inside the default 'low' stage radius.
    addPlayer(w, 'p2', 40 + LANTERN_STAGES.low.radiusM - 1, 20);
    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1', 'p2']);
  });

  it('drops them again the moment they step past the edge of the light', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    const p2 = addPlayer(w, 'p2', 40 + LANTERN_STAGES.low.radiusM - 1, 20);
    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1', 0)).toEqual(['p1', 'p2']);

    p2.pos.x = 40 + LANTERN_STAGES.low.radiusM + 5;
    // Past the hysteresis window, so this is the steady state, not the tail.
    expect(idsVisibleTo(index, w, 'p1', VISIBILITY_HYSTERESIS_MS + 1)).toEqual(['p1']);
  });

  it('sends a player lit by the bonfire even when your own lantern is hooded', () => {
    const w = world();
    const p1 = addPlayer(w, 'p1', 30, 10);
    p1.lantern.stage = 'hooded';
    p1.lantern.target = 'hooded';
    addPlayer(w, 'p2', FIRE.x + 2, FIRE.y);
    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1', 'p2']);
  });

  it('does not send a firelit player you have no line to', () => {
    const w = world();
    // A wall between p1 and the fire's clearing.
    fillRect(w.grid, { x: 20, y: 0, w: 1, h: 40 });

    const p1 = addPlayer(w, 'p1', 30, 10);
    p1.lantern.stage = 'hooded';
    p1.lantern.target = 'hooded';
    addPlayer(w, 'p2', FIRE.x + 2, FIRE.y);
    const index = new VisibilityIndex();

    // p2 is lit, but standing in firelight must not broadcast your position
    // through solid rock.
    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1']);
  });

  it('does not send a player hidden behind an occluder inside your light radius', () => {
    const w = world();
    fillRect(w.grid, { x: 42, y: 18, w: 1, h: 5 });

    addPlayer(w, 'p1', 40, 20);
    addPlayer(w, 'p2', 43.5, 20); // within 4m, but behind the wall
    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1']);
  });

  it('is not symmetric when the lanterns differ — a bright light sees a dark one', () => {
    const w = world();
    const bright = addPlayer(w, 'p1', 40, 20);
    bright.lantern.stage = 'full';
    bright.lantern.target = 'full';

    const dark = addPlayer(w, 'p2', 46, 20);
    dark.lantern.stage = 'hooded';
    dark.lantern.target = 'hooded';

    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1')).toEqual(['p1', 'p2']);
    expect(idsVisibleTo(index, w, 'p2')).toEqual(['p2']);
  });
});

/**
 * The bloom is meant to be readable from the far end of the map (Q13), so tier
 * and radius are public. The exact fuel is not — Q127 says it is only legible
 * near the fire, and a number on the wire is a number in devtools.
 */
describe('what the fire tells you (Q13, Q127)', () => {
  it('always reports tier and radius, however far away you are', () => {
    const w = world();
    addPlayer(w, 'p1', 75, 38); // far corner, in the dark

    const view = fireViewFor(w, 'p1');
    expect(view.tier).toBe(w.fire.tier);
    expect(view.lightRadiusM).toBe(w.fire.lightRadiusM);
    expect(view.pos).toEqual(w.fire.pos);
  });

  it('withholds the exact fuel and countdown from a distant player', () => {
    const w = world();
    addPlayer(w, 'p1', 75, 38);

    const view = fireViewFor(w, 'p1');
    expect(view.fuel).toBeUndefined();
    expect(view.emberSecLeft).toBeUndefined();
  });

  it('reveals them once you are standing in the firelight', () => {
    const w = world();
    addPlayer(w, 'p1', FIRE.x + 2, FIRE.y);

    const view = fireViewFor(w, 'p1');
    expect(view.fuel).toBe(w.fire.fuel);
    expect(view.emberSecLeft).toBe(w.fire.emberSecLeft);
  });

  it('withholds them from someone close but behind a wall', () => {
    const w = world();
    fillRect(w.grid, { x: FIRE.x + 2, y: 0, w: 1, h: 40 });
    addPlayer(w, 'p1', FIRE.x + 4, FIRE.y);

    expect(fireViewFor(w, 'p1').fuel).toBeUndefined();
  });
});

describe('removal hysteresis', () => {
  it('holds a vanished player for the window, then drops them', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    const p2 = addPlayer(w, 'p2', 42, 20);
    const index = new VisibilityIndex();

    expect(idsVisibleTo(index, w, 'p1', 1000)).toEqual(['p1', 'p2']);

    p2.pos.x = 70; // gone into the dark

    // Still sent just inside the window — this is what stops the flicker.
    expect(idsVisibleTo(index, w, 'p1', 1000 + VISIBILITY_HYSTERESIS_MS - 1)).toEqual([
      'p1',
      'p2',
    ]);

    // And genuinely gone once it lapses.
    expect(idsVisibleTo(index, w, 'p1', 1000 + VISIBILITY_HYSTERESIS_MS + 1)).toEqual(['p1']);
  });

  it('never reveals someone early — hysteresis only extends, it does not predict', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    addPlayer(w, 'p2', 70, 35);
    const index = new VisibilityIndex();

    // Never seen, so there is nothing to extend, at any point in time.
    expect(idsVisibleTo(index, w, 'p1', 0)).toEqual(['p1']);
    expect(idsVisibleTo(index, w, 'p1', 100)).toEqual(['p1']);
    expect(idsVisibleTo(index, w, 'p1', 10_000)).toEqual(['p1']);
  });

  it('forgets a departed player rather than growing the pair map for the run', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    addPlayer(w, 'p2', 42, 20);
    const index = new VisibilityIndex();

    idsVisibleTo(index, w, 'p1', 0);
    index.forget('p2');
    delete w.players['p2'];

    expect(idsVisibleTo(index, w, 'p1', 10)).toEqual(['p1']);
  });
});
