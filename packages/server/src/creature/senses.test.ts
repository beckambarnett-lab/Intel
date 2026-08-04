import { describe, expect, it } from 'vitest';
import {
  CREATURE_CONTACT_MEMORY_SEC,
  LANTERN_STAGES,
  SOUND_RADIUS_M,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emitSound,
  setTile,
} from '@ember/shared';
import type { LanternStage, WorldState } from '@ember/shared';
import { creatureSense } from './senses.js';

/**
 * A wide empty world with one creature and one player, both well clear of the
 * bonfire so that firelight never confuses a test about lantern range.
 */
function world(): WorldState {
  const w = createWorld(200, 60, createGrid(200, 60));
  // Park the fire out of the way and let it be irrelevant.
  w.fire.pos = { x: 5, y: 5 };
  w.creatures['c1'] = createCreature('c1', { x: 100, y: 30 });
  w.players['p1'] = createPlayer('p1', 'p1', { x: 110, y: 30 });
  return w;
}

const creature = (w: WorldState) => w.creatures['c1']!;
const player = (w: WorldState) => w.players['p1']!;

function setLantern(w: WorldState, stage: LanternStage): void {
  const ls = player(w).lantern;
  ls.stage = stage;
  ls.target = stage;
  ls.transition = 0;
  ls.bloom = 0;
}

/** Put the player this far east of the creature. */
function placeAt(w: WorldState, metres: number): void {
  player(w).pos = { x: creature(w).pos.x + metres, y: creature(w).pos.y };
}

describe('creature senses — light (L12, Q37, Q59)', () => {
  it('spots a full-open lantern out to its detection range', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, LANTERN_STAGES.full.seenAtM - 2);

    creatureSense(w, TICK_DT);

    expect(creature(w).contact?.via).toBe('light');
  });

  it('does not spot the same lantern one step beyond it', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, LANTERN_STAGES.full.seenAtM + 2);

    creatureSense(w, TICK_DT);

    expect(creature(w).contact).toBeNull();
  });

  it('is nearly blind to a hooded lantern — the whole point of the shutter', () => {
    const w = world();
    setLantern(w, 'hooded');

    placeAt(w, LANTERN_STAGES.hooded.seenAtM + 1);
    creatureSense(w, TICK_DT);
    expect(creature(w).contact).toBeNull();

    // It has to be almost on top of you before hooded gives you away.
    placeAt(w, LANTERN_STAGES.hooded.seenAtM - 1);
    creatureSense(w, TICK_DT);
    expect(creature(w).contact?.via).toBe('light');
  });

  it('cannot see a lantern through a trunk (Q44)', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, 20);

    // Drop a solid tile squarely on the line between them.
    setTile(w.grid, 110, 30, 255);

    creatureSense(w, TICK_DT);

    expect(creature(w).contact).toBeNull();
  });

  it('sees nothing when the lantern has run dry', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, 10);
    player(w).lantern.fuel = 0;

    creatureSense(w, TICK_DT);

    expect(creature(w).contact).toBeNull();
  });

  it('sees a player standing in the firelight even with the lantern hooded', () => {
    const w = world();
    setLantern(w, 'hooded');
    // Stand them in the fire's clearing, with the creature a long way off but
    // with a clear line to it.
    w.fire.pos = { x: 100, y: 30 };
    w.fire.lightRadiusM = 14;
    player(w).pos = { x: 104, y: 30 };
    creature(w).pos = { x: 140, y: 30 };

    creatureSense(w, TICK_DT);

    expect(creature(w).contact?.via).toBe('light');
  });
});

