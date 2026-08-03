import {
  LANTERN_STAGES,
  VISIBILITY_HYSTERESIS_MS,
  createCreature,
  createPlayer,
  createWorld,
  fillRect,
  killCreature,
  spawnItem,
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

/**
 * Q21 is unusually explicit: dropped wood is "visible to nobody in the dark —
 * including you". A stash you cannot find again is only a real risk if the
 * client is genuinely not told where it is.
 */
describe('items in the dark (Q21)', () => {
  it('does not send an item lying out in the dark', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    spawnItem(w, 'log', { x: 70, y: 35 });

    const index = new VisibilityIndex();
    expect(index.visibleItemsTo(w, 'p1', 0)).toHaveLength(0);
  });

  it('sends one inside your own lantern light', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    const item = spawnItem(w, 'log', { x: 41.5, y: 20 });

    const index = new VisibilityIndex();
    expect(index.visibleItemsTo(w, 'p1', 0).map((i) => i.id)).toEqual([item.id]);
  });

  it('does not send your own dropped wood once you walk away from it', () => {
    const w = world();
    const p1 = addPlayer(w, 'p1', 40, 20);
    spawnItem(w, 'log', { x: 41, y: 20 });

    const index = new VisibilityIndex();
    expect(index.visibleItemsTo(w, 'p1', 0)).toHaveLength(1);

    // You know you left it there. The client is not told, and neither are you.
    p1.pos = { x: 70, y: 35 };
    expect(index.visibleItemsTo(w, 'p1', VISIBILITY_HYSTERESIS_MS + 1)).toHaveLength(0);
  });

  it('does not send one hidden behind an occluder within your light', () => {
    const w = world();
    fillRect(w.grid, { x: 42, y: 18, w: 1, h: 5 });
    addPlayer(w, 'p1', 40, 20);
    spawnItem(w, 'log', { x: 43.5, y: 20 });

    const index = new VisibilityIndex();
    expect(index.visibleItemsTo(w, 'p1', 0)).toHaveLength(0);
  });

  it('sends one lit by the bonfire', () => {
    const w = world();
    const p1 = addPlayer(w, 'p1', 30, 10);
    p1.lantern.stage = 'hooded';
    p1.lantern.target = 'hooded';
    spawnItem(w, 'log', { x: FIRE.x + 2, y: FIRE.y });

    const index = new VisibilityIndex();
    expect(index.visibleItemsTo(w, 'p1', 0)).toHaveLength(1);
  });
});

/**
 * Felling permanently clears an occluder (Q20). The client needs that to keep
 * its grid honest — but learning that a trunk fell across the map would tell
 * you exactly where somebody is standing and chopping.
 */
describe('felled tiles (Q20)', () => {
  function addTree(w: ReturnType<typeof world>, x: number, y: number, felled: boolean): void {
    const id = `t${x},${y}`;
    w.trees[id] = {
      id,
      tx: x,
      ty: y,
      pos: { x: x + 0.5, y: y + 0.5 },
      swingsLeft: felled ? 0 : 6,
      felled,
    };
  }

  it('tells you about a stump you can see', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    addTree(w, 41, 20, true);

    const index = new VisibilityIndex();
    expect(index.visibleFelledTilesTo(w, 'p1')).toEqual([{ x: 41, y: 20 }]);
  });

  it('says nothing about one felled across the map', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    addTree(w, 70, 35, true);

    const index = new VisibilityIndex();
    expect(index.visibleFelledTilesTo(w, 'p1')).toHaveLength(0);
  });

  it('says nothing about trees still standing', () => {
    const w = world();
    addPlayer(w, 'p1', 40, 20);
    addTree(w, 41, 20, false);

    const index = new VisibilityIndex();
    expect(index.visibleFelledTilesTo(w, 'p1')).toHaveLength(0);
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

/**
 * Creature culling — the load-bearing case (Q122).
 *
 * A hunter stalking you from outside your light must not be on the wire at
 * all. This is the anti-cheat rule applied to the entity class it matters most
 * for: a player who can read creature positions out of devtools is not playing
 * a horror game, and no amount of tuning the creatures fixes that.
 */
describe('creature visibility', () => {
  function shutter(p: Player, stage: 'hooded' | 'low' | 'full'): void {
    // Both, always. `lanternRadius` interpolates toward the target, so setting
    // only the stage leaves the light at whatever it was heading for.
    p.lantern.stage = stage;
    p.lantern.target = stage;
  }

  function withCreature(w: WorldState, id: string, x: number, y: number) {
    const c = createCreature(id, { x, y }, 'nearWood');
    w.creatures[id] = c;
    return c;
  }

  it('sends a creature standing in your lantern', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 40, 20);
    shutter(p, 'full');
    withCreature(w, 'c1', 40 + LANTERN_STAGES.full.radiusM / 2, 20);

    const index = new VisibilityIndex();
    expect(index.visibleCreaturesTo(w, 'p1', 0).map((c) => c.id)).toEqual(['c1']);
  });

  it('sends nothing at all about one in the dark', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 40, 20);
    shutter(p, 'hooded');
    withCreature(w, 'c1', 55, 20);

    const index = new VisibilityIndex();
    expect(index.visibleCreaturesTo(w, 'p1', 0)).toEqual([]);
  });

  it('does not send one through a wall', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 40, 20);
    shutter(p, 'full');
    fillRect(w.grid, { x: 43, y: 0, w: 2, h: 40 });
    withCreature(w, 'c1', 47, 20);

    const index = new VisibilityIndex();
    expect(index.visibleCreaturesTo(w, 'p1', 0)).toEqual([]);
  });

  it('sends one lit by the bonfire that you have a line to', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 20, 10);
    shutter(p, 'hooded');
    withCreature(w, 'c1', FIRE.x + FIRE_RADIUS / 2, FIRE.y);

    const index = new VisibilityIndex();
    expect(index.visibleCreaturesTo(w, 'p1', 0).map((c) => c.id)).toEqual(['c1']);
  });

  it('holds it briefly after it leaves your light, then drops it', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 40, 20);
    shutter(p, 'full');
    const c = withCreature(w, 'c1', 44, 20);

    const index = new VisibilityIndex();
    expect(index.visibleCreaturesTo(w, 'p1', 0)).toHaveLength(1);

    // Steps into the dark. Hysteresis keeps it on the wire briefly so it does
    // not strobe at the boundary — it never reveals one early.
    c.pos.x = 70;
    expect(index.visibleCreaturesTo(w, 'p1', VISIBILITY_HYSTERESIS_MS / 2)).toHaveLength(1);
    expect(index.visibleCreaturesTo(w, 'p1', VISIBILITY_HYSTERESIS_MS + 1)).toHaveLength(0);
  });

  it('never sends a dead one', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 40, 20);
    shutter(p, 'full');
    const c = withCreature(w, 'c1', 42, 20);
    killCreature(c);

    const index = new VisibilityIndex();
    expect(index.visibleCreaturesTo(w, 'p1', 0)).toEqual([]);
  });

  it('carries position and posture, and nothing the creature knows', () => {
    const w = world();
    const p = addPlayer(w, 'p1', 40, 20);
    shutter(p, 'full');
    const c = withCreature(w, 'c1', 42, 20);
    c.lastLight = { x: 999, y: 999 };
    c.lastSound = { x: 888, y: 888 };

    const view = new VisibilityIndex().visibleCreaturesTo(w, 'p1', 0)[0];
    expect(Object.keys(view ?? {}).sort()).toEqual(['id', 'pos', 'state']);
  });
});
