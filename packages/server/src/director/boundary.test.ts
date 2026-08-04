import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The fairness boundary, asserted against the source itself.
 *
 * CLAUDE.md requires this be enforced by an ESLint rule *and* by a CI-blocking
 * test, and the redundancy is deliberate: a lint rule can be silenced with an
 * inline `eslint-disable` comment by someone in a hurry, and that comment looks
 * entirely reasonable in a diff. This test reads the file and cannot be talked
 * out of it.
 *
 * What it is protecting against is not malice but convenience. The tempting
 * edit — DESIGN.md Step 10 names it explicitly as the trap — is to "help" the
 * director by handing it a little more of the world. The result is an enemy
 * that is omniscient rather than intelligent, and the reason it must be caught
 * mechanically is that it cannot be caught any other way: playtesting an
 * omniscient enemy just feels like playtesting a very good one.
 */

const CONTEXT_SRC = new URL('./context.ts', import.meta.url);

function importsOf(source: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\s[^'"]*['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]!);
  return out;
}

describe('director context — the fairness boundary (Q114)', () => {
  const source = readFileSync(CONTEXT_SRC, 'utf8');

  it('imports ./perception.js and nothing else, ever', () => {
    expect(importsOf(source)).toEqual(['./perception.js']);
  });

  it('does not reach the shared package', () => {
    // Everything about the world lives there: WorldState, players, the grid.
    // One import is all it would take.
    expect(source).not.toContain('@ember/shared');
  });

  it('never names the world or the player type', () => {
    for (const forbidden of ['WorldState', 'world.players', 'Player']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('has no escape hatch that would let the rule be waived', () => {
    expect(source).not.toContain('eslint-disable');
    expect(source).not.toContain('@ts-ignore');
    expect(source).not.toContain('require(');
    // A dynamic import would sail straight past a static lint rule.
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});
