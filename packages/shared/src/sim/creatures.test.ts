import { describe, expect, it } from 'vitest';
import {
  CREATURE_CONTACT_M,
  CREATURE_LIGHT_MEMORY_SEC,
  CREATURE_PATROL_SPEED_MULT,
  CREATURE_PURSUE_SPEED_MULT,
  CREATURE_RESPAWN_SEC,
  CREATURE_SABOTAGE_SEC,
  CREATURE_SOUND_MEMORY_SEC,
  FIRE_NOMINAL_FUEL,
  CREATURE_CURIOSITY_M,
  CREATURE_LAUNCH_MIN_RANGE_M,
  CREATURE_LAUNCH_SPEED_MULT,
  CREATURE_LAUNCH_WIND_SEC,
  CREATURE_STAMINA_FREE_SPEED_MULT,
  CREATURE_STAMINA_LAUNCH_COST,
  CREATURE_TURN_RATE_MAX_DPS,
  CREATURE_TURN_RATE_MIN_DPS,
  INTERP_DELAY_MS,
  LANTERN_STAGES,
  PLAYER_SPRINT_MULT,
  PLAYER_WALK_SPEED,
  CREATURE_DARK_SIGHT_M,
  CREATURE_SIEGE_RANGE_M,
  OCCLUDER_OPAQUE,
  TICK_DT,
} from '../constants.js';
import { setTile } from '../grid.js';
import { createLantern, createPlayer, createWorld } from '../types.js';
import type { Creature, WorldState } from '../types.js';
import {
  campPresenceRangeM,
  createCreature,
  creatureAct,
  creatureSense,
  fireBeaconRangeM,
  killCreature,
  turnRateAt,
} from './creatures.js';
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

