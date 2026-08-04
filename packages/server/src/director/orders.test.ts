import { describe, expect, it } from 'vitest';
import {
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
  step,
} from '@ember/shared';
import type { InputFrame, LanternStage, WorldState } from '@ember/shared';
import { CreatureMind } from '../creature/mind.js';
import { orderSetSchema } from './schema.js';
import type { CreatureOrder } from './orders.js';

let mind: CreatureMind;

function world(): WorldState {
  // No tactician: these test the order *machinery*, not the model.
  mind = new CreatureMind(11);
  const w = createWorld(240, 80, createGrid(240, 80));
  w.fire.pos = { x: 5, y: 5 };
  w.creatures['c1'] = createCreature('c1', { x: 100, y: 40 });
  w.players['p1'] = createPlayer('p1', 'p1', { x: 200, y: 40 });
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
  ls.fuel = 999;
}

const still = (seq: number): InputFrame => emptyInput(seq);
const walkWest = (seq: number): InputFrame => ({ ...emptyInput(seq), moveX: -1 });

function run(w: WorldState, seconds: number, frame: (seq: number) => InputFrame = still): void {
  const hooks = mind.hooks();
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    step(w, { p1: frame(i + 1) }, TICK_DT, hooks);
  }
}

/** Install an order the way the tactician would, without calling a model. */
function give(w: WorldState, order: CreatureOrder): void {
  run(w, TICK_DT); // let the mind exist
  const m = mind.peek(order.creatureId)!;
  m.standing = { order, issuedTick: w.tick, sprung: false, called: false };
}

