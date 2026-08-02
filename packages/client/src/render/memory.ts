import {
  MEMORY_ROT_FULL_SEC,
  MEMORY_ROT_START_SEC,
  MEMORY_TEXELS_PER_METRE,
  MEMORY_TIME_RANGE_SEC,
  MEMORY_WARP_HZ,
  MEMORY_WARP_LEAN,
  MEMORY_WARP_SCALE_M,
  PIXELS_PER_METRE,
} from '@ember/shared';
import type { Vec2 } from '@ember/shared';
import { Container, Geometry, Mesh, RenderTexture, Shader } from 'pixi.js';
import type { Renderer } from 'pixi.js';

/**
 * Memory rot, GPU side (§21 Step 5.1–5.2, Q46–Q55).
 *
 * Two textures and two passes:
 *
 *   lastSeen  world space, one texel per metre, NEVER cleared. Each frame the
 *             lit polygons are stamped into it with the current time.
 *   view      screen space, rebuilt every frame. Decodes lastSeen into the
 *             three things the composite actually needs — how rotten, whether
 *             ever seen, and which way the world is leaning here.
 *
 * The second pass exists to keep the warp field in WORLD space. Computed in
 * screen space it would swim as the camera moved, which reads instantly as a
 * broken shader rather than as an unreliable memory. Sampling the lastSeen
 * texture there also has to be done by hand: the times are packed across two
 * bytes, so hardware bilinear would blend the high byte of one texel with the
 * low byte of its neighbour and invent moments that were never recorded.
 *
 * Nothing here is ever consulted about geometry. This module cannot answer
 * "what is at this point" — only "how long ago did you last see it" (Q48).
 */
export class MemoryField {
  /** Screen-space (rot, seen, warp.x, warp.y). The composite's third input. */
  get viewTexture(): RenderTexture {
    return this.viewRT;
  }

  private lastSeenRT: RenderTexture;
  private viewRT: RenderTexture;

  private writeMesh: Mesh<Geometry, Shader>;
  private writeRoot = new Container();
  private positions: Float32Array;
  private indices: Uint32Array;
  /** Indices used last frame, so only the stale tail has to be zeroed. */
  private drawnIndices = 0;

  private viewMesh: Mesh<Geometry, Shader>;
  private viewRoot = new Container();

  private widthM: number;
  private heightM: number;

  constructor(widthM: number, heightM: number, screenW: number, screenH: number) {
    this.widthM = widthM;
    this.heightM = heightM;

    this.lastSeenRT = createLastSeenTexture(widthM, heightM);
    this.viewRT = RenderTexture.create({ width: screenW, height: screenH, resolution: 1 });

    this.positions = new Float32Array(MAX_WRITE_VERTS * 2);
    this.indices = new Uint32Array(MAX_WRITE_VERTS * 3);

    this.writeMesh = new Mesh({
      geometry: new Geometry({
        attributes: { aPosition: this.positions },
        indexBuffer: this.indices,
      }),
      shader: Shader.from({
        gl: { vertex: PLAIN_VERTEX, fragment: WRITE_FRAGMENT },
        resources: {
          settings: {
            uNow: { value: 0, type: 'f32' },
            uRange: { value: MEMORY_TIME_RANGE_SEC, type: 'f32' },
          },
        },
      }),
    });
    // Blending off. These are not colours, they are a packed timestamp — any
    // blend function at all would average two of them into a third time.
    this.writeMesh.blendMode = 'none';
    this.writeRoot.addChild(this.writeMesh);

    this.viewMesh = new Mesh({
      geometry: quadGeometry(),
      shader: Shader.from({
        gl: { vertex: UV_VERTEX, fragment: VIEW_FRAGMENT },
        resources: {
          uMemory: this.lastSeenRT.source,
          uMemorySampler: this.lastSeenRT.source.style,
          settings: {
            uNow: { value: 0, type: 'f32' },
            uRange: { value: MEMORY_TIME_RANGE_SEC, type: 'f32' },
            uRotStart: { value: MEMORY_ROT_START_SEC, type: 'f32' },
            uRotFull: { value: MEMORY_ROT_FULL_SEC, type: 'f32' },
            uWarpScale: { value: MEMORY_WARP_SCALE_M, type: 'f32' },
            uWarpLean: { value: MEMORY_WARP_LEAN, type: 'f32' },
            uWarpTime: { value: 0, type: 'f32' },
            uMemSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
            uWorldSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          },
        },
      }),
    });
    // Same reason: the four output channels are data, including alpha.
    this.viewMesh.blendMode = 'none';
    this.viewRoot.addChild(this.viewMesh);

    this.applyWorldSize();
  }

