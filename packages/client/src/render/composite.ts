import { Geometry, Mesh, Shader } from 'pixi.js';
import type { RenderTexture } from 'pixi.js';

/**
 * The composite pass (§24.2, stages 5 and 9).
 *
 * Takes the albedo buffer (the world drawn in full colour, unlit) and the light
 * buffer (every light's coloured falloff, clipped to its visibility polygon) and
 * multiplies them, then applies a filmic rolloff.
 *
 * The rolloff is the whole point. The previous renderer used the light field as
 * a *mask*, which has two fatal properties: light can only ever be white, and
 * accumulation clips — so the fire's centre saturated to a flat white disc and
 * the flame inside it was invisible. `1 - exp(-x)` keeps the falloff intact
 * while asymptotically approaching white instead of hitting it, so a bright fire
 * stays a *colour*.
 *
 * WebGL is forced in Stage.init so there is one shader language here rather than
 * a WGSL variant to keep in sync.
 */
export class Composite {
  readonly mesh: Mesh<Geometry, Shader>;

  constructor(world: RenderTexture, light: RenderTexture) {
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
        settings: {
          uExposure: { value: 1.35, type: 'f32' },
          uAmbient: { value: 0.018, type: 'f32' },
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
  rebind(world: RenderTexture, light: RenderTexture): void {
    const res = this.mesh.shader!.resources;
    res['uWorld'] = world.source;
    res['uWorldSampler'] = world.source.style;
    res['uLight'] = light.source;
    res['uLightSampler'] = light.source.style;
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

uniform float uExposure;
uniform float uAmbient;

void main() {
  vec4 albedo = texture(uWorld, vUV);
  vec3 light = texture(uLight, vUV).rgb;

  // A trace of ambient keeps unlit ground from being a dead black rectangle.
  // Far too dim to read anything by — it exists so the dark has texture.
  vec3 lit = albedo.rgb * (light + uAmbient);

  // Filmic rolloff. Approaches white asymptotically instead of clipping, which
  // is what stops a roaring fire from becoming a featureless white disc.
  vec3 mapped = vec3(1.0) - exp(-lit * uExposure);

  finalColor = vec4(mapped, 1.0);
}
`;
