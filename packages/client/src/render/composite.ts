import {
  COMPOSITE_AMBIENT,
  COMPOSITE_EXPOSURE,
  MEMORY_BRIGHTNESS_FRESH,
  MEMORY_BRIGHTNESS_ROTTEN,
  MEMORY_EDGE_GAIN,
  MEMORY_EDGE_TAP_PX,
  MEMORY_FIRST_SIGHT_DESAT,
  MEMORY_FIRST_SIGHT_WARP_PX,
  MEMORY_LIT_REFERENCE,
  MEMORY_SATURATION_FRESH,
  MEMORY_SATURATION_ROTTEN,
  MEMORY_WARP_FRESH_PX,
  MEMORY_WARP_ROTTEN_PX,
} from '@ember/shared';
import { Geometry, Mesh, Shader } from 'pixi.js';
import type { RenderTexture } from 'pixi.js';

/**
 * The composite pass (§24.2, stages 5 and 9; §21 Step 5.2).
 *
 * Three inputs, two layers, one screen:
 *
 *   uWorld   the albedo — the world in full colour, unlit
 *   uLight   every light's coloured falloff, clipped to its visibility polygon
 *   uMemory  how long ago you last saw each pixel, and which way it leans now
 *
 * Where light is landing you get the true render: albedo times light, through a
 * filmic rolloff. Where it is not, you get *memory* — the same albedo, dimmed,
 * drained of colour and pulled out of shape by an amount that grows with how
 * long it has been since you looked (Q46/Q47). The two crossfade on how bright
 * the light is, so the edge of your lantern is literally the line between
 * seeing and remembering.
 *
 * The rolloff is the whole point of the true layer. Using the light field as a
 * *mask* has two fatal properties: light can only ever be white, and
 * accumulation clips — so the fire's centre saturated to a flat white disc and
 * the flame inside it was invisible. `1 - exp(-x)` keeps the falloff intact
 * while asymptotically approaching white instead of hitting it, so a bright
 * fire stays a *colour*.
 *
 * WebGL is forced in Stage.init so there is one shader language here rather
 * than a WGSL variant to keep in sync.
 */
export class Composite {
  readonly mesh: Mesh<Geometry, Shader>;

  constructor(world: RenderTexture, light: RenderTexture, memory: RenderTexture) {
    const geometry = new Geometry({
      attributes: {
        aPosition: [0, 0, 1, 0, 1, 1, 0, 1],
        aUV: [0, 0, 1, 0, 1, 1, 0, 1],
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });

    const shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        uWorld: world.source,
        uWorldSampler: world.source.style,
        uLight: light.source,
        uLightSampler: light.source.style,
        uMemory: memory.source,
        uMemorySampler: memory.source.style,
        settings: {
          uExposure: { value: COMPOSITE_EXPOSURE, type: 'f32' },
          uAmbient: { value: COMPOSITE_AMBIENT, type: 'f32' },
          uLitReference: { value: MEMORY_LIT_REFERENCE, type: 'f32' },
          uWarpFreshPx: { value: MEMORY_WARP_FRESH_PX, type: 'f32' },
          uWarpRottenPx: { value: MEMORY_WARP_ROTTEN_PX, type: 'f32' },
          uEdgeGain: { value: MEMORY_EDGE_GAIN, type: 'f32' },
          uEdgeTapPx: { value: MEMORY_EDGE_TAP_PX, type: 'f32' },
          uSatFresh: { value: MEMORY_SATURATION_FRESH, type: 'f32' },
          uSatRotten: { value: MEMORY_SATURATION_ROTTEN, type: 'f32' },
          uMemBrightFresh: { value: MEMORY_BRIGHTNESS_FRESH, type: 'f32' },
          uMemBrightRotten: { value: MEMORY_BRIGHTNESS_ROTTEN, type: 'f32' },
          uFirstSightWarpPx: { value: MEMORY_FIRST_SIGHT_WARP_PX, type: 'f32' },
          uFirstSightDesat: { value: MEMORY_FIRST_SIGHT_DESAT, type: 'f32' },
          uScreen: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        },
      },
    });

    this.mesh = new Mesh({ geometry, shader });
  }

  resize(width: number, height: number): void {
    // The quad is a unit square scaled to the viewport, so the vertex shader
    // needs no knowledge of the camera — this pass is pure screen space.
    this.mesh.width = width;
    this.mesh.height = height;
    this.mesh.shader!.resources['settings'].uniforms.uScreen[0] = width;
    this.mesh.shader!.resources['settings'].uniforms.uScreen[1] = height;
  }

  /** Rebind after a resize replaces the underlying textures. */
  rebind(world: RenderTexture, light: RenderTexture, memory: RenderTexture): void {
    const res = this.mesh.shader!.resources;
    res['uWorld'] = world.source;
    res['uWorldSampler'] = world.source.style;
    res['uLight'] = light.source;
    res['uLightSampler'] = light.source.style;
    res['uMemory'] = memory.source;
    res['uMemorySampler'] = memory.source.style;
  }

  set exposure(v: number) {
    this.mesh.shader!.resources['settings'].uniforms.uExposure = v;
  }
}

