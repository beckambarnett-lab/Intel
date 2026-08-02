import {
  PIXELS_PER_METRE,
  SILHOUETTE_ALBEDO,
  SILHOUETTE_BODY_M,
  SILHOUETTE_HEAD_M,
  SILHOUETTE_LIMB_M,
} from '@ember/shared';
import type { Graphics } from 'pixi.js';

/**
 * One upright figure, drawn into the albedo buffer in world-pixel space.
 *
 * This exists as its own module because of Q52: a real creature standing in
 * stale memory and a phantom invented by that memory must render *identically*,
 * or the ambiguity that the whole system turns on becomes a rendering tell that
 * a player learns to read in an afternoon. Phantoms use it now; creatures use
 * this same function in Step 6, and neither gets its own variant.
 *
 * It is drawn as albedo, not as a screen colour — the composite decides how
 * brightly it comes back, which is exactly why the same shape works for a
 * hallucination in rotten memory and a lit body four metres away.
 */
export function drawSilhouette(g: Graphics, x: number, y: number, facing: number): void {
  const px = x * PIXELS_PER_METRE;
  const py = y * PIXELS_PER_METRE;
  const body = SILHOUETTE_BODY_M * PIXELS_PER_METRE;
  const head = SILHOUETTE_HEAD_M * PIXELS_PER_METRE;
  const limb = SILHOUETTE_LIMB_M * PIXELS_PER_METRE;

  const fx = Math.cos(facing);
  const fy = Math.sin(facing);

  // Limbs first, so the body overlaps their roots and the joint is not a seam.
  // Splayed either side of the facing rather than along it: the outline has to
  // be legible as a *thing with arms* at the two or three pixels of contrast
  // rotten memory will give it.
  for (const side of [-1, 1]) {
    const ax = px + (fx * 0.35 - fy * side * 0.75) * limb;
    const ay = py + (fy * 0.35 + fx * side * 0.75) * limb;
    g.moveTo(px, py).lineTo(ax, ay).stroke({ width: body * 0.34, color: SILHOUETTE_ALBEDO });
  }

  g.ellipse(px, py, body * 0.72, body).fill(SILHOUETTE_ALBEDO);
  g.circle(px + fx * body * 0.55, py + fy * body * 0.55, head).fill(SILHOUETTE_ALBEDO);
}