  /** Rebuild for a different map. Wipes memory, which a new map should. */
  setWorldSize(widthM: number, heightM: number): void {
    if (widthM === this.widthM && heightM === this.heightM) return;
    this.widthM = widthM;
    this.heightM = heightM;
    this.lastSeenRT.destroy(true);
    this.lastSeenRT = createLastSeenTexture(widthM, heightM);
    this.rebindMemory();
    this.applyWorldSize();
  }

  resizeScreen(width: number, height: number): void {
    if (width === this.viewRT.width && height === this.viewRT.height) return;
    this.viewRT.destroy(true);
    this.viewRT = RenderTexture.create({ width, height, resolution: 1 });
  }

  /**
   * Stamp `nowSec` over everything the given lights recorded.
   *
   * `polys` are the same visibility polygons the light field draws — computed
   * once by the caller and handed to both, because casting them twice per light
   * per frame is the single most expensive thing the renderer does. Each is
   * pulled in to `radiusM`, which the caller has already reduced to the part of
   * the light that counts as properly lit (Q55): you remember the ground you
   * saw well, not everything a photon reached.
   */
  write(
    renderer: Renderer,
    lights: { pos: Vec2; radiusM: number }[],
    polys: Vec2[][],
    nowSec: number,
  ): void {
    const scale = MEMORY_TEXELS_PER_METRE;
    let vert = 0;
    let index = 0;

    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      const light = lights[i];
      if (!poly || !light || poly.length < 3) continue;
      // Each polygon costs one origin vertex plus its ring, and three indices
      // per ring segment. Drop a light rather than overrun and corrupt the fan.
      if (vert + poly.length + 1 > MAX_WRITE_VERTS) break;

      const origin = vert;
      this.positions[vert * 2] = light.pos.x * scale;
      this.positions[vert * 2 + 1] = light.pos.y * scale;
      vert++;

      const first = vert;
      for (const p of poly) {
        // Pulling each ray in rather than scaling the whole shape keeps the
        // occlusion exact: a vertex that stopped early on a trunk stays where
        // the trunk is, and only the ones that ran to full range move.
        const dx = p.x - light.pos.x;
        const dy = p.y - light.pos.y;
        const dist = Math.hypot(dx, dy);
        const k = dist > light.radiusM && dist > 0 ? light.radiusM / dist : 1;
        this.positions[vert * 2] = (light.pos.x + dx * k) * scale;
        this.positions[vert * 2 + 1] = (light.pos.y + dy * k) * scale;
        vert++;
      }

      // A triangle fan around the origin. visibilityPolygon returns its points
      // in angular order and each one sits on its own ray, so consecutive pairs
      // are always a wedge with nothing of the origin's view outside it.
      for (let k = 0; k < poly.length; k++) {
        const a = first + k;
        const b = first + ((k + 1) % poly.length);
        this.indices[index++] = origin;
        this.indices[index++] = a;
        this.indices[index++] = b;
      }
    }

    // The draw covers the whole index buffer, so last frame's tail has to go.
    // Zeroed indices collapse to a degenerate triangle and rasterise nothing.
    const uploadIndices = Math.max(index, this.drawnIndices);
    if (index < this.drawnIndices) this.indices.fill(0, index, this.drawnIndices);
    this.drawnIndices = index;

