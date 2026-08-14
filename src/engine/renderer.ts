import type {
  EffectBlendMode,
  EffectNodeType,
  EffectTransitionType,
  RenderState,
  TemporalMode,
} from './types';

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

const SOURCE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCamera;
uniform sampler2D uAlternate;
uniform sampler2D uHistoryA;
uniform sampler2D uHistoryB;
uniform vec2 uViewport;
uniform vec2 uCameraSize;
uniform vec2 uAltSize;
uniform float uMirror;
uniform float uUseAlternate;
uniform int uTemporalMode;
uniform float uTemporalMix;

vec2 coverUv(vec2 uv, vec2 sourceSize) {
  float viewportAspect = uViewport.x / max(1.0, uViewport.y);
  float sourceAspect = sourceSize.x / max(1.0, sourceSize.y);
  vec2 outUv = uv;
  if (sourceAspect > viewportAspect) {
    float scale = viewportAspect / sourceAspect;
    outUv.x = (uv.x - 0.5) * scale + 0.5;
  } else {
    float scale = sourceAspect / viewportAspect;
    outUv.y = (uv.y - 0.5) * scale + 0.5;
  }
  return outUv;
}

vec2 cameraUv(vec2 uv) {
  vec2 outUv = coverUv(uv, uCameraSize);
  if (uMirror > 0.5) outUv.x = 1.0 - outUv.x;
  return clamp(outUv, vec2(0.001), vec2(0.999));
}

vec3 cameraNow(vec2 uv) { return texture(uCamera, cameraUv(uv)).rgb; }
vec3 historyA(vec2 uv) { return texture(uHistoryA, cameraUv(uv)).rgb; }
vec3 historyB(vec2 uv) { return texture(uHistoryB, cameraUv(uv)).rgb; }
vec3 alternate(vec2 uv) { return texture(uAlternate, clamp(coverUv(uv, uAltSize), vec2(0.001), vec2(0.999))).rgb; }

void main() {
  vec3 color;
  if (uTemporalMode == 1) {
    color = historyA(vUv);
  } else if (uTemporalMode == 2) {
    vec3 live = cameraNow(vUv);
    vec3 first = mix(live, historyA(vUv), clamp(uTemporalMix * 0.72, 0.0, 0.85));
    color = mix(first, historyB(vUv), clamp(uTemporalMix * 0.28, 0.0, 0.42));
  } else if (uTemporalMode == 3) {
    color = mix(cameraNow(vUv), historyA(vUv), clamp(uTemporalMix, 0.0, 0.82));
  } else {
    color = uUseAlternate > 0.5 ? alternate(vUv) : cameraNow(vUv);
  }
  outColor = vec4(color, 1.0);
}`;

const EFFECT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uInput;
uniform vec2 uViewport;
uniform vec2 uMaskCenter;
uniform float uTime;
uniform float uHandSpeed;
uniform int uEffectType;
uniform float uAmount;
uniform float uIntensity;
uniform float uOpacity;
uniform int uBlendMode;

vec3 sampleInput(vec2 uv) {
  return texture(uInput, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

vec3 blendFx(vec3 base, vec3 fx, int mode) {
  if (mode == 1) return min(vec3(1.0), base + fx);
  if (mode == 2) return 1.0 - (1.0 - base) * (1.0 - fx);
  if (mode == 3) return base * fx;
  return fx;
}

void main() {
  vec3 base = sampleInput(vUv);
  float intensity = max(0.0, uIntensity);
  if (intensity <= 0.0001 || uOpacity <= 0.0001) {
    outColor = vec4(base, 1.0);
    return;
  }

  vec3 processed = base;
  if (uEffectType == 0) {
    float splitAmount = uAmount * intensity * (0.45 + min(uHandSpeed, 2.0));
    vec2 offset = vec2(splitAmount, 0.0);
    vec3 plusC = sampleInput(vUv + offset);
    vec3 minusC = sampleInput(vUv - offset);
    processed = vec3(plusC.r, base.g, minusC.b);
  } else if (uEffectType == 1) {
    vec2 centered = vUv - uMaskCenter;
    float d = length(centered);
    float wave = sin(d * 42.0 - uTime * 5.0) * uAmount * intensity * exp(-d * 2.8);
    vec2 warped = vUv + normalize(centered + vec2(0.00001)) * wave;
    processed = sampleInput(warped);
  } else if (uEffectType == 2) {
    if (uAmount > 1.0) {
      float cells = max(5.0, uAmount / max(0.18, intensity));
      vec2 grid = vec2(cells, cells * uViewport.y / max(uViewport.x, 1.0));
      vec2 pixelUv = (floor(vUv * grid) + 0.5) / grid;
      processed = sampleInput(pixelUv);
    }
  } else if (uEffectType == 3) {
    vec2 centered = vUv - uMaskCenter;
    float d = length(centered);
    float strength = uAmount * intensity * (0.4 + 0.6 * sin(uTime * 2.0 + d * 18.0));
    processed = sampleInput(vUv + centered * strength);
  }

  vec3 blended = blendFx(base, processed, uBlendMode);
  outColor = vec4(mix(base, blended, clamp(uOpacity, 0.0, 1.0)), 1.0);
}`;

