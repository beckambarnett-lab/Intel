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
  CREATURE_DARK_SIGHT_M,
  CREATURE_SIEGE_RANGE_M,
  OCCLUDER_OPAQUE,
  TICK_DT,
} from '../constants.js';
import { setTile } from '../grid.js';
import { createPlayer, createWorld } from '../types.js';
import type { Creature, WorldState } from '../types.js';
import {
  createCreature,
  creatureAct,
  creatureSense,
  fireBeaconRangeM,
  killCreature,
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
        creatureAt: { x: 150 + CREATURE_DARK_SIGHT_M + 10, y: 30 },
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
    const { world, player, c } = scene({ creatureAt: { x: 175, y: 30 } });
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    run(world, 0.5);
    expect(c.state).toBe('pursue');

    // Put rock between you and hold absolutely still: no sight, no sound.
    for (let ty = 0; ty < 60; ty++) setTile(world.grid, 165, ty, OCCLUDER_OPAQUE);
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
    const { world, player, c } = scene({ creatureAt: { x: 150 + CREATURE_DARK_SIGHT_M + 20, y: 30 } });
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
    // Well outside its sight, so it is genuinely patrolling rather than
    // quietly pursuing a player it can see perfectly well in the dark.
    const patrolling = scene({ creatureAt: { x: 150 + CREATURE_DARK_SIGHT_M + 20, y: 30 } });
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

/**
 * L12: "they hunt your light." Not you.
 *
 * These are the assertions that keep the shutter a decision. A creature never
 * receives a player's position — it receives a point inside the glow — so a
 * bright lantern buys reach at the cost of precision and a hooded one buys
 * precision at the cost of reach.
 */
describe('creatures hunt the light, not the player (L12)', () => {
  function lightAt(stage: 'hooded' | 'low' | 'full', creatureAt: number) {
    const s = scene({ creatureAt: { x: creatureAt, y: 30 } });
    s.player.lantern.stage = stage;
    s.player.lantern.target = stage;
    return s;
  }

  /** Distance from the creature's guess to where the player actually is. */
  function guessError(s: ReturnType<typeof scene>): number {
    const g = s.c.lastLight;
    if (!g) return Infinity;
    return Math.hypot(g.x - s.player.pos.x, g.y - s.player.pos.y);
  }

  it('never lands exactly on the player at range', () => {
    const s = lightAt('full', 180);
    creatureSense(s.world, TICK_DT);
    expect(s.c.lastLight).not.toBeNull();
    expect(guessError(s)).toBeGreaterThan(0);
  });

  it('is vaguer about a big light than a small one', () => {
    // Sampled across many ticks so this measures the distributions rather than
    // one draw of the PRNG.
    const sample = (stage: 'low' | 'full'): number => {
      let total = 0;
      let n = 0;
      for (let t = 0; t < 400; t++) {
        const s = lightAt(stage, 165);
        s.world.tick = t * 20;
        creatureSense(s.world, TICK_DT);
        if (s.c.lastLight) {
          total += guessError(s);
          n++;
        }
      }
      return n > 0 ? total / n : 0;
    };

    // A 9m lantern should mislead them substantially more than a 4m one.
    expect(sample('full')).toBeGreaterThan(sample('low'));
  });

  it('gets more accurate as it closes', () => {
    const sample = (creatureAt: number): number => {
      let total = 0;
      let n = 0;
      for (let t = 0; t < 400; t++) {
        const s = lightAt('full', creatureAt);
        s.world.tick = t * 20;
        creatureSense(s.world, TICK_DT);
        if (s.c.lastLight) {
          total += guessError(s);
          n++;
        }
      }
      return n > 0 ? total / n : 0;
    };

    // 40m out it is guessing; 3m out it is looking straight at you.
    expect(sample(190)).toBeGreaterThan(sample(153));
  });

  it('is looking right at you at contact range', () => {
    const s = lightAt('full', 150.5);
    creatureSense(s.world, TICK_DT);
    expect(guessError(s)).toBeLessThan(0.5);
  });

  it('cannot pinpoint you inside a big fire’s glow', () => {
    // Hooded lantern at the bonfire: what they have found is the FIRE, so the
    // fire's radius is the vagueness. Camp is safe because it is bright.
    let total = 0;
    let n = 0;
    for (let t = 0; t < 300; t++) {
      const s = scene({ playerAt: { x: 9, y: 5 }, creatureAt: { x: 28, y: 5 } });
      s.player.lantern.stage = 'hooded';
      s.player.lantern.target = 'hooded';
      s.world.fire.fuel = FIRE_CAPACITY;
      refreshFire(s.world.fire);
      s.world.tick = t * 20;
      creatureSense(s.world, TICK_DT);
      if (s.c.lastLight) {
        total += Math.hypot(s.c.lastLight.x - s.player.pos.x, s.c.lastLight.y - s.player.pos.y);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(total / n).toBeGreaterThan(1);
  });

  it('commits to a guess rather than jittering every tick', () => {
    const s = lightAt('full', 180);
    creatureSense(s.world, TICK_DT);
    const first = { ...s.c.lastLight! };

    // A couple of ticks later, inside the same refresh window.
    s.world.tick += 2;
    creatureSense(s.world, TICK_DT);

    expect(s.c.lastLight!.x).toBeCloseTo(first.x, 6);
    expect(s.c.lastLight!.y).toBeCloseTo(first.y, 6);
  });

  it('re-estimates once the window passes', () => {
    const s = lightAt('full', 180);
    creatureSense(s.world, TICK_DT);
    const first = { ...s.c.lastLight! };

    s.world.tick += 40;
    creatureSense(s.world, TICK_DT);

    const moved = Math.hypot(s.c.lastLight!.x - first.x, s.c.lastLight!.y - first.y);
    expect(moved).toBeGreaterThan(0);
  });

  it('still closes on you despite guessing wrong', () => {
    const s = lightAt('full', 175);
    const before = s.c.pos.x;
    run(s.world, 3);
    expect(s.c.pos.x).toBeLessThan(before - 5);
  });

  it('still kills you when it arrives', () => {
    const s = lightAt('full', 154);
    run(s.world, 4);
    expect(s.player.alive).toBe(false);
  });
});


/**
 * The bonfire is a beacon (Q13's horizon bloom, read from the other side).
 *
 * This is the trade the game turns on: a big fire holds the perimeter and makes
 * you impossible to pinpoint inside its glow, and it is also the thing that
 * tells every creature in the wood where you live.
 */
describe('the fire draws them in', () => {
  /** A creature far down the tube with nothing else to react to. */
  function distant(fuel: number) {
    const world = createWorld(1200, 250);
    world.fire.pos = { x: 40, y: 125 };
    world.fire.fuel = fuel;
    world.fire.dead = fuel <= 0;
    refreshFire(world.fire);

    const c = createCreature('c1', { x: 900, y: 125 }, 'deepWood');
    world.creatures['c1'] = c;
    return { world, c };
  }

  it('is seen from far beyond anything they could see a player at', () => {
    const { world } = distant(FIRE_CAPACITY);
    expect(fireBeaconRangeM(world)).toBeGreaterThan(CREATURE_DARK_SIGHT_M * 10);
  });

  it('reaches further the bigger it is', () => {
    const roaring = fireBeaconRangeM(distant(FIRE_CAPACITY).world);
    const guttering = fireBeaconRangeM(distant(FIRE_CAPACITY * 0.05).world);

    expect(roaring).toBeGreaterThan(guttering);
    expect(guttering).toBeGreaterThan(0);
  });

  it('reaches nothing at all once the fire is out', () => {
    expect(fireBeaconRangeM(distant(0).world)).toBe(0);
  });

  it('pulls a creature the length of the tube toward camp', () => {
    const { world, c } = distant(FIRE_CAPACITY);
    const before = c.pos.x;

    run(world, 10);

    expect(c.state).toBe('return');
    expect(c.pos.x).toBeLessThan(before - 50);
  });

  it('lets the far ones lose interest when it burns down', () => {
    const { world, c } = distant(FIRE_CAPACITY);
    run(world, 1);
    expect(c.state).toBe('return');

    // Fire collapses to embers: the glow no longer reaches this far out.
    world.fire.fuel = 0;
    world.fire.dead = true;
    refreshFire(world.fire);
    run(world, 1);

    expect(fireBeaconRangeM(world)).toBe(0);
  });

  it('prowls the perimeter once it arrives rather than standing still', () => {
    const world = createWorld(1200, 250);
    world.fire.pos = { x: 40, y: 125 };
    world.fire.fuel = FIRE_CAPACITY;
    refreshFire(world.fire);

    const c = createCreature('c1', { x: 60, y: 125 }, 'camp');
    world.creatures['c1'] = c;

    run(world, 8);

    // Q7: never inside the safe radius while the fire holds.
    const d = Math.hypot(c.pos.x - world.fire.pos.x, c.pos.y - world.fire.pos.y);
    expect(d).toBeGreaterThanOrEqual(world.fire.safeRadiusM - 1e-6);
    expect(d).toBeLessThan(CREATURE_SIEGE_RANGE_M * 2);
  });
});