    // The byte counts are not optional. Buffer.update() with no argument leaves
    // the upload size undefined, which reaches gl.bufferSubData as a NaN length
    // and quietly uploads nothing at all from the second frame onward — memory
    // would freeze on whatever the first frame happened to see. Uploading as
    // far as the zeroed tail is what keeps stale triangles off the GPU.
    const geometry = this.writeMesh.geometry;
    geometry.getBuffer('aPosition').update(vert * 2 * Float32Array.BYTES_PER_ELEMENT);
    geometry.indexBuffer.update(uploadIndices * Uint32Array.BYTES_PER_ELEMENT);

    this.writeMesh.shader!.resources['settings'].uniforms.uNow = nowSec;

    // clear: false is the entire point — this texture is the only thing in the
    // renderer that survives a frame.
    renderer.render({ container: this.writeRoot, target: this.lastSeenRT, clear: false });
  }

  /** Decode last-seen into the screen-space field the composite reads. */
  renderView(renderer: Renderer, nowSec: number, cameraOffsetPx: Vec2): void {
    this.viewRoot.x = cameraOffsetPx.x;
    this.viewRoot.y = cameraOffsetPx.y;

    const uniforms = this.viewMesh.shader!.resources['settings'].uniforms;
    uniforms.uNow = nowSec;
    uniforms.uWarpTime = nowSec * MEMORY_WARP_HZ * Math.PI * 2;

    // Cleared, so anything the world quad does not cover reads as never-seen
    // and stays black. Off the edge of the map there is nothing to remember.
    renderer.render({ container: this.viewRoot, target: this.viewRT, clear: true });
  }

  /**
   * Q54: on revival your memory is wiped.
   *
   * Nothing calls this yet — death arrives in Step 8 — but the wipe belongs to
   * the memory system rather than to the death system, so it lives here.
   */
  forget(renderer: Renderer): void {
    renderer.render({ container: new Container(), target: this.lastSeenRT, clear: true });
  }

  destroy(): void {
    this.writeMesh.destroy(true);
    this.viewMesh.destroy(true);
    this.lastSeenRT.destroy(true);
    this.viewRT.destroy(true);
  }

  private rebindMemory(): void {
    const res = this.viewMesh.shader!.resources;
    res['uMemory'] = this.lastSeenRT.source;
    res['uMemorySampler'] = this.lastSeenRT.source.style;
  }

  private applyWorldSize(): void {
    this.viewMesh.width = this.widthM * PIXELS_PER_METRE;
    this.viewMesh.height = this.heightM * PIXELS_PER_METRE;

    const uniforms = this.viewMesh.shader!.resources['settings'].uniforms;
    uniforms.uMemSize[0] = this.lastSeenRT.width;
    uniforms.uMemSize[1] = this.lastSeenRT.height;
    uniforms.uWorldSize[0] = this.widthM;
    uniforms.uWorldSize[1] = this.heightM;
  }
}

/**
 * Upper bound on vertices in one write pass.
 *
 * A single light throws one ray per ring step plus three per silhouette corner
 * in range, so a roaring fire in the ruins is the worst case at a few hundred.
 * Five lights at once puts the real ceiling near 3500.
 *
 * Not larger, because the cost is fixed rather than proportional: Pixi's mesh
 * adaptor always draws the whole index buffer, so every unused slot is a
 * degenerate triangle rasterised every frame forever. Sized at roughly twice
 * the worst case, and the loop above drops a light rather than overrunning.
 */
const MAX_WRITE_VERTS = 8192;

function createLastSeenTexture(widthM: number, heightM: number): RenderTexture {
  return RenderTexture.create({
    width: Math.ceil(widthM * MEMORY_TEXELS_PER_METRE),
    height: Math.ceil(heightM * MEMORY_TEXELS_PER_METRE),
    resolution: 1,
    // Nearest, because the decode pass does its own bilinear on the DECODED
    // times. Letting the hardware filter the packed bytes would be garbage.
    scaleMode: 'nearest',
  });
}

