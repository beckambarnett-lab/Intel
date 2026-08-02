import {
  MEMORY_PROPERLY_LIT_FRAC,
  MEMORY_ROT_FULL_SEC,
  MEMORY_ROT_START_SEC,
  OCCLUDER_OPAQUE,
  createGrid,
  setTile,
} from '@ember/shared';
import { describe, expect, it } from 'vitest';
import { SeenField, rot } from './seen.js';

const openGrid = (w = 40, h = 40) => createGrid(w, h);

describe('the last-seen field', () => {
  it('starts with nothing remembered anywhere', () => {
    const field = new SeenField(40, 40);
    expect(field.seenAt(10, 10)).toBe(false);
    expect(field.ageAt(10, 10, 100)).toBe(Infinity);
  });

  it('remembers what a light revealed', () => {
    const field = new SeenField(40, 40);
    field.mark(openGrid(), { x: 20, y: 20 }, 5, 12);

    expect(field.seenAt(20, 20)).toBe(true);
    expect(field.lastSeenAt(20, 20)).toBe(12);
    expect(field.ageAt(20, 20, 42)).toBe(30);
  });

  it('remembers nothing beyond the light radius', () => {
    const field = new SeenField(40, 40);
    field.mark(openGrid(), { x: 20, y: 20 }, 4, 5);
    expect(field.seenAt(30, 20)).toBe(false);
  });

  it('records only the properly-lit core of a light (Q55)', () => {
    // The caller hands in the reduced radius, not the light's own. Ground the
    // outer edge of a beam merely grazed is lit but never committed, which is
    // what leaves it "never seen" and therefore maximally distorted until you
    // walk far enough in to see it properly.
    const lightRadiusM = 10;
    const field = new SeenField(40, 40);
    field.mark(openGrid(), { x: 20, y: 20 }, lightRadiusM * MEMORY_PROPERLY_LIT_FRAC, 5);

    expect(field.seenAt(24, 20)).toBe(true);
    expect(field.seenAt(28.5, 20)).toBe(false);
  });

  it('does not remember through a wall — memory obeys line of sight', () => {
    const grid = openGrid();
    for (let ty = 0; ty < 40; ty++) setTile(grid, 22, ty, OCCLUDER_OPAQUE);

    const field = new SeenField(40, 40);
    field.mark(grid, { x: 20, y: 20 }, 9, 5);

    expect(field.seenAt(21, 20)).toBe(true);
    expect(field.seenAt(26, 20)).toBe(false);
  });

  it('refreshes on a second look rather than ageing from the first', () => {
    const field = new SeenField(40, 40);
    const grid = openGrid();
    field.mark(grid, { x: 20, y: 20 }, 5, 10);
    field.mark(grid, { x: 20, y: 20 }, 5, 200);

    expect(field.ageAt(20, 20, 205)).toBe(5);
  });

  it('is wiped by forget (Q54)', () => {
    const field = new SeenField(40, 40);
    field.mark(openGrid(), { x: 20, y: 20 }, 5, 12);
    field.forget();
    expect(field.seenAt(20, 20)).toBe(false);
  });

  it('reads out of bounds as never seen rather than throwing', () => {
    const field = new SeenField(40, 40);
    expect(field.seenAt(-3, 10)).toBe(false);
    expect(field.seenAt(10, 999)).toBe(false);
  });
});

describe('the rot curve (Q46)', () => {
  it('is untouched for the first thirty seconds', () => {
    expect(rot(0)).toBe(0);
    expect(rot(MEMORY_ROT_START_SEC)).toBe(0);
  });

  it('is fully rotten at four minutes', () => {
    expect(rot(MEMORY_ROT_FULL_SEC)).toBe(1);
    expect(rot(MEMORY_ROT_FULL_SEC * 10)).toBe(1);
  });

  it('rises monotonically in between', () => {
    let previous = -1;
    for (let t = MEMORY_ROT_START_SEC; t <= MEMORY_ROT_FULL_SEC; t += 5) {
      const r = rot(t);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it('treats ground you have never seen as fully rotten (Q55)', () => {
    expect(rot(Infinity)).toBe(1);
  });

  it('agrees with the field it drives', () => {
    const field = new SeenField(40, 40);
    field.mark(openGrid(), { x: 20, y: 20 }, 5, 0);
    expect(field.rotAt(20, 20, MEMORY_ROT_START_SEC)).toBe(0);
    expect(field.rotAt(20, 20, MEMORY_ROT_FULL_SEC)).toBe(1);
    // Somewhere it has never been: maximally rotten from the first frame.
    expect(field.rotAt(35, 35, 1)).toBe(1);
  });
});
