import { describe, expect, it } from 'vitest';
import {
  CREATURE_CONTACT_M,
  CREATURE_LIGHT_MEMORY_SEC,
  CREATURE_PATROL_SPEED_MULT,
  CREATURE_PURSUE_SPEED_MULT,
  CREATURE_RESPAWN_SEC,
  CREATURE_SABOTAGE_SEC,
  CREATURE_SOUND_MEMORY_SEC,
  FIRE_CAPACITY,
  LANTERN_STAGES,
  OCCLUDER_OPAQUE,
  TICK_DT,
} from '../constants.js';
import { setTile } from '../grid.js';
import { createPlayer, createWorld } from '../types.js';
import type { Creature, WorldState } from '../types.js';
import { createCreature, creatureAct, creatureSense, killCreature } from './creatures.js';
import { refreshFire } from './fire.js';
import { emitSounds } from './sound.js';

/**
 * A world with one creature and one player, far from camp so the fire's
 * perimeter and the siege/sabotage branches stay out of the way unless a test
 * actually wants them.
 */
function scene(opts: { playerAt?: { x: number; y: number }; creatureAt?: { x: number; y: number } } = {}) {
  const world = createWorld(300, 60);
  world.fire.pos = { x: 5, y: 5 };
  refreshFire(world.fire);

  const player = createPlayer('p1', 'p1', opts.playerAt ?? { x: 150, y: 30 });
  world.players['p1'] = player;

  const c = createCreature('c1', opts.creatureAt ?? { x: 170, y: 30 }, 'nearWood');
  world.creatures['c1'] = c;

  return { world, player, c };
}

/** Run the creature stages for `seconds`, re-emitting sound each tick. */
function run(world: WorldState, seconds: number): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    emitSounds(world);
    creatureSense(world, TICK_DT);
    creatureAct(world, TICK_DT);
    world.tick++;
  }
}

describe('sensing light (Q37/Q59, L12)', () => {
  it('sees a full lantern from well outside a low one’s range', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150 + 30, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    expect(30).toBeLessThan(LANTERN_STAGES.full.seenAtM);

    creatureSense(world, TICK_DT);
    expect(c.lastLight).not.toBeNull();
  });

  it('does not see a hooded lantern from 30m — the stage is the range', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150 + 30, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';

    creatureSense(world, TICK_DT);
    expect(c.lastLight).toBeNull();
  });

  it('does not see through rock, however bright the lantern', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    for (let ty = 0; ty < 60; ty++) setTile(world.grid, 155, ty, OCCLUDER_OPAQUE);

    creatureSense(world, TICK_DT);
    expect(c.lastLight).toBeNull();
  });

  it('sees a body standing in firelight whatever its shutter is doing', () => {
    const { world, player, c } = scene({
      playerAt: { x: 7, y: 5 },
      creatureAt: { x: 25, y: 5 },
    });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    world.fire.fuel = FIRE_CAPACITY;
    refreshFire(world.fire);

    creatureSense(world, TICK_DT);
    expect(c.lastLight).not.toBeNull();
  });

  it('ignores a dead player', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    player.alive = false;

    creatureSense(world, TICK_DT);
    expect(c.lastLight).toBeNull();
  });
});