function quadGeometry(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: [0, 0, 1, 0, 1, 1, 0, 1],
      aUV: [0, 0, 1, 0, 1, 1, 0, 1],
    },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });
}

const PLAIN_VERTEX = `
in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`;

const UV_VERTEX = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * Pack the current time into two 8-bit channels, with the third as an
 * ever-seen flag.
 *
 * Done in the shader rather than by tinting a filled polygon so the value is
 * exact: `hi` lands on a byte boundary by construction, and `lo` carries the
 * remainder at 1/255 of it. Over MEMORY_TIME_RANGE_SEC that is 0.06s of error
 * on a curve whose first landmark is thirty seconds away.
 */
const WRITE_FRAGMENT = `
precision highp float;

out vec4 finalColor;

uniform float uNow;
uniform float uRange;

void main() {
  float t = clamp(uNow / uRange, 0.0, 1.0);
  float s = t * 255.0;
  float hi = floor(s);
  float lo = s - hi;
  finalColor = vec4(hi / 255.0, lo, 1.0, 1.0);
}
`;

/**
 * Decode last-seen into (rot, seen, warp).
 *
 * `rot` is the Q46 curve — untouched for thirty seconds, fully gone at four
 * minutes — and ground you have never seen is pinned to fully rotten, which is
 * the maximum distortion Q55 asks for. `warp` is a low-frequency field in world
 * metres, so it stays nailed to the ground as the camera moves; the composite
 * scales it by how rotten the memory is.
 */
const VIEW_FRAGMENT = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uMemory;

uniform float uNow;
uniform float uRange;
uniform float uRotStart;
uniform float uRotFull;
uniform float uWarpScale;
uniform float uWarpLean;
uniform float uWarpTime;
uniform vec2 uMemSize;
uniform vec2 uWorldSize;

float decodeTime(vec2 rg) {
  return (rg.r * 255.0 + rg.g) / 255.0 * uRange;
}

void main() {
  // Manual bilinear: fetch four packed texels, decode each to seconds, and
  // blend the seconds. Blending the packed bytes instead would mix a high byte
  // with a neighbour's low byte and produce a time nobody ever wrote.
  vec2 tc = vUV * uMemSize - 0.5;
  vec2 base = floor(tc);
  vec2 f = tc - base;

  vec4 t00 = texture(uMemory, (base + vec2(0.5, 0.5)) / uMemSize);
  vec4 t10 = texture(uMemory, (base + vec2(1.5, 0.5)) / uMemSize);
  vec4 t01 = texture(uMemory, (base + vec2(0.5, 1.5)) / uMemSize);
  vec4 t11 = texture(uMemory, (base + vec2(1.5, 1.5)) / uMemSize);

  float lastSeen = mix(
    mix(decodeTime(t00.rg), decodeTime(t10.rg), f.x),
    mix(decodeTime(t01.rg), decodeTime(t11.rg), f.x),
    f.y);

  float seen = mix(mix(t00.b, t10.b, f.x), mix(t01.b, t11.b, f.x), f.y);

  float age = max(uNow - lastSeen, 0.0);
  float rot = smoothstep(uRotStart, uRotFull, age);
  // Never seen -> maximum distortion (Q55). Blended rather than branched so
  // the boundary of your memory is a soft edge, not a staircase.
  rot = mix(1.0, rot, seen);

  vec2 w = vUV * uWorldSize;
  float wx = sin(w.y / uWarpScale + uWarpTime) + 0.6 * sin(w.x / (uWarpScale * 0.53) - uWarpTime * 0.7);
  float wy = cos(w.x / uWarpScale - uWarpTime * 0.8) + 0.6 * cos(w.y / (uWarpScale * 0.61) + uWarpTime * 0.5);
  // Anisotropic on purpose: pulling harder along one axis shears silhouettes
  // instead of jittering them, which is what makes trunks lean (Q47).
  vec2 warp = clamp(vec2(wx, wy * uWarpLean) / 1.6, -1.0, 1.0);

  finalColor = vec4(rot, seen, warp * 0.5 + 0.5);
}
`;