describe('order schema — validate, never coerce (Step 10.4)', () => {
  it('accepts a well-formed order set', () => {
    const result = orderSetSchema.safeParse({
      intent: 'hold the western approach',
      orders: [
        {
          creatureId: 'c1',
          goto: { x: 120, y: 40 },
          stance: 'hold',
          trigger: { kind: 'beliefWithin', m: 8 },
          onTrigger: 'charge',
          ttlTicks: 600,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown stance rather than guessing at one', () => {
    const result = orderSetSchema.safeParse({
      orders: [{ creatureId: 'c1', stance: 'ambush', ttlTicks: 100 }],
    });
    // A coerced order is a silent behaviour change that looks like a tuning
    // problem. A rejected one falls through to instinct, which is already good.
    expect(result.success).toBe(false);
  });

  it('rejects an unbounded ttl', () => {
    const result = orderSetSchema.safeParse({
      orders: [{ creatureId: 'c1', stance: 'hold', ttlTicks: 999_999 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed trigger', () => {
    const result = orderSetSchema.safeParse({
      orders: [
        { creatureId: 'c1', stance: 'hold', trigger: { kind: 'vibes' }, ttlTicks: 100 },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('standing orders', () => {
  it('a hold order keeps a creature still even when it can see you', () => {
    const w = world();
    setLantern(w, 'full');
    player(w).pos = { x: 120, y: 40 };

    give(w, { creatureId: 'c1', stance: 'hold', ttlTicks: 400 });
    const start = { ...creature(w).pos };

    run(w, 8);

    // This is the discipline that makes an ambush possible at all. A creature
    // that broke cover the moment it sensed anything could never lie in wait,
    // and without lying in wait there is no trap to compose.
    expect(creature(w).stance).toBe('hold');
    // Decisions run at 4Hz, so a creature carries up to four ticks of prior
    // momentum before the order takes hold. That latency is deliberate — see
    // CREATURE_THINK_PERIOD_TICKS — so the tolerance allows for it.
    expect(Math.hypot(creature(w).pos.x - start.x, creature(w).pos.y - start.y)).toBeLessThan(1.5);
    expect(player(w).alive).toBe(true);
  });

  it('sends a creature to a position it was given', () => {
    const w = world();
    setLantern(w, 'hooded');

    give(w, { creatureId: 'c1', goto: { x: 140, y: 40 }, stance: 'stalk', ttlTicks: 600 });
    run(w, 15);

    expect(Math.hypot(creature(w).pos.x - 140, creature(w).pos.y - 40)).toBeLessThan(3);
  });

  it('reverts to instinct when the order runs out', () => {
    const w = world();
    setLantern(w, 'hooded');

    give(w, { creatureId: 'c1', stance: 'hold', ttlTicks: 40 }); // 2 seconds
    run(w, 1);
    expect(creature(w).stance).toBe('hold');

    run(w, 4);

    // An expired order is dropped rather than clung to, which is what keeps a
    // slow or absent director from producing a pack of statues.
    expect(mind.peek('c1')!.standing).toBeNull();
    expect(creature(w).stance).not.toBe('hold');
  });
});

describe('triggers', () => {
  it('a timer trigger changes the stance on schedule', () => {
    const w = world();
    setLantern(w, 'hooded');

    give(w, {
      creatureId: 'c1',
      stance: 'hold',
      trigger: { kind: 'timer', ticks: 40 },
      onTrigger: 'sweep',
      ttlTicks: 400,
    });

    run(w, 1);
    expect(creature(w).stance).toBe('hold');

    run(w, 2);
    expect(creature(w).stance).toBe('sweep');
  });

  it('a light trigger springs only when a light is actually sensed', () => {
    const w = world();
    setLantern(w, 'hooded');
    player(w).pos = { x: 130, y: 40 };

    give(w, {
      creatureId: 'c1',
      stance: 'hold',
      trigger: { kind: 'light', withinM: 40 },
      onTrigger: 'charge',
      ttlTicks: 800,
    });

    run(w, 5);
    expect(creature(w).stance).toBe('hold');

    // Open up. Now it has something to spring on.
    setLantern(w, 'full');
    run(w, 2);

    expect(creature(w).stance).toBe('charge');
  });

  it('THE COMPOSABILITY PROOF: an ambush built from primitives works', () => {
    const w = world();
    setLantern(w, 'hooded');

    // Nothing in the codebase knows what an ambush is. This is one, assembled
    // from position + stance + trigger + response — exactly the four fields a
    // model has available, and exactly why the vocabulary is primitives rather
    // than a menu of named tactics.
    give(w, {
      creatureId: 'c1',
      goto: { x: 150, y: 40 },
      stance: 'hold',
      trigger: { kind: 'light', withinM: 30 },
      onTrigger: 'charge',
      ttlTicks: 1200,
    });

    // It takes up the position and waits, silently.
    run(w, 20);
    expect(creature(w).stance).toBe('hold');
    expect(Math.hypot(creature(w).pos.x - 150, creature(w).pos.y - 40)).toBeLessThan(3);

    // The player walks into it with a lantern lit.
    setLantern(w, 'full');
    run(w, 12, walkWest);

    expect(player(w).alive).toBe(false);
  });

  it('a call trigger lets one creature spring the trap for another', () => {
    const w = world();
    setLantern(w, 'hooded');
    w.creatures['c2'] = createCreature('c2', { x: 108, y: 40 });

    give(w, {
      creatureId: 'c1',
      stance: 'hold',
      trigger: { kind: 'call', from: 'any' },
      onTrigger: 'sweep',
      ttlTicks: 800,
    });

    run(w, 3);
    expect(creature(w).stance).toBe('hold');

    // c2 calls. This is the coordination primitive: one creature's signal
    // releases the others, which is how a pincer is expressed.
    const c2 = w.creatures['c2']!;
    c2.vocalCooldown = 0;
    const hooks = mind.hooks();
    for (let i = 0; i < 6; i++) {
      c2.vocalizing = 'summon';
      step(w, { p1: still(i + 1) }, TICK_DT, hooks);
      if (creature(w).stance === 'sweep') break;
      c2.vocalizing = 'summon';
    }

    expect(mind.peek('c1')!.standing?.sprung).toBe(true);
  });
});