const COMPOSITE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCamera;
uniform sampler2D uEffect;
uniform sampler2D uPreviousEffect;
uniform vec2 uViewport;
uniform vec2 uCameraSize;
uniform float uTime;
uniform float uMirror;
uniform vec2 uMaskCenter;
uniform float uMaskScale;
uniform float uMaskRotation;
uniform int uMaskType;
uniform float uHandSpeed;
uniform float uGlow;
uniform float uInvertMask;
uniform vec2 uHover;
uniform float uHoverVisible;
uniform int uGestureState;
uniform int uTrailCount;
uniform vec3 uTrail[32];
uniform int uTransitionType;
uniform float uTransitionProgress;
uniform float uTransitionDirection;

vec2 coverUv(vec2 uv, vec2 sourceSize) {
  float viewportAspect = uViewport.x / max(1.0, uViewport.y);
  float sourceAspect = sourceSize.x / max(1.0, sourceSize.y);
  vec2 outUv = uv;
  if (sourceAspect > viewportAspect) {
    float scale = viewportAspect / sourceAspect;
    outUv.x = (uv.x - 0.5) * scale + 0.5;
  } else {
    float scale = sourceAspect / viewportAspect;
    outUv.y = (uv.y - 0.5) * scale + 0.5;
  }
  return outUv;
}

vec2 cameraUv(vec2 uv) {
  vec2 outUv = coverUv(uv, uCameraSize);
  if (uMirror > 0.5) outUv.x = 1.0 - outUv.x;
  return clamp(outUv, vec2(0.001), vec2(0.999));
}

vec2 rotate2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

float capsuleSdf(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h) - r;
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

float liquidNoise(vec2 uv) {
  return 0.5
    + sin(uv.y * 28.0 + uTime * 2.5) * 0.16
    + sin(uv.x * 19.0 - uv.y * 11.0 + uTime * 1.7) * 0.11
    + sin((uv.x + uv.y) * 43.0 - uTime * 3.1) * 0.06;
}

