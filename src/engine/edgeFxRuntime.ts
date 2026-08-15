import { sampleClosedCurve } from './bezier';
import { applyEffectSequence, effectSequenceRenderTime } from './effectSequence';
import { VfxRenderer } from './renderer';
import type { SceneMaskNode } from './scene';
import { getSceneState } from './sceneStore';
import type { EdgeFxMode, EffectSettings, RenderState, Vec2 } from './types';

const VERTEX_SHADER = `#version 300 es
precision highp float;
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);
out vec2 vUv;
void main() {
  vec2 p = POSITIONS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const EDGE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uViewport;
uniform float uTime;
uniform vec2 uMaskCenter;
uniform float uMaskScale;
uniform float uMaskRotation;
uniform int uMaskType;
uniform float uHandSpeed;
uniform float uGlow;
uniform int uMode;
uniform float uSpeed;
uniform float uDensity;
uniform int uTrailCount;
uniform vec3 uTrail[32];
uniform int uCustomCount;
uniform vec2 uCustom[64];
uniform float uCustomExpansion;

vec2 rotate2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

float capsuleSdf(vec2 p, vec2 a, vec2 b, float r) {
  return segmentDistance(p, a, b) - r;
}

float customMaskSdf(vec2 metricPoint, float scale) {
  if (uCustomCount < 3) return length(metricPoint) - scale;
  vec2 q = metricPoint / max(0.03, scale);
  float best = 10.0;
  bool inside = false;
  for (int i = 0; i < 64; i++) {
    if (i >= uCustomCount) break;
    int nextIndex = i + 1;
    if (nextIndex >= uCustomCount) nextIndex = 0;
    vec2 a = uCustom[i];
    vec2 b = uCustom[nextIndex];
    best = min(best, segmentDistance(q, a, b));
    bool straddles = (a.y > q.y) != (b.y > q.y);
    if (straddles) {
      float denom = b.y - a.y;
      if (abs(denom) < 0.00001) denom = denom < 0.0 ? -0.00001 : 0.00001;
      float crossingX = (b.x - a.x) * (q.y - a.y) / denom + a.x;
      if (q.x < crossingX) inside = !inside;
    }
  }
  float signedDistance = (inside ? -best : best) * scale;
  return signedDistance - uCustomExpansion * scale;
}

float maskSdf(vec2 uv) {
  float aspect = uViewport.x / max(1.0, uViewport.y);
  vec2 p = uv - uMaskCenter;
  p.x *= aspect;
  p = rotate2(p, -uMaskRotation);
  float r = max(0.03, uMaskScale);

  if (uMaskType == 0) return length(p) - r;
  if (uMaskType == 1) {
    float a = atan(p.y, p.x);
    float wobble = 1.0
      + 0.09 * sin(a * 3.0 + uTime * 1.25)
      + 0.055 * sin(a * 5.0 - uTime * 0.8)
      + min(uHandSpeed, 1.8) * 0.025 * sin(a * 2.0 - uTime * 3.5);
    vec2 stretched = vec2(p.x * (1.0 - min(uHandSpeed, 1.5) * 0.035), p.y);
    return length(stretched) - r * wobble;
  }
  if (uMaskType == 2) {
    vec2 oval = vec2(p.x, p.y * 1.08);
    float a = atan(oval.y, oval.x);
    float pulse = 1.0 + 0.025 * sin(uTime * 3.0) + 0.02 * sin(a * 7.0 + uTime * 1.8);
    return length(oval) - r * pulse;
  }
  if (uMaskType == 4) return customMaskSdf(p, r);

  float best = 10.0;
  if (uTrailCount == 1) {
    vec2 a = uTrail[0].xy;
    a.x *= aspect;
    vec2 q = uv;
    q.x *= aspect;
    best = length(q - a) - uTrail[0].z;
  }
  for (int i = 0; i < 31; i++) {
    if (i + 1 >= uTrailCount) break;
    vec2 a = uTrail[i].xy;
    vec2 b = uTrail[i + 1].xy;
    a.x *= aspect;
    b.x *= aspect;
    vec2 q = uv;
    q.x *= aspect;
    float rr = mix(uTrail[i].z, uTrail[i + 1].z, 0.5);
    best = min(best, capsuleSdf(q, a, b, rr));
  }
  return best;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  if (uMode == 0 || uGlow <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  float sd = maskSdf(vUv);
  float scale = max(0.12, uMaskScale);
  float core = exp(-abs(sd) * (240.0 / scale));
  float halo = exp(-abs(sd) * (72.0 / scale));
  float wide = exp(-abs(sd) * (38.0 / scale));
  float pulse = 0.78 + 0.22 * sin(uTime * (2.2 + uSpeed) + vUv.x * 7.0);
  float amount = 0.0;
  vec3 color = vec3(0.25, 0.72, 1.0);

  if (uMode == 1) {
    amount = core * 0.9 + halo * 0.42 * pulse;
    float hot = clamp(core * 1.35 + min(uHandSpeed, 2.0) * 0.18, 0.0, 1.0);
    color = mix(vec3(0.08, 0.48, 1.0), vec3(0.84, 0.98, 1.0), hot);
  } else if (uMode == 2) {
    float phase = fract(uTime * 0.13 * max(0.15, uSpeed));
    float dy = abs(vUv.y - phase);
    float scanner = exp(-dy * (34.0 + 10.0 * uDensity));
    amount = core * 0.22 + halo * (0.22 + scanner * 1.55);
    color = mix(vec3(0.05, 0.45, 0.8), vec3(0.68, 1.0, 0.92), clamp(scanner * 1.5, 0.0, 1.0));
  } else if (uMode == 3) {
    vec2 cell = floor(vUv * vec2(155.0, 92.0) * max(0.3, uDensity));
    float frame = floor(uTime * 19.0 * max(0.2, uSpeed));
    float rnd = hash21(cell + frame);
    float strand = 0.5 + 0.5 * sin((vUv.x + vUv.y) * (96.0 + uDensity * 22.0) + uTime * 24.0 * uSpeed + rnd * 6.2831);
    float flicker = smoothstep(0.55, 0.96, rnd) * strand;
    amount = core * (0.52 + flicker * 1.35) + halo * 0.24;
    color = mix(vec3(0.22, 0.35, 1.0), vec3(0.78, 0.98, 1.0), flicker);
  } else {
    vec2 grid = vec2(92.0, 54.0) * max(0.35, uDensity);
    vec2 cell = floor(vUv * grid);
    vec2 seed = vec2(hash21(cell), hash21(cell + 17.37));
    vec2 center = (cell + 0.12 + seed * 0.76) / grid;
    vec2 pixelDelta = (vUv - center) * uViewport;
    float spark = exp(-length(pixelDelta) * 0.19);
    float life = hash21(cell + floor(uTime * max(0.2, uSpeed) * 8.0));
    spark *= smoothstep(0.78, 0.98, life);
    amount = core * 0.18 + wide * spark * 1.6;
    color = mix(vec3(0.12, 0.62, 1.0), vec3(1.0, 0.95, 0.72), spark);
  }

  float alpha = clamp(amount * uGlow * (0.72 + min(uHandSpeed, 2.0) * 0.12), 0.0, 1.0);
  outColor = vec4(color, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create edge shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Edge shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create edge program');
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, EDGE_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Edge program link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

const EDGE_MODE: Record<EdgeFxMode, number> = {
  none: 0,
  neon: 1,
  scanner: 2,
  electric: 3,
  particle: 4,
};

type EdgeShape = {
  maskType: RenderState['maskType'];
  x: number;
  y: number;
  scale: number;
  rotation: number;
  handSpeed: number;
  effects: EffectSettings;
  trail: Array<Vec2 & { width: number }>;
  customMask?: Vec2[];
  customExpansion?: number;
};

class EdgePass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, private canvas: HTMLCanvasElement) {
    this.program = createProgram(gl);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create edge VAO');
    this.vao = vao;
  }

  private uniform(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name) ?? null;
  }

  render(shape: EdgeShape, timeMs: number) {
    const mode = shape.effects.edgeFxMode ?? 'neon';
    if (mode === 'none' || shape.effects.glow <= 0.001 || this.canvas.width <= 1 || this.canvas.height <= 1) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.uniform2f(this.uniform('uViewport'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniform('uTime'), timeMs / 1000);
    gl.uniform2f(this.uniform('uMaskCenter'), shape.x, 1 - shape.y);
    gl.uniform1f(this.uniform('uMaskScale'), shape.scale);
    gl.uniform1f(this.uniform('uMaskRotation'), -shape.rotation);
    const maskType = shape.maskType === 'circle' ? 0 : shape.maskType === 'blob' ? 1 : shape.maskType === 'portal' ? 2 : shape.maskType === 'trail' ? 3 : 4;
    gl.uniform1i(this.uniform('uMaskType'), maskType);
    gl.uniform1f(this.uniform('uHandSpeed'), shape.handSpeed);
    gl.uniform1f(this.uniform('uGlow'), shape.effects.glow);
    gl.uniform1i(this.uniform('uMode'), EDGE_MODE[mode]);
    gl.uniform1f(this.uniform('uSpeed'), Math.max(0.05, shape.effects.edgeFxSpeed ?? 1));
    gl.uniform1f(this.uniform('uDensity'), Math.max(0.1, shape.effects.edgeFxDensity ?? 1));
    gl.uniform1f(this.uniform('uCustomExpansion'), shape.customExpansion ?? 0);

    const trail = shape.trail.slice(-32);
    const trailFlat = new Float32Array(32 * 3);
    trail.forEach((point, index) => {
      trailFlat[index * 3] = point.x;
      trailFlat[index * 3 + 1] = 1 - point.y;
      trailFlat[index * 3 + 2] = point.width;
    });
    gl.uniform1i(this.uniform('uTrailCount'), trail.length);
    gl.uniform3fv(this.uniform('uTrail[0]'), trailFlat);

    const custom = (shape.customMask ?? []).slice(0, 64);
    const customFlat = new Float32Array(64 * 2);
    custom.forEach((point, index) => {
      customFlat[index * 2] = point.x;
      customFlat[index * 2 + 1] = -point.y;
    });
    gl.uniform1i(this.uniform('uCustomCount'), custom.length);
    gl.uniform2fv(this.uniform('uCustom[0]'), customFlat);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}

const passes = new WeakMap<VfxRenderer, EdgePass>();
let installed = false;

function rendererCanvas(renderer: VfxRenderer) {
  return (renderer as unknown as { canvas: HTMLCanvasElement }).canvas;
}

function shapeFromState(state: RenderState): EdgeShape {
  return {
    maskType: state.maskType,
    x: state.transform.x,
    y: state.transform.y,
    scale: state.transform.scale,
    rotation: state.transform.rotation,
    handSpeed: state.handSpeed,
    effects: state.effects,
    trail: state.trail,
    customMask: state.customMask,
    customExpansion: state.customExpansion,
  };
}

function shapeFromNode(node: SceneMaskNode, base: RenderState, selectedMaskId?: string): EdgeShape {
  const custom = node.geometry.kind === 'custom' ? node.geometry : undefined;
  return {
    maskType: node.geometry.kind,
    x: node.transform.x,
    y: node.transform.y,
    scale: node.transform.scale,
    rotation: node.transform.rotation,
    handSpeed: node.id === selectedMaskId ? base.handSpeed : 0,
    effects: node.effects,
    trail: [],
    customMask: custom ? sampleClosedCurve(custom.curve, 64) : undefined,
    customExpansion: custom?.expansion,
  };
}

export function installEdgeFxRuntime() {
  if (installed) return;
  installed = true;

  const previousRender = VfxRenderer.prototype.render;
  const previousDispose = VfxRenderer.prototype.dispose;

  VfxRenderer.prototype.render = function renderWithStandaloneEdgeFx(
    camera: HTMLVideoElement,
    alternate: TexImageSource | undefined,
    state: RenderState,
  ) {
    const result = previousRender.call(this, camera, alternate, state);
    const canvas = rendererCanvas(this);
    if (!canvas || canvas.width <= 1 || canvas.height <= 1) return result;

    let pass = passes.get(this);
    if (!pass) {
      const gl = canvas.getContext('webgl2');
      if (!gl) return result;
      pass = new EdgePass(gl, canvas);
      passes.set(this, pass);
    }

    const sceneState = getSceneState();
    if (sceneState.enabled && sceneState.scene.nodes.some((node) => node.visible)) {
      const timeMs = effectSequenceRenderTime(state.time);
      const nodes = applyEffectSequence(sceneState.scene.nodes, timeMs);
      for (const node of nodes) {
        if (!node.visible) continue;
        pass.render(shapeFromNode(node, state, sceneState.scene.selectedMaskId), state.time);
      }
    } else {
      pass.render(shapeFromState(state), state.time);
    }
    return result;
  };

  VfxRenderer.prototype.dispose = function disposeWithEdgeFx() {
    passes.get(this)?.dispose();
    passes.delete(this);
    return previousDispose.call(this);
  };
}