describe('creature senses — sound (Q58)', () => {
  it('hears a walking player when there is no light to go on', () => {
    const w = world();
    setLantern(w, 'hooded');
    placeAt(w, 8);

    emitSound(w, {
      pos: { ...player(w).pos },
      loudness: SOUND_RADIUS_M.walk,
      kind: 'footfall',
      sourceId: 'p1',
      fromPlayer: true,
    });

    creatureSense(w, TICK_DT);

    expect(creature(w).contact?.via).toBe('sound');
  });

  it('hears nothing from a player standing still — the counterplay (Q58)', () => {
    const w = world();
    setLantern(w, 'hooded');
    placeAt(w, 8);

    // Standing still emits no sound at all, so there is simply nothing to hear.
    creatureSense(w, TICK_DT);

    expect(creature(w).contact).toBeNull();
  });

  it('does not hear past the soundradius', () => {
    const w = world();
    setLantern(w, 'hooded');
    placeAt(w, SOUND_RADIUS_M.walk + 5);

    emitSound(w, {
      pos: { ...player(w).pos },
      loudness: SOUND_RADIUS_M.walk,
      kind: 'footfall',
      sourceId: 'p1',
      fromPlayer: true,
    });

    creatureSense(w, TICK_DT);

    expect(creature(w).contact).toBeNull();
  });

  it('hears through solid rock — sound needs no line of sight', () => {
    const w = world();
    setLantern(w, 'hooded');
    placeAt(w, 8);
    setTile(w.grid, 104, 30, 255);

    emitSound(w, {
      pos: { ...player(w).pos },
      loudness: SOUND_RADIUS_M.walk,
      kind: 'footfall',
      sourceId: 'p1',
      fromPlayer: true,
    });

    creatureSense(w, TICK_DT);

    expect(creature(w).contact?.via).toBe('sound');
  });

  it('ignores its own kind — creatures do not hunt each other', () => {
    const w = world();
    setLantern(w, 'hooded');

    emitSound(w, {
      pos: { x: creature(w).pos.x + 3, y: creature(w).pos.y },
      loudness: 30,
      kind: 'creature',
      sourceId: 'c2',
      fromPlayer: false,
    });

    creatureSense(w, TICK_DT);

    expect(creature(w).contact).toBeNull();
  });

  it('prefers light over sound when it has both (L12)', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, 10);

    // A loud noise from somewhere else entirely.
    emitSound(w, {
      pos: { x: creature(w).pos.x - 20, y: creature(w).pos.y },
      loudness: SOUND_RADIUS_M.gunshot,
      kind: 'footfall',
      sourceId: 'p1',
      fromPlayer: true,
    });

    creatureSense(w, TICK_DT);

    const contact = creature(w).contact!;
    expect(contact.via).toBe('light');
    // And it went to the light, not the noise.
    expect(contact.pos.x).toBeCloseTo(player(w).pos.x);
  });
});

describe('creature senses — memory', () => {
  it('holds a contact for a while, then lets it go cold', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, 10);

    creatureSense(w, TICK_DT);
    expect(creature(w).contact).not.toBeNull();

    // Go dark. The contact should persist for a time — a creature that forgot
    // you the instant you hooded up would be beaten by a single keypress.
    setLantern(w, 'hooded');
    placeAt(w, 60);

    w.tick += Math.round((CREATURE_CONTACT_MEMORY_SEC / 2) / TICK_DT);
    creatureSense(w, TICK_DT);
    expect(creature(w).contact).not.toBeNull();

    w.tick += Math.round((CREATURE_CONTACT_MEMORY_SEC / 2 + 1) / TICK_DT);
    creatureSense(w, TICK_DT);
    expect(creature(w).contact).toBeNull();
  });

  it('records where it sensed you, not where you now are', () => {
    const w = world();
    setLantern(w, 'full');
    placeAt(w, 10);
    const sensedAt = { ...player(w).pos };

    creatureSense(w, TICK_DT);

    // Move away in the dark. The memory must not follow.
    setLantern(w, 'hooded');
    player(w).pos = { x: 180, y: 55 };
    creatureSense(w, TICK_DT);

    expect(creature(w).contact?.pos.x).toBeCloseTo(sensedAt.x);
    expect(creature(w).contact?.pos.y).toBeCloseTo(sensedAt.y);
  });
});