describe('sensing sound (L12, Q58)', () => {
  it('is not consulted at all while a light is visible', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    player.vel = { x: 4, y: 0 };

    emitSounds(world);
    creatureSense(world, TICK_DT);

    expect(c.lastLight).not.toBeNull();
    expect(c.lastSound).toBeNull();
  });

  it('takes over the moment the light goes out', () => {
    const { world, player, c } = scene({ creatureAt: { x: 158, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    player.vel = { x: 4, y: 0 };

    emitSounds(world);
    creatureSense(world, TICK_DT);

    expect(c.lastLight).toBeNull();
    expect(c.lastSound).not.toBeNull();
  });

  it('hears nothing at all from a player standing still (Q58)', () => {
    const { world, player, c } = scene({ creatureAt: { x: 152, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    player.vel = { x: 0, y: 0 };

    emitSounds(world);
    creatureSense(world, TICK_DT);

    expect(c.lastSound).toBeNull();
  });

  it('does not hunt its own sniffs and growls', () => {
    const { world, c } = scene();
    world.sounds.push({ pos: { x: c.pos.x, y: c.pos.y }, loudnessM: 20, kind: 'growl', tick: 0 });
    world.sounds.push({ pos: { x: c.pos.x, y: c.pos.y }, loudnessM: 12, kind: 'sniff', tick: 0 });

    creatureSense(world, TICK_DT);
    expect(c.lastSound).toBeNull();
  });
});

describe('the priority switch (Q60)', () => {
  it('pursues a light it can currently see', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';

    run(world, TICK_DT);
    expect(c.state).toBe('pursue');
  });

  it('closes the distance while pursuing', () => {
    const { world, player, c } = scene({ creatureAt: { x: 170, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';

    const before = c.pos.x;
    run(world, 1);
    expect(c.pos.x).toBeLessThan(before);
  });

  it('drops to investigate when the light goes out, then gives up (L12)', () => {
    const { world, player, c } = scene({ creatureAt: { x: 175, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    run(world, 0.5);
    expect(c.state).toBe('pursue');

    // Hood the lantern and hold absolutely still: no light, no sound.
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    player.vel = { x: 0, y: 0 };

    run(world, 1);
    expect(c.state).toBe('investigate');

    // Long enough for both the light memory and the search to lapse.
    run(world, CREATURE_LIGHT_MEMORY_SEC + 12);
    expect(['patrol', 'return']).toContain(c.state);
    expect(c.lastLight).toBeNull();
  });

  it('hunts a sound when there is no light to chase', () => {
    const { world, player, c } = scene({ creatureAt: { x: 158, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    player.vel = { x: 4, y: 0 };

    run(world, TICK_DT * 2);
    expect(c.state).toBe('hunt');
  });

  it('forgets a sound it has walked to and found nothing at', () => {
    const { world, player, c } = scene({ creatureAt: { x: 158, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    player.vel = { x: 4, y: 0 };
    run(world, TICK_DT * 2);
    expect(c.state).toBe('hunt');

    player.vel = { x: 0, y: 0 };
    run(world, CREATURE_SOUND_MEMORY_SEC + 12);
    expect(c.lastSound).toBeNull();
    expect(['patrol', 'return', 'investigate']).toContain(c.state);
  });

  it('patrols when it knows nothing', () => {
    const { world, player, c } = scene();
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    run(world, 1);
    expect(c.state).toBe('patrol');
  });

  it('turns desperate when wounded, outranking everything (Q70)', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    c.hits = 99;

    run(world, TICK_DT);
    expect(c.state).toBe('desperate');
  });
});

describe('speeds (Q61)', () => {
  it('pursues faster than it patrols', () => {
    const patrolling = scene({ creatureAt: { x: 160, y: 30 } });
    patrolling.player.lantern.stage = 'hooded';
    patrolling.player.lantern.target = 'hooded';
    run(patrolling.world, 2);
    const patrolSpeed = Math.hypot(patrolling.c.vel.x, patrolling.c.vel.y);

    const pursuing = scene({ creatureAt: { x: 175, y: 30 } });
    pursuing.player.lantern.stage = 'full';
    pursuing.player.lantern.target = 'full';
    run(pursuing.world, 0.5);
    const pursueSpeed = Math.hypot(pursuing.c.vel.x, pursuing.c.vel.y);

    expect(pursueSpeed).toBeGreaterThan(patrolSpeed);
    expect(pursueSpeed / patrolSpeed).toBeCloseTo(
      CREATURE_PURSUE_SPEED_MULT / CREATURE_PATROL_SPEED_MULT,
      2,
    );
  });
});

describe('the camp perimeter (Q7)', () => {
  it('cannot cross the safe radius while the fire holds', () => {
    const { world, player, c } = scene({
      playerAt: { x: 5, y: 5 },
      creatureAt: { x: 25, y: 5 },
    });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    world.fire.fuel = FIRE_CAPACITY;
    refreshFire(world.fire);

    run(world, 20);

    const d = Math.hypot(c.pos.x - world.fire.pos.x, c.pos.y - world.fire.pos.y);
    expect(d).toBeGreaterThanOrEqual(world.fire.safeRadiusM - 1e-6);
  });

  it('walks straight in once the fire has failed', () => {
    const { world, player, c } = scene({
      playerAt: { x: 5, y: 5 },
      creatureAt: { x: 25, y: 5 },
    });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    world.fire.fuel = 0;
    refreshFire(world.fire);

    const before = Math.hypot(c.pos.x - world.fire.pos.x, c.pos.y - world.fire.pos.y);
    run(world, 6);
    const after = Math.hypot(c.pos.x - world.fire.pos.x, c.pos.y - world.fire.pos.y);

    expect(after).toBeLessThan(before);
  });
});

describe('contact (Q62)', () => {
  it('kills a player it reaches', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150 + CREATURE_CONTACT_M / 2, y: 30 } });

    run(world, TICK_DT);
    expect(player.alive).toBe(false);
  });

  it('leaves a player just out of reach alone', () => {
    const { world, player } = scene({ creatureAt: { x: 150 + CREATURE_CONTACT_M * 3, y: 30 } });
    // Hooded and still, so nothing draws it closer during the tick.
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';

    creatureSense(world, TICK_DT);
    creatureAct(world, TICK_DT);
    expect(player.alive).toBe(true);
  });

  it('stops a dead player mid-chop rather than leaving them swinging', () => {
    const { world, player } = scene({ creatureAt: { x: 150, y: 30 } });
    player.chop = { treeId: 't1', swingProgress: 0.3, swings: 2 };

    run(world, TICK_DT);
    expect(player.alive).toBe(false);
    expect(player.chop).toBeNull();
  });
});

describe('sabotage (Q24)', () => {
  it('scatters the woodpile into the dark rather than destroying the wood', () => {
    const world = createWorld(120, 60);
    world.fire.pos = { x: 20, y: 30 };
    world.fire.fuel = FIRE_CAPACITY;
    refreshFire(world.fire);
    world.woodpile.pos = { x: 30, y: 30 };
    world.woodpile.contents.log = 6;

    // A creature standing on the pile, with nobody around to distract it.
    world.creatures['c1'] = createCreature('c1', { x: 30, y: 30 }, 'camp');

    const before = world.woodpile.contents.log;
    run(world, CREATURE_SABOTAGE_SEC + 0.5);

    expect(world.woodpile.contents.log).toBeLessThan(before);
    // The wood still exists — it is out there, and going to get it is the cost.
    const onGround = Object.values(world.items).filter((i) => i.kind === 'log').length;
    expect(onGround).toBe(before - world.woodpile.contents.log);
  });

  it('throws the wood clear of the safe radius', () => {
    const world = createWorld(120, 60);
    world.fire.pos = { x: 30, y: 30 };
    world.fire.fuel = FIRE_CAPACITY;
    refreshFire(world.fire);
    world.woodpile.pos = { x: 30, y: 30 };
    world.woodpile.contents.log = 4;
    world.creatures['c1'] = createCreature('c1', { x: 30, y: 30 }, 'camp');

    run(world, CREATURE_SABOTAGE_SEC + 0.5);

    for (const item of Object.values(world.items)) {
      const d = Math.hypot(item.pos.x - world.fire.pos.x, item.pos.y - world.fire.pos.y);
      expect(d).toBeGreaterThanOrEqual(world.fire.safeRadiusM - 1e-6);
    }
  });
});

describe('death and return (Q57, Q65)', () => {
  it('comes back from the lair after five minutes, never sooner', () => {
    const { world, c } = scene();
    killCreature(c);
    expect(c.alive).toBe(false);

    run(world, CREATURE_RESPAWN_SEC - 5);
    expect(c.alive).toBe(false);

    run(world, 6);
    expect(c.alive).toBe(true);
    // Q57: it returns from the lair, not from where it fell.
    expect(c.pos.x).toBeGreaterThan(1000);
  });

  it('comes back unwounded', () => {
    const { world, c } = scene();
    c.hits = 4;
    killCreature(c);
    run(world, CREATURE_RESPAWN_SEC + 1);
    expect(c.hits).toBe(0);
  });

  it('does nothing at all while dead', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150, y: 30 } });
    killCreature(c);

    run(world, 1);
    expect(player.alive).toBe(true);
  });
});

describe('determinism', () => {
  it('produces identical wander from identical state', () => {
    const a = scene();
    const b = scene();
    a.player.lantern.stage = 'hooded';
    a.player.lantern.target = 'hooded';
    b.player.lantern.stage = 'hooded';
    b.player.lantern.target = 'hooded';

    run(a.world, 20);
    run(b.world, 20);

    expect(a.c.pos.x).toBe(b.c.pos.x);
    expect(a.c.pos.y).toBe(b.c.pos.y);
  });

  it('never calls Math.random', () => {
    const original = Math.random;
    let called = false;
    Math.random = () => {
      called = true;
      return original();
    };

    try {
      const { world, player } = scene();
      player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
      run(world, 30);
    } finally {
      Math.random = original;
    }

    expect(called).toBe(false);
  });
});

describe('creatures never reach for a player directly', () => {
  it('keeps no reference to one on the blackboard', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    run(world, 0.5);

    // Its knowledge is a remembered POSITION, not a handle. This is what makes
    // hooding work: there is nothing to keep following.
    const keys = Object.keys(c) as (keyof Creature)[];
    for (const k of keys) {
      expect(c[k]).not.toBe(player);
      expect(c[k]).not.toBe(player.pos);
    }
  });
});
