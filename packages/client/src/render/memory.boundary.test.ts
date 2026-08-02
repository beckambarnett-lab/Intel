import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Q48 boundary, enforced rather than remembered.
 *
 * "Collision reads the true occluder grid, never the memory texture." The
 * rotting map lies about how the world *looks* and never about where things
 * *are*, and the mechanism that keeps that true is that the two live in
 * different modules with no path between them. A comment saying so would rot
 * faster than the memory does; this test does not.
 *
 * The same shape as the Step 10 fairness harness, for the same reason: the
 * failure it guards against is silent, would not show up in a playtest, and
 * only becomes visible long after it is expensive to undo.
 */

const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = join(here, '..');
const sharedSrc = join(here, '../../../shared/src');

/** Every module that holds part of the rotting memory. */
const MEMORY_MODULES = ['memory.ts', 'seen.ts', 'phantoms.ts'];

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('memory rot never becomes geometry (Q48)', () => {
  it('the shared sim knows nothing about memory at all', () => {
    // The sim is where collision lives, and it runs identically on the server,
    // which has no renderer and no memory of anything. Any import from a memory
    // module into shared/ is either a layering mistake or the beginning of a
    // world that disagrees with itself.
    const offenders: string[] = [];

    for (const file of sourceFiles(sharedSrc)) {
      const text = read(file);
      for (const module of MEMORY_MODULES) {
        const stem = module.replace(/\.ts$/, '');
        if (new RegExp(`from\\s+['"][^'"]*\\b${stem}\\.js['"]`).test(text)) {
          offenders.push(`${relative(sharedSrc, file)} -> ${module}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the memory modules cannot answer questions about geometry', () => {
    // They may read the grid to ask "is this spot solid" when placing a
    // hallucination, but they must never mutate it and must never be the thing
    // a collision test consults. `setTile` and `fillRect` are the write end of
    // the true world; neither belongs anywhere near a memory of it.
    const forbidden = ['setTile', 'fillRect', 'createGrid', 'gridFromMap'];
    const offenders: string[] = [];

    for (const module of MEMORY_MODULES) {
      const text = read(join(here, module));
      for (const symbol of forbidden) {
        if (new RegExp(`\\b${symbol}\\b`).test(text)) offenders.push(`${module}: ${symbol}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the phantom spawner reaches the world only through its env', () => {
    // Q49-Q52 place phantoms using memory and constrain them using the true
    // grid. Handing the spawner a grid directly would make it trivial to reach
    // for the wrong one; it gets an interface with two labelled methods instead.
    const text = read(join(here, 'phantoms.ts'));
    expect(text).not.toMatch(/\bOccluderGrid\b/);
    expect(text).not.toMatch(/\bisOpaqueTile\b/);
    expect(text).not.toMatch(/\braycastLOS\b/);
  });

  it('collision still runs against the true grid and nothing else', () => {
    // The one positive assertion: movement's collision check reads grid.ts.
    // If this ever stops being true the test above stops meaning anything.
    const movement = read(join(sharedSrc, 'sim/movement.ts'));
    expect(movement).toMatch(/from\s+['"]\.\.\/grid\.js['"]/);
  });

  it('the client renders memory but never simulates against it', () => {
    // net.ts owns the predicted world and replays the shared step(). It has no
    // business importing the renderer's memory of anything.
    const net = read(join(clientSrc, 'net.ts'));
    for (const module of MEMORY_MODULES) {
      expect(net).not.toContain(module.replace(/\.ts$/, '.js'));
    }
  });
});
