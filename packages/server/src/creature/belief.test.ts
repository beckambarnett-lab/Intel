import { describe, expect, it } from 'vitest';
import { BELIEF_CELL_M } from '@ember/shared';
import {
  ageBelief,
  bestSearchTarget,
  blendBelief,
  cellOf,
  createBelief,
  injectBelief,
  markChecked,
  totalBelief,
} from './belief.js';

const WORLD_W = 400;
const WORLD_H = 120;

function field() {
  return createBelief(WORLD_W, WORLD_H);
}

function massAt(f: ReturnType<typeof field>, x: number, y: number): number {
  const { cx, cy } = cellOf(f, { x, y });
  return f.p[cy * f.w + cx] ?? 0;
}

describe('belief — observation', () => {
  it('starts knowing nothing', () => {
    expect(totalBelief(field())).toBe(0);
  });

  it('puts mass where the observation was', () => {
    const f = field();
    injectBelief(f, { x: 200, y: 60 }, 1, 1);

    expect(massAt(f, 200, 60)).toBeGreaterThan(0);
    expect(massAt(f, 40, 20)).toBe(0);
  });

  it('peaks at the observation and falls off around it', () => {
    const f = field();
    injectBelief(f, { x: 200, y: 60 }, 1, 2);

    const centre = massAt(f, 200, 60);
    const near = massAt(f, 200 + BELIEF_CELL_M, 60);

    expect(centre).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
  });

  it('smears a vague observation wider than a sharp one', () => {
    const sharp = field();
    injectBelief(sharp, { x: 200, y: 60 }, 1, 1);

    const vague = field();
    injectBelief(vague, { x: 200, y: 60 }, 1, 3);

    // A footfall heard at the edge of earshot should send a creature to an
    // area; a lantern seen clearly should send it to a place.
    const sharpCells = sharp.p.filter((v) => v > 0).length;
    const vagueCells = vague.p.filter((v) => v > 0).length;
    expect(vagueCells).toBeGreaterThan(sharpCells);
  });
});

describe('belief — ageing', () => {
  it('fades over time', () => {
    const f = field();
    injectBelief(f, { x: 200, y: 60 }, 1, 1);
    const before = totalBelief(f);

    for (let i = 0; i < 8; i++) ageBelief(f, 0.25);

    expect(totalBelief(f)).toBeLessThan(before);
  });

  it('spreads outward — the model of you having moved', () => {
    const f = field();
    injectBelief(f, { x: 200, y: 60 }, 1, 0);
    expect(massAt(f, 200 + BELIEF_CELL_M, 60)).toBe(0);

    ageBelief(f, 0.25);

    // Uncertainty grows into the neighbouring ground, which is why a stale
    // contact produces a search of an area rather than a walk to a point.
    expect(massAt(f, 200 + BELIEF_CELL_M, 60)).toBeGreaterThan(0);
  });

  it('reaches exactly zero eventually, so a creature can conclude it has lost you', () => {
    const f = field();
    injectBelief(f, { x: 200, y: 60 }, 1, 1);

    // A field that decayed asymptotically would stay faintly non-empty forever
    // and a creature would never stop searching.
    for (let i = 0; i < 400; i++) ageBelief(f, 0.25);

    expect(totalBelief(f)).toBe(0);
    expect(bestSearchTarget(f, { x: 0, y: 0 }, 10_000)).toBeNull();
  });
});

describe('belief — negative information', () => {
  it('clears the ground a creature has stood on', () => {
    const f = field();
    injectBelief(f, { x: 200, y: 60 }, 1, 1);
    expect(massAt(f, 200, 60)).toBeGreaterThan(0);

    markChecked(f, { x: 200, y: 60 }, 500);

    expect(massAt(f, 200, 60)).toBe(0);
  });

  it('records when it checked, so it can prefer somewhere it has not', () => {
    const f = field();
    markChecked(f, { x: 200, y: 60 }, 500);

    const { cx, cy } = cellOf(f, { x: 200, y: 60 });
    expect(f.checked[cy * f.w + cx]).toBe(500);
  });

  it('sends a creature onward instead of orbiting one spot', () => {
    const f = field();
    // Two equally promising places, the same distance away.
    injectBelief(f, { x: 200, y: 60 }, 1, 0);
    injectBelief(f, { x: 240, y: 60 }, 1, 0);

    const from = { x: 220, y: 60 };
    const first = bestSearchTarget(f, from, 100)!;
    expect(first).not.toBeNull();

    // Go and check it.
    markChecked(f, first.pos, 100);

    const second = bestSearchTarget(f, from, 120)!;
    expect(second).not.toBeNull();
    // Having looked there, it must now want somewhere else.
    expect(Math.hypot(second.pos.x - first.pos.x, second.pos.y - first.pos.y)).toBeGreaterThan(
      BELIEF_CELL_M,
    );
  });
});

describe('belief — calling', () => {
  it('hands the caller\'s picture to the hearer', () => {
    const caller = field();
    const hearer = field();
    injectBelief(caller, { x: 200, y: 60 }, 1, 1);

    expect(totalBelief(hearer)).toBe(0);
    blendBelief(hearer, caller, 0.75);

    // Three creatures converging is three fields that now agree, because one
    // of them shouted.
    expect(massAt(hearer, 200, 60)).toBeGreaterThan(0);
    expect(massAt(hearer, 200, 60)).toBeLessThan(massAt(caller, 200, 60));
  });

  it('does not stack — hearing the same news twice is not twice as certain', () => {
    const caller = field();
    const hearer = field();
    injectBelief(caller, { x: 200, y: 60 }, 1, 1);

    blendBelief(hearer, caller, 0.75);
    const once = massAt(hearer, 200, 60);
    blendBelief(hearer, caller, 0.75);

    expect(massAt(hearer, 200, 60)).toBeCloseTo(once);
  });

  it('never weakens what the hearer already knew better', () => {
    const caller = field();
    const hearer = field();
    injectBelief(caller, { x: 200, y: 60 }, 0.2, 0);
    injectBelief(hearer, { x: 200, y: 60 }, 1, 0);
    const own = massAt(hearer, 200, 60);

    blendBelief(hearer, caller, 0.75);

    // A creature that can see you should not be talked out of it by a creature
    // that only heard something.
    expect(massAt(hearer, 200, 60)).toBeCloseTo(own);
  });
});