vec3 transitionEffect(vec2 uv) {
  vec3 previous = texture(uPreviousEffect, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  vec3 next = texture(uEffect, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  float p = clamp(uTransitionProgress, 0.0, 1.0);
  if (uTransitionType == 0) return next;
  if (uTransitionType == 1) return mix(previous, next, smoothstep(0.0, 1.0, p));
  if (uTransitionType == 2) {
    float axis = uTransitionDirection >= 0.0 ? uv.x : 1.0 - uv.x;
    float reveal = 1.0 - smoothstep(p - 0.055, p + 0.055, axis);
    return mix(previous, next, reveal);
  }
  if (uTransitionType == 3) {
    float energy = sin(p * 3.14159265);
    float band = floor(uv.y * 17.0);
    float jitter = sin(band * 14.17 + uTime * 27.0) * 0.018 * energy;
    vec2 shift = vec2(jitter, 0.0);
    vec3 a = texture(uPreviousEffect, clamp(uv - shift, vec2(0.001), vec2(0.999))).rgb;
    vec3 b = texture(uEffect, clamp(uv + shift, vec2(0.001), vec2(0.999))).rgb;
    vec3 mixed = mix(a, b, p);
    mixed.r = mix(mixed.r, texture(uEffect, clamp(uv + shift * 1.8, vec2(0.001), vec2(0.999))).r, energy * 0.65);
    mixed.b = mix(mixed.b, texture(uPreviousEffect, clamp(uv - shift * 1.6, vec2(0.001), vec2(0.999))).b, energy * 0.5);
    return mixed;
  }
  if (uTransitionType == 4) {
    vec3 mixed = mix(previous, next, p);
    return mixed + vec3(1.0) * sin(p * 3.14159265) * 0.7;
  }
  float reveal = smoothstep(liquidNoise(uv) - 0.12, liquidNoise(uv) + 0.12, p);
  return mix(previous, next, reveal);
}

void main() {
  vec3 base = texture(uCamera, cameraUv(vUv)).rgb;
  vec3 effect = transitionEffect(vUv);
  float sd = maskSdf(vUv);
  float feather = 0.0045 + min(uHandSpeed, 2.0) * 0.0015;
  float maskAlpha = 1.0 - smoothstep(-feather, feather, sd);
  if (uInvertMask > 0.5) maskAlpha = 1.0 - maskAlpha;
  vec3 color = mix(base, effect, maskAlpha);

  float edge = exp(-abs(sd) * (125.0 / max(0.12, uMaskScale))) * uGlow;
  float hot = clamp(edge * (0.42 + min(uHandSpeed, 2.0) * 0.32), 0.0, 1.0);
  vec3 edgeColor = mix(vec3(0.16, 0.55, 1.0), vec3(0.84, 0.98, 1.0), hot);
  color += edgeColor * edge * (0.24 + 0.24 * min(uHandSpeed, 1.7));

  if (uHoverVisible > 0.5) {
    float aspect = uViewport.x / max(1.0, uViewport.y);
    vec2 hp = vUv - uHover;
    hp.x *= aspect;
    float hd = length(hp);
    float ring = exp(-abs(hd - 0.016) * 620.0);
    float core = exp(-hd * 210.0) * 0.38;
    float active = uGestureState >= 2 ? 1.0 : 0.45;
    color += vec3(0.72, 0.94, 1.0) * (ring + core) * active;
  }

  color = color / (1.0 + max(color - 1.0, 0.0));
  outColor = vec4(color, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string) {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL program');
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Shader link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createTexture(gl: WebGL2RenderingContext) {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Unable to create WebGL texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 10, 14, 255]));
  return texture;
}

type HistorySlot = {
  texture: WebGLTexture;
  timestamp: number;
  initialized: boolean;
};

type RenderTarget = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

const TEMPORAL_MODE: Record<TemporalMode, number> = {
  none: 0,
  timeWindow: 1,
  echo: 2,
  afterImage: 3,
};

const EFFECT_TYPE: Record<EffectNodeType, number> = {
  rgbSplit: 0,
  ripple: 1,
  pixelate: 2,
  distortion: 3,
};

const BLEND_MODE: Record<EffectBlendMode, number> = {
  normal: 0,
  add: 1,
  screen: 2,
  multiply: 3,
};

const TRANSITION_TYPE: Record<EffectTransitionType, number> = {
  crossFade: 1,
  directionalWipe: 2,
  glitch: 3,
  flash: 4,
  liquid: 5,
};

export class VfxRenderer {
  private gl: WebGL2RenderingContext;
  private sourceProgram: WebGLProgram;
  private effectProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private cameraTexture: WebGLTexture;
  private alternateTexture: WebGLTexture;
  private history: HistorySlot[];
  private historyCursor = 0;
  private lastHistoryCapture = -Infinity;
  private readonly historyIntervalMs = 150;
  private vao: WebGLVertexArrayObject;
  private ping: RenderTarget;
  private pong: RenderTarget;
  private transitionSnapshot: RenderTarget;
  private lastProcessedTarget?: RenderTarget;
  private transitionStart = 0;
  private transitionDuration = 0;
  private transitionType: EffectTransitionType = 'crossFade';
  private transitionDirection = 1;
  private cameraSize: [number, number] = [1280, 720];
  private altSize: [number, number] = [1280, 720];
  private renderScale = 1;
  private mirror = true;
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is unavailable on this device/browser.');
    this.gl = gl;
    this.sourceProgram = createProgram(gl, SOURCE_SHADER);
    this.effectProgram = createProgram(gl, EFFECT_SHADER);
    this.compositeProgram = createProgram(gl, COMPOSITE_SHADER);
    this.cameraTexture = createTexture(gl);
    this.alternateTexture = createTexture(gl);
    this.history = Array.from({ length: 15 }, () => ({ texture: createTexture(gl), timestamp: 0, initialized: false }));
    this.ping = this.createRenderTarget();
    this.pong = this.createRenderTarget();
    this.transitionSnapshot = this.createRenderTarget();
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create VAO');
    this.vao = vao;
  }

  private createRenderTarget(): RenderTarget {
    const gl = this.gl;
    const texture = createTexture(gl);
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Unable to create framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width: 1, height: 1 };
  }

  private resizeTarget(target: RenderTarget, width: number, height: number) {
    if (target.width === width && target.height === height) return false;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Effect framebuffer incomplete: ${status}`);
    target.width = width;
    target.height = height;
    return true;
  }

  private uniform(program: WebGLProgram, name: string) {
    let map = this.uniforms.get(program);
    if (!map) {
      map = new Map();
      this.uniforms.set(program, map);
    }
    if (!map.has(name)) map.set(name, this.gl.getUniformLocation(program, name));
    return map.get(name) ?? null;
  }

  private bindTexture(unit: number, texture: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  private drawTo(framebuffer: WebGLFramebuffer | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setMirror(value: boolean) {
    this.mirror = value;
  }

  setRenderScale(value: number) {
    this.renderScale = Math.min(1, Math.max(0.45, value));
  }

  getRenderScale() {
    return this.renderScale;
  }

  getHistoryDepthMs(now = performance.now()) {
    const initialized = this.history.filter((slot) => slot.initialized);
    if (!initialized.length) return 0;
    return Math.max(0, now - Math.min(...initialized.map((slot) => slot.timestamp)));
  }

  beginTransition(type: EffectTransitionType, durationMs = 650, direction: -1 | 1 = 1, now = performance.now()) {
    const source = this.lastProcessedTarget;
    if (!source || this.canvas.width <= 1 || this.canvas.height <= 1) return false;
    this.resizeTarget(this.transitionSnapshot, this.canvas.width, this.canvas.height);
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.transitionSnapshot.framebuffer);
    gl.blitFramebuffer(
      0, 0, this.canvas.width, this.canvas.height,
      0, 0, this.canvas.width, this.canvas.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.transitionType = type;
    this.transitionDuration = Math.max(80, durationMs);
    this.transitionDirection = direction;
    this.transitionStart = now;
    return true;
  }

  resize() {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio * this.renderScale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio * this.renderScale));
    const canvasChanged = this.canvas.width !== width || this.canvas.height !== height;
    if (canvasChanged) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.resizeTarget(this.ping, width, height);
    this.resizeTarget(this.pong, width, height);
    const snapshotChanged = this.resizeTarget(this.transitionSnapshot, width, height);
    if (canvasChanged || snapshotChanged) this.transitionStart = 0;
  }

  private upload(texture: WebGLTexture, source: TexImageSource, size: [number, number]) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return false;
    }
    if (source instanceof HTMLVideoElement) {
      size[0] = source.videoWidth || size[0];
      size[1] = source.videoHeight || size[1];
    } else if (source instanceof HTMLImageElement) {
      size[0] = source.naturalWidth || size[0];
      size[1] = source.naturalHeight || size[1];
    } else if (source instanceof HTMLCanvasElement) {
      size[0] = source.width || size[0];
      size[1] = source.height || size[1];
    }
    return true;
  }

  private captureHistory(camera: HTMLVideoElement, now: number) {
    if (now - this.lastHistoryCapture < this.historyIntervalMs) return;
    const slot = this.history[this.historyCursor];
    if (this.upload(slot.texture, camera, this.cameraSize)) {
      slot.timestamp = now;
      slot.initialized = true;
      this.historyCursor = (this.historyCursor + 1) % this.history.length;
      this.lastHistoryCapture = now;
    }
  }

  private historyTexture(now: number, delayMs: number) {
    const target = now - Math.max(0, delayMs);
    let best: HistorySlot | undefined;
    let distance = Infinity;
    for (const slot of this.history) {
      if (!slot.initialized) continue;
      const next = Math.abs(slot.timestamp - target);
      if (next < distance) {
        distance = next;
        best = slot;
      }
    }
    return best?.texture ?? this.cameraTexture;
  }

  private effectAmount(state: RenderState, type: EffectNodeType) {
    if (type === 'rgbSplit') return state.effects.rgbSplit;
    if (type === 'ripple') return state.effects.ripple;
    if (type === 'pixelate') return state.effects.pixelate;
    return state.effects.distortion;
  }

  private renderSource(state: RenderState, historyA: WebGLTexture, historyB: WebGLTexture) {
    const gl = this.gl;
    const program = this.sourceProgram;
    gl.useProgram(program);
    this.bindTexture(0, this.cameraTexture);
    this.bindTexture(1, this.alternateTexture);
    this.bindTexture(2, historyA);
    this.bindTexture(3, historyB);
    gl.uniform1i(this.uniform(program, 'uCamera'), 0);
    gl.uniform1i(this.uniform(program, 'uAlternate'), 1);
    gl.uniform1i(this.uniform(program, 'uHistoryA'), 2);
    gl.uniform1i(this.uniform(program, 'uHistoryB'), 3);
    gl.uniform2f(this.uniform(program, 'uViewport'), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniform(program, 'uCameraSize'), this.cameraSize[0], this.cameraSize[1]);
    gl.uniform2f(this.uniform(program, 'uAltSize'), this.altSize[0], this.altSize[1]);
    gl.uniform1f(this.uniform(program, 'uMirror'), this.mirror ? 1 : 0);
    gl.uniform1f(this.uniform(program, 'uUseAlternate'), state.effects.useAlternateMedia ? 1 : 0);
    gl.uniform1i(this.uniform(program, 'uTemporalMode'), TEMPORAL_MODE[state.effects.temporalMode]);
    gl.uniform1f(this.uniform(program, 'uTemporalMix'), state.effects.temporalMix);
    this.drawTo(this.ping.framebuffer);
  }

  private renderEffects(state: RenderState) {
    const gl = this.gl;
    const program = this.effectProgram;
    const active = state.effects.effectStack.filter((node) => node.enabled && node.opacity > 0 && node.intensity > 0);
    let inputTarget = this.ping;
    let writeTarget = this.pong;

    for (const node of active) {
      gl.useProgram(program);
      this.bindTexture(0, inputTarget.texture);
      gl.uniform1i(this.uniform(program, 'uInput'), 0);
      gl.uniform2f(this.uniform(program, 'uViewport'), this.canvas.width, this.canvas.height);
      gl.uniform2f(this.uniform(program, 'uMaskCenter'), state.transform.x, 1 - state.transform.y);
      gl.uniform1f(this.uniform(program, 'uTime'), state.time / 1000);
      gl.uniform1f(this.uniform(program, 'uHandSpeed'), state.handSpeed);
      gl.uniform1i(this.uniform(program, 'uEffectType'), EFFECT_TYPE[node.type]);
      gl.uniform1f(this.uniform(program, 'uAmount'), this.effectAmount(state, node.type));
      gl.uniform1f(this.uniform(program, 'uIntensity'), node.intensity);
      gl.uniform1f(this.uniform(program, 'uOpacity'), node.opacity);
      gl.uniform1i(this.uniform(program, 'uBlendMode'), BLEND_MODE[node.blendMode]);
      this.drawTo(writeTarget.framebuffer);
      inputTarget = writeTarget;
      writeTarget = writeTarget === this.pong ? this.ping : this.pong;
    }

    return inputTarget;
  }

  private transitionProgress(now: number) {
    if (!this.transitionStart || this.transitionDuration <= 0) return 1;
    const progress = Math.min(1, Math.max(0, (now - this.transitionStart) / this.transitionDuration));
    if (progress >= 1) this.transitionStart = 0;
    return progress;
  }

  private renderComposite(state: RenderState, effectTarget: RenderTarget) {
    const gl = this.gl;
    const program = this.compositeProgram;
    const progress = this.transitionProgress(state.time);
    const transitioning = this.transitionStart > 0 || progress < 1;
    gl.useProgram(program);
    this.bindTexture(0, this.cameraTexture);
    this.bindTexture(1, effectTarget.texture);
    this.bindTexture(2, transitioning ? this.transitionSnapshot.texture : effectTarget.texture);
    gl.uniform1i(this.uniform(program, 'uCamera'), 0);
    gl.uniform1i(this.uniform(program, 'uEffect'), 1);
    gl.uniform1i(this.uniform(program, 'uPreviousEffect'), 2);
    gl.uniform2f(this.uniform(program, 'uViewport'), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniform(program, 'uCameraSize'), this.cameraSize[0], this.cameraSize[1]);
    gl.uniform1f(this.uniform(program, 'uTime'), state.time / 1000);
    gl.uniform1f(this.uniform(program, 'uMirror'), this.mirror ? 1 : 0);
    gl.uniform2f(this.uniform(program, 'uMaskCenter'), state.transform.x, 1 - state.transform.y);
    gl.uniform1f(this.uniform(program, 'uMaskScale'), state.transform.scale);
    gl.uniform1f(this.uniform(program, 'uMaskRotation'), -state.transform.rotation);
    gl.uniform1i(this.uniform(program, 'uMaskType'), state.maskType === 'circle' ? 0 : state.maskType === 'blob' ? 1 : state.maskType === 'portal' ? 2 : 3);
    gl.uniform1f(this.uniform(program, 'uHandSpeed'), state.handSpeed);
    gl.uniform1f(this.uniform(program, 'uGlow'), state.effects.glow);
    gl.uniform1f(this.uniform(program, 'uInvertMask'), state.effects.invertMask ? 1 : 0);
    const hover = state.hoverPoint;
    gl.uniform2f(this.uniform(program, 'uHover'), hover?.x ?? -2, hover ? 1 - hover.y : -2);
    gl.uniform1f(this.uniform(program, 'uHoverVisible'), hover ? 1 : 0);
    gl.uniform1i(this.uniform(program, 'uGestureState'), ['IDLE', 'HOVER', 'PINCH_START', 'GRABBED', 'DRAGGING', 'TWO_HAND_TRANSFORM', 'RELEASE', 'LOST'].indexOf(state.gestureState));
    gl.uniform1i(this.uniform(program, 'uTransitionType'), transitioning ? TRANSITION_TYPE[this.transitionType] : 0);
    gl.uniform1f(this.uniform(program, 'uTransitionProgress'), transitioning ? progress : 1);
    gl.uniform1f(this.uniform(program, 'uTransitionDirection'), this.transitionDirection);

    const trail = state.trail.slice(-32);
    const flat = new Float32Array(32 * 3);
    trail.forEach((point, index) => {
      flat[index * 3] = point.x;
      flat[index * 3 + 1] = 1 - point.y;
      flat[index * 3 + 2] = point.width;
    });
    gl.uniform1i(this.uniform(program, 'uTrailCount'), trail.length);
    gl.uniform3fv(this.uniform(program, 'uTrail[0]'), flat);
    this.drawTo(null);
  }

  render(camera: HTMLVideoElement, alternate: TexImageSource | undefined, state: RenderState) {
    if (camera.readyState < 2) return;
    this.resize();
    this.upload(this.cameraTexture, camera, this.cameraSize);
    this.upload(this.alternateTexture, alternate ?? camera, this.altSize);
    this.captureHistory(camera, state.time);

    const historyA = this.historyTexture(state.time, state.effects.temporalDelayMs);
    const historyB = this.historyTexture(state.time, Math.min(2100, state.effects.temporalDelayMs * 1.65 + 180));
    this.renderSource(state, historyA, historyB);
    const processed = this.renderEffects(state);
    this.lastProcessedTarget = processed;
    this.renderComposite(state, processed);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.cameraTexture);
    gl.deleteTexture(this.alternateTexture);
    this.history.forEach((slot) => gl.deleteTexture(slot.texture));
    for (const target of [this.ping, this.pong, this.transitionSnapshot]) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    gl.deleteProgram(this.sourceProgram);
    gl.deleteProgram(this.effectProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteVertexArray(this.vao);
  }
}
