import type { InputFrame } from '@ember/shared';

/**
 * Keyboard intent. Reads raw key state and produces one InputFrame per sim tick;
 * it never touches the world directly. Bindings follow DESIGN.md Q126 — the
 * verbs beyond movement land in later steps.
 */
export class InputSource {
  private held = new Set<string>();

  /**
   * Keys whose *press* matters rather than their held state. Drained into the
   * next frame sampled, so a tap between two ticks is never dropped and a hold
   * never fires twice.
   */
  private edges = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      // Never swallow browser shortcuts like Ctrl+R or F12.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.repeat && EDGE_KEYS.has(e.code)) this.edges.add(e.code);
      this.held.add(e.code);
      if (MOVEMENT_KEYS.has(e.code)) e.preventDefault();
    });

    target.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });

    // Releasing focus mid-stride would otherwise leave you sprinting forever.
    target.addEventListener('blur', () => {
      this.held.clear();
      this.edges.clear();
    });
  }

  sample(seq: number): InputFrame {
    let moveX = 0;
    let moveY = 0;

    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) moveX -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) moveX += 1;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) moveY -= 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) moveY += 1;

    const shutter = this.edges.delete('KeyF');
    const panicDrop = this.edges.delete('KeyQ');
    const dropLantern = this.edges.delete('KeyG');

    return {
      seq,
      moveX,
      moveY,
      sprint: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      creep: this.held.has('KeyC'),
      shutter,
      // Held, not an edge — it drives the stoke and chop channels, and letting
      // go is what interrupts them (Q8, Q16).
      interact: this.held.has('KeyE'),
      panicDrop,
      // `F` does both jobs: the edge above cycles the shutter, holding it feeds
      // the lantern. The sim waits out LANTERN_REFUEL_HOLD_SEC before any wood
      // actually goes in, so a tap is never also a refuel.
      refuel: this.held.has('KeyF'),
      dropLantern,
    };
  }
}

/** `F` cycles the shutter, `Q` panic-drops, `G` sets down the lantern (Q126, Q35, Q41). */
const EDGE_KEYS = new Set(['KeyF', 'KeyQ', 'KeyG']);

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);
