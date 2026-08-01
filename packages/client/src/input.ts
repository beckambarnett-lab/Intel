import type { InputFrame } from '@ember/shared';

/**
 * Keyboard intent. Reads raw key state and produces one InputFrame per sim tick;
 * it never touches the world directly. Bindings follow DESIGN.md Q126 — the
 * verbs beyond movement land in later steps.
 */
export class InputSource {
  private held = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      // Never swallow browser shortcuts like Ctrl+R or F12.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.held.add(e.code);
      if (MOVEMENT_KEYS.has(e.code)) e.preventDefault();
    });

    target.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });

    // Releasing focus mid-stride would otherwise leave you sprinting forever.
    target.addEventListener('blur', () => this.held.clear());
  }

  sample(seq: number): InputFrame {
    let moveX = 0;
    let moveY = 0;

    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) moveX -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) moveX += 1;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) moveY -= 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) moveY += 1;

    return {
      seq,
      moveX,
      moveY,
      sprint: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      creep: this.held.has('KeyC'),
    };
  }
}

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