describe('sight is flat and darkness does not hide you', () => {
  it('sees you at 30m with a full lantern', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150 + 30, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';

    creatureSense(world, TICK_DT);
    expect(c.lastLight).not.toBeNull();
  });

  it('sees you at 30m hooded too — they see in the dark', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150 + 30, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';

    creatureSense(world, TICK_DT);
    expect(c.lastLight).not.toBeNull();
  });

  it('loses you past its sight range whatever your lantern is doing', () => {
    for (const stage of ['hooded', 'full'] as const) {
      const { world, player, c } = scene({
        creatureAt: { x: 150 + CREATURE_CURIOSITY_M + 10, y: 30 },
      });
      player.lantern.stage = stage;
      player.lantern.target = stage;

      creatureSense(world, TICK_DT);
      expect(c.lastLight).toBeNull();
    }
  });

  it('is stopped by rock — cover is the stealth tool, not darkness', () => {
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
    world.fire.fuel = FIRE_NOMINAL_FUEL;
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

describe('sensing sound (Q58)', () => {
  /** A wall between the two, so sight is off the table and hearing is not. */
  function behindCover(creatureAt: number) {
    const s = scene({ creatureAt: { x: creatureAt, y: 30 } });
    for (let ty = 0; ty < 60; ty++) setTile(s.world.grid, 155, ty, OCCLUDER_OPAQUE);
    return s;
  }

  it('is not consulted at all while it can see you', () => {
    const { world, player, c } = scene({ creatureAt: { x: 160, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    player.vel = { x: 4, y: 0 };

    emitSounds(world);
    creatureSense(world, TICK_DT);

    expect(c.lastLight).not.toBeNull();
    expect(c.lastSound).toBeNull();
  });

  it('takes over the moment cover breaks the line', () => {
    const { world, player, c } = behindCover(158);
    player.vel = { x: 4, y: 0 };

    emitSounds(world);
    creatureSense(world, TICK_DT);

    expect(c.lastLight).toBeNull();
    expect(c.lastSound).not.toBeNull();
  });

  it('hears nothing at all from a player standing still behind cover (Q58)', () => {
    const { world, player, c } = behindCover(158);
    player.vel = { x: 0, y: 0 };

    emitSounds(world);
    creatureSense(world, TICK_DT);

    expect(c.lastLight).toBeNull();
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

  it('drops to investigate when you break the line, then gives up', () => {
    // Beyond CREATURE_LAUNCH_MAX_RANGE_M, so it stalks rather than rearing up.
    const { world, player, c } = scene({ creatureAt: { x: 190, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    run(world, 0.5);
    expect(c.state).toBe('pursue');

    // Put rock between you and hold absolutely still: no sight, no sound.
    for (let ty = 0; ty < 60; ty++) setTile(world.grid, 180, ty, OCCLUDER_OPAQUE);
    player.vel = { x: 0, y: 0 };

    run(world, 1);
    expect(c.state).toBe('investigate');

    run(world, CREATURE_LIGHT_MEMORY_SEC + 12);
    expect(['patrol', 'return']).toContain(c.state);
    expect(c.lastLight).toBeNull();
  });

  it('hunts a sound when cover has taken its sight away', () => {
    const { world, player, c } = scene({ creatureAt: { x: 158, y: 30 } });
    for (let ty = 0; ty < 60; ty++) setTile(world.grid, 155, ty, OCCLUDER_OPAQUE);
    player.vel = { x: 4, y: 0 };

    run(world, TICK_DT * 2);
    expect(c.state).toBe('hunt');
  });

  it('forgets a sound it has walked to and found nothing at', () => {
    const { world, player, c } = scene({ creatureAt: { x: 158, y: 30 } });
    for (let ty = 0; ty < 60; ty++) setTile(world.grid, 155, ty, OCCLUDER_OPAQUE);
    player.vel = { x: 4, y: 0 };
    run(world, TICK_DT * 2);
    expect(c.state).toBe('hunt');

    player.vel = { x: 0, y: 0 };
    run(world, CREATURE_SOUND_MEMORY_SEC + 12);
    expect(c.lastSound).toBeNull();
    expect(['patrol', 'return', 'investigate']).toContain(c.state);
  });

  it('patrols when it knows nothing and there is no fire to draw it', () => {
    const { world, player, c } = scene({ creatureAt: { x: 150 + CREATURE_CURIOSITY_M + 20, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    // A dead fire throws no beacon, so nothing outranks the standing order.
    world.fire.fuel = 0;
    world.fire.dead = true;
    refreshFire(world.fire);
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
    // Well outside even its curiosity, so it is genuinely patrolling rather
    // than quietly drifting at a player it noticed.
    const patrolling = scene({ creatureAt: { x: 150 + CREATURE_CURIOSITY_M + 20, y: 30 } });
    patrolling.player.lantern.stage = 'hooded';
    patrolling.player.lantern.target = 'hooded';
    patrolling.world.fire.fuel = 0;
    patrolling.world.fire.dead = true;
    refreshFire(patrolling.world.fire);
    // Long enough to reach terminal speed — creatures accelerate now.
    run(patrolling.world, 3);
    const patrolSpeed = Math.hypot(patrolling.c.vel.x, patrolling.c.vel.y);

    // Far enough out that three seconds of closing still leaves it beyond
    // launch range, so it is genuinely pursuing rather than rearing to charge.
    const pursuing = scene({ creatureAt: { x: 205, y: 30 } });
    pursuing.player.lantern.stage = 'full';
    pursuing.player.lantern.target = 'full';
    run(pursuing.world, 3);
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
    world.fire.fuel = FIRE_NOMINAL_FUEL;
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

  /**
   * A perimeter wider than the flat siege gate (DECISIONS §6).
   *
   * With the fuel cap gone the safe radius can be pushed past
   * CREATURE_SIEGE_RANGE_M — 25000 fuel, about 1000 logs, puts it at ~41m. The
   * flat gate would then sit inside the ring the creature is excluded from, so
   * it could never be close enough to decide to prowl or to go for the woodpile:
   * it would walk at camp forever and be shoved back out every tick, on a state
   * that never leaves `return`. campPresenceRangeM is what keeps the gate
   * outside the perimeter it describes.
   */
  it('still recognises camp when the perimeter is wider than the siege gate', () => {
    const { world, c } = scene({
      // Nobody to chase — this is about the standing order, not a hunt.
      playerAt: { x: 280, y: 30 },
      creatureAt: { x: 60, y: 5 },
    });
    world.woodpile.pos = { x: 8, y: 5 };
    world.woodpile.contents.log = 5;
    world.fire.fuel = 25000;
    refreshFire(world.fire);

    expect(world.fire.safeRadiusM).toBeGreaterThan(CREATURE_SIEGE_RANGE_M);
    expect(campPresenceRangeM(world)).toBeGreaterThan(world.fire.safeRadiusM);

    run(world, 30);

    // It arrived, and it knows it arrived.
    expect(c.state).not.toBe('return');
    const d = Math.hypot(c.pos.x - world.fire.pos.x, c.pos.y - world.fire.pos.y);
    expect(d).toBeGreaterThanOrEqual(world.fire.safeRadiusM - 1e-6);
    expect(d).toBeLessThan(campPresenceRangeM(world));
  });

  /** …and none of that changes anything at a fire of ordinary size. */
  it('leaves the gate at the flat siege range for any normal fire', () => {
    const { world } = scene();

    for (const fuel of [0, 45, 120, FIRE_NOMINAL_FUEL, 2000]) {
      world.fire.fuel = fuel;
      refreshFire(world.fire);
      expect(campPresenceRangeM(world)).toBe(CREATURE_SIEGE_RANGE_M);
    }
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
    world.fire.fuel = FIRE_NOMINAL_FUEL;
    refreshFire(world.fire);
    world.woodpile.pos = { x: 30, y: 30 };
    world.woodpile.contents.log = 6;

    // A creature standing on the pile, with nobody around to distract it.
    world.creatures['c1'] = createCreature('c1', { x: 30, y: 30 }, 'camp');

    const before = world.woodpile.contents.log;
    run(world, CREATURE_SABOTAGE_SEC + 3);

    expect(world.woodpile.contents.log).toBeLessThan(before);
    // The wood still exists — it is out there, and going to get it is the cost.
    const onGround = Object.values(world.items).filter((i) => i.kind === 'log').length;
    expect(onGround).toBe(before - world.woodpile.contents.log);
  });

  it('throws the wood clear of the safe radius', () => {
    const world = createWorld(120, 60);
    world.fire.pos = { x: 30, y: 30 };
    world.fire.fuel = FIRE_NOMINAL_FUEL;
    refreshFire(world.fire);
    world.woodpile.pos = { x: 30, y: 30 };
    world.woodpile.contents.log = 4;
    world.creatures['c1'] = createCreature('c1', { x: 30, y: 30 }, 'camp');

    run(world, CREATURE_SABOTAGE_SEC + 3);

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

/**
 * It aims at the centre of the brightest thing it can see — never at you.
 *
 * One rule, and the whole counterplay falls out of it: hold a lantern and you
 * ARE the centre; stand in firelight and the bonfire is; put the lantern down
 * and the lantern is.
 */
describe('creatures aim at the light, not the player', () => {
  it('comes straight at you when the lantern is in your hand', () => {
    const { world, player, c } = scene({ creatureAt: { x: 180, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';

    creatureSense(world, TICK_DT);
    expect(c.lastLight?.x).toBeCloseTo(player.pos.x, 5);
    expect(c.lastLight?.y).toBeCloseTo(player.pos.y, 5);
  });

  it('aims at the bonfire, not at you, while you stand in its light', () => {
    // Camp is safe because it is bright: it charges the FIRE and you are off to
    // one side of it. The bigger the fire, the further off to one side you can
    // stand and still be in the glow.
    const { world, player, c } = scene({
      playerAt: { x: 11, y: 5 },
      creatureAt: { x: 40, y: 5 },
    });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';
    world.fire.fuel = FIRE_NOMINAL_FUEL;
    refreshFire(world.fire);

    creatureSense(world, TICK_DT);
    expect(c.lastLight?.x).toBeCloseTo(world.fire.pos.x, 5);
    expect(c.lastLight?.y).toBeCloseTo(world.fire.pos.y, 5);
    // And that is not where you are standing.
    expect(Math.abs((c.lastLight?.x ?? 0) - player.pos.x)).toBeGreaterThan(3);
  });

  it('commits to a lantern you put down rather than to you (Q41)', () => {
    const { world, player, c } = scene({ creatureAt: { x: 180, y: 30 } });
    player.lantern.stage = 'hooded';
    player.lantern.target = 'hooded';

    // A lit lantern on the ground outshines a player standing in the dark.
    world.droppedLanterns['dl1'] = {
      id: 'dl1',
      pos: { x: 160, y: 45 },
      lantern: { ...createLantern(), stage: 'full', target: 'full' },
    };

    creatureSense(world, TICK_DT);
    expect(c.lastLight?.x).toBeCloseTo(160, 5);
    expect(c.lastLight?.y).toBeCloseTo(45, 5);
  });

  it('has nothing to fix on but you when you carry no light', () => {
    const { world, player, c } = scene({ creatureAt: { x: 180, y: 30 } });
    player.lantern.fuel = 0;

    creatureSense(world, TICK_DT);
    expect(c.lastLight?.x).toBeCloseTo(player.pos.x, 5);
  });

  it('is deterministic — no guessing, so no coin flips', () => {
    const a = scene({ creatureAt: { x: 180, y: 30 } });
    const b = scene({ creatureAt: { x: 180, y: 30 } });
    a.world.tick = 17;
    b.world.tick = 4021;

    creatureSense(a.world, TICK_DT);
    creatureSense(b.world, TICK_DT);
    expect(a.c.lastLight?.x).toBe(b.c.lastLight?.x);
    expect(a.c.lastLight?.y).toBe(b.c.lastLight?.y);
  });
});

/**
 * The middle ground between "no idea you exist" and "sprinting at your face".
 *
 * Without it the sense model was a switch, and a switch is not a hunt. Out in
 * the curiosity band a creature knows something is over there and drifts to
 * look; only inside its sight range does that become a chase.
 */
describe('curiosity (the band between noticing and knowing)', () => {
  function atRange(metres: number, stage: 'hooded' | 'full' = 'full') {
    const s = scene({ creatureAt: { x: 150 + metres, y: 30 } });
    s.player.lantern.stage = stage;
    s.player.lantern.target = stage;
    return s;
  }

  it('notices you well beyond the range it can see you at', () => {
    const s = atRange((CREATURE_DARK_SIGHT_M + CREATURE_CURIOSITY_M) / 2);
    creatureSense(s.world, TICK_DT);
    expect(s.c.lastLight).not.toBeNull();
    expect(s.c.certain).toBe(false);
  });

  it('investigates rather than charging while it is only curious', () => {
    const s = atRange((CREATURE_DARK_SIGHT_M + CREATURE_CURIOSITY_M) / 2);
    run(s.world, TICK_DT);
    expect(s.c.state).toBe('investigate');
  });

  it('commits to a chase once you are inside its sight', () => {
    const s = atRange(CREATURE_DARK_SIGHT_M / 2);
    run(s.world, TICK_DT);
    expect(s.c.certain).toBe(true);
    expect(s.c.state).toBe('pursue');
  });

  it('knows nothing at all past the curiosity band', () => {
    const s = atRange(CREATURE_CURIOSITY_M + 20);
    creatureSense(s.world, TICK_DT);
    expect(s.c.lastLight).toBeNull();
  });

  it('drifts at walking pace, not pursuit pace', () => {
    // Both run to terminal speed: creatures accelerate now, so sampling at
    // different moments would measure the ramp rather than the intent.
    const curious = atRange(90);
    run(curious.world, 3);
    const drift = Math.hypot(curious.c.vel.x, curious.c.vel.y);

    // Far enough that it is still stalking at the sample, not rearing up.
    const chasing = atRange(55);
    run(chasing.world, 3);
    const charge = Math.hypot(chasing.c.vel.x, chasing.c.vel.y);

    expect(drift).toBeLessThan(charge);
  });

  it('closes the distance while curious, and escalates when it arrives', () => {
    const s = atRange(100);
    expect(s.c.state).toBe('patrol');

    run(s.world, 1);
    expect(s.c.state).toBe('investigate');
    expect(s.c.certain).toBe(false);

    // Long enough to drift the ~40m into its real sight range, and no longer —
    // give it another few seconds and it has closed the rest and killed you,
    // which is a different assertion.
    run(s.world, 5);
    expect(s.c.certain).toBe(true);
    expect(s.c.state).toBe('pursue');
    expect(s.player.alive).toBe(true);
  });
});

/**
 * Momentum, stamina and the launch.
 *
 * Movement used to be a tractor beam — velocity set straight at the target
 * every tick, so the seconds before contact held no decisions. These are the
 * assertions that keep the dodge real.
 */
describe('the launch', () => {
  /** A creature and a player in the open, with no fire to complicate matters. */
  function duel(stage: 'hooded' | 'low' | 'full', gapM: number) {
    const world = createWorld(400, 200);
    world.fire.pos = { x: 5, y: 5 };
    world.fire.fuel = 0;
    world.fire.dead = true;
    refreshFire(world.fire);

    const player = createPlayer('p1', 'p1', { x: 200, y: 100 });
    world.players['p1'] = player;
    player.lantern.stage = stage;
    player.lantern.target = stage;

    const c = createCreature('c1', { x: 200 + gapM, y: 100 }, 'nearWood');
    world.creatures['c1'] = c;
    return { world, player, c };
  }

  it('telegraphs for long enough to survive latency and still be reactable', () => {
    // Fixed, not scaled by light. The warning a bright lantern buys you is that
    // you see it stalking in from nine metres instead of noticing it at one —
    // it is not shyer, you are less blind.
    expect(CREATURE_LAUNCH_WIND_SEC).toBeGreaterThan(INTERP_DELAY_MS / 1000 * 2);
    expect(CREATURE_LAUNCH_WIND_SEC).toBeLessThan(1);
  });

  it('never commits from inside a full lantern’s pool', () => {
    // The load-bearing constraint. perceive() is exact once a creature is
    // inside your glow, so a charge starting there would be pinpoint however
    // bright you were and light would stop mattering exactly when it counts.
    expect(CREATURE_LAUNCH_MIN_RANGE_M).toBeGreaterThan(LANTERN_STAGES.full.radiusM);
  });

  it('rears before it charges, and roars doing it', () => {
    const { world, c } = duel('hooded', 20);
    // One tick: the roar fires as the wind-up begins, and sounds live for
    // exactly one tick, so a longer run would clear it.
    run(world, TICK_DT);

    expect(c.state).toBe('wind');
    expect(world.sounds.some((s) => s.kind === 'roar')).toBe(true);
  });

  it('brakes to aim, then goes far faster than any player', () => {
    const { world, c } = duel('hooded', 20);
    run(world, 0.5);
    expect(c.state).toBe('launch');

    // Sampled mid-charge: it decelerates once the charge times out, and it may
    // reach the player before that.
    run(world, 0.4);
    expect(c.speed).toBeGreaterThan(PLAYER_WALK_SPEED * PLAYER_SPRINT_MULT);
  });

  it('cannot turn to follow a sidestep once committed', () => {
    const { world, player, c } = duel('hooded', 20);
    run(world, 0.5);
    expect(c.state).toBe('launch');

    const headingAtCommit = c.heading;
    // Player bolts perpendicular for the length of the charge.
    for (let i = 0; i < Math.round(1 / TICK_DT); i++) {
      player.pos.y += PLAYER_WALK_SPEED * TICK_DT;
      emitSounds(world);
      creatureSense(world, TICK_DT);
      creatureAct(world, TICK_DT);
      world.tick++;
    }

    // Barely deflected — a committed charge is a straight line.
    const turned = Math.abs(c.heading - headingAtCommit);
    expect(turned).toBeLessThan(0.15);
  });

  it('turns freely when slow and hardly at all when fast', () => {
    expect(turnRateAt(0)).toBeCloseTo(CREATURE_TURN_RATE_MAX_DPS, 5);
    expect(turnRateAt(PLAYER_WALK_SPEED * CREATURE_LAUNCH_SPEED_MULT)).toBeCloseTo(
      CREATURE_TURN_RATE_MIN_DPS,
      5,
    );
    expect(turnRateAt(PLAYER_WALK_SPEED)).toBeLessThan(CREATURE_TURN_RATE_MAX_DPS);
  });

  it('a dodge on the commit is the difference between living and dying', () => {
    const still = duel('hooded', 20);
    run(still.world, 5);
    expect(still.player.alive).toBe(false);

    const dodging = duel('hooded', 20);
    let dodged = false;
    for (let i = 0; i < Math.round(5 / TICK_DT); i++) {
      if (dodging.c.state === 'launch') dodged = true;
      if (dodged) dodging.player.pos.y += PLAYER_WALK_SPEED * TICK_DT;
      emitSounds(dodging.world);
      creatureSense(dodging.world, TICK_DT);
      creatureAct(dodging.world, TICK_DT);
      dodging.world.tick++;
    }
    expect(dodging.player.alive).toBe(true);
  });

  it('charges the lantern you set down and misses you entirely (Q41)', () => {
    const { world, player, c } = duel('hooded', 20);
    // Put a lit lantern well off to one side and stand away from it.
    world.droppedLanterns['dl1'] = {
      id: 'dl1',
      pos: { x: 200, y: 130 },
      lantern: { ...createLantern(), stage: 'full', target: 'full' },
    };

    run(world, 4);
    expect(player.alive).toBe(true);
    void c;
  });

  it('spends stamina to charge and cannot chain them', () => {
    const { world, c } = duel('hooded', 20);
    const before = c.staminaSec;
    run(world, 0.5);

    expect(c.staminaSec).toBeLessThan(before - CREATURE_STAMINA_LAUNCH_COST + 0.5);
    expect(c.launchCooldownSec).toBeGreaterThan(0);
  });

  it('drops to a trudge once it is spent', () => {
    const { world, c } = duel('hooded', 20);
    c.staminaSec = 0;
    run(world, 3);

    // Exhausted, it cannot keep running you down — that trudge is your distance
    // back, and without it stamina would gate nothing you could see.
    expect(c.speed).toBeLessThanOrEqual(
      PLAYER_WALK_SPEED * CREATURE_STAMINA_FREE_SPEED_MULT + 1e-6,
    );
  });

  it('recovers when it eases off', () => {
    const { world, c } = duel('hooded', 20);
    c.staminaSec = 0;
    c.lastLight = null;
    c.lightMemorySec = 0;
    c.certain = false;
    c.speed = 0;
    run(world, 4);

    expect(c.staminaSec).toBeGreaterThan(0);
  });

  it('is still deterministic', () => {
    const a = duel('full', 20);
    const b = duel('full', 20);
    run(a.world, 6);
    run(b.world, 6);

    expect(a.c.pos.x).toBe(b.c.pos.x);
    expect(a.c.pos.y).toBe(b.c.pos.y);
    expect(a.c.speed).toBe(b.c.speed);
  });
});