const VERTEX = `
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

const FRAGMENT = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uWorld;
uniform sampler2D uLight;
uniform sampler2D uMemory;

uniform float uExposure;
uniform float uAmbient;
uniform float uLitReference;
uniform float uWarpFreshPx;
uniform float uWarpRottenPx;
uniform float uEdgeGain;
uniform float uEdgeTapPx;
uniform float uSatFresh;
uniform float uSatRotten;
uniform float uMemBrightFresh;
uniform float uMemBrightRotten;
uniform float uFirstSightWarpPx;
uniform float uFirstSightDesat;
uniform vec2 uScreen;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 desaturate(vec3 c, float amount) {
  return mix(c, vec3(luminance(c)), amount);
}

void main() {
  vec2 texel = 1.0 / uScreen;

  vec3 lightRGB = texture(uLight, vUV).rgb;
  vec4 mem = texture(uMemory, vUV);

  float rot = mem.r;
  float seen = mem.g;
  vec2 warpDir = mem.ba * 2.0 - 1.0;

  // How much of this pixel is genuinely being lit right now. At 1 the output
  // below is bit-for-bit the render Steps 2-4 produced.
  float lit = clamp(luminance(lightRGB) / uLitReference, 0.0, 1.0);

  // ---- what you can see -------------------------------------------------
  // Q55: ground you have never seen before is distorted until it is properly
  // lit, so the leading edge of your beam over new territory crawls and then
  // settles as you put light on it.
  float firstSight = (1.0 - seen) * (1.0 - lit);
  vec2 trueUV = vUV + warpDir * texel * uFirstSightWarpPx * firstSight;

  vec3 albedo = texture(uWorld, trueUV).rgb;
  // A trace of ambient keeps unlit ground from being a dead black rectangle.
  // Far too dim to read anything by — it exists so the dark has texture.
  vec3 litColour = albedo * (lightRGB + uAmbient);
  // Filmic rolloff. Approaches white asymptotically instead of clipping, which
  // is what stops a roaring fire from becoming a featureless white disc.
  vec3 trueLayer = vec3(1.0) - exp(-litColour * uExposure);
  trueLayer = desaturate(trueLayer, firstSight * uFirstSightDesat);

  // ---- what you remember ------------------------------------------------
  vec2 memUV = vUV + warpDir * texel * mix(uWarpFreshPx, uWarpRottenPx, rot);
  vec3 remembered = texture(uWorld, memUV).rgb;

  // Q47: edges sharpen as memory rots — branches sharpen into limbs. An
  // unsharp mask against a four-tap blur, with the gain rising as it goes.
  vec2 tap = texel * uEdgeTapPx;
  vec3 blur = (
    texture(uWorld, memUV + vec2( tap.x, 0.0)).rgb +
    texture(uWorld, memUV + vec2(-tap.x, 0.0)).rgb +
    texture(uWorld, memUV + vec2(0.0,  tap.y)).rgb +
    texture(uWorld, memUV + vec2(0.0, -tap.y)).rgb) * 0.25;
  remembered = max(remembered + (remembered - blur) * (uEdgeGain * rot), vec3(0.0));

  remembered = desaturate(remembered, 1.0 - mix(uSatFresh, uSatRotten, rot));
  remembered *= mix(uMemBrightFresh, uMemBrightRotten, rot);

  // Never been here, never lit it: nothing to remember, and the darkness in
  // front of you stays absolutely black.
  finalColor = vec4(mix(remembered * seen, trueLayer, lit), 1.0);
}
`;
