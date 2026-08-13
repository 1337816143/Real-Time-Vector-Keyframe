import type { RenderState } from './types';

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

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uCamera;
uniform sampler2D uAlternate;
uniform vec2 uViewport;
uniform vec2 uCameraSize;
uniform vec2 uAltSize;
uniform float uTime;
uniform float uMirror;
uniform vec2 uMaskCenter;
uniform float uMaskScale;
uniform float uMaskRotation;
uniform int uMaskType;
uniform float uHandSpeed;
uniform float uRgbSplit;
uniform float uRipple;
uniform float uPixelate;
uniform float uDistortion;
uniform float uGlow;
uniform float uInvertMask;
uniform float uUseAlternate;
uniform vec2 uHover;
uniform float uHoverVisible;
uniform int uGestureState;
uniform int uTrailCount;
uniform vec3 uTrail[32];

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

  if (uMaskType == 0) {
    return length(p) - r;
  }

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
    vec2 a = uTrail[0].xy - vec2(0.5);
    a.x *= aspect;
    vec2 q = uv - vec2(0.5);
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

vec3 sampleEffect(vec2 uv) {
  vec2 eUv = uv;
  vec2 centered = eUv - uMaskCenter;
  float d = length(centered);
  float ripple = sin(d * 42.0 - uTime * 5.0) * uRipple * exp(-d * 2.8);
  eUv += normalize(centered + vec2(0.00001)) * ripple;
  eUv += centered * (uDistortion * (0.4 + 0.6 * sin(uTime * 2.0 + d * 18.0)));

  if (uPixelate > 1.0) {
    float cells = max(8.0, uPixelate);
    vec2 grid = vec2(cells, cells * uViewport.y / max(uViewport.x, 1.0));
    eUv = (floor(eUv * grid) + 0.5) / grid;
  }

  vec2 altUv = coverUv(eUv, uAltSize);
  vec2 camUv = coverUv(eUv, uCameraSize);
  if (uMirror > 0.5) camUv.x = 1.0 - camUv.x;

  vec2 split = vec2(uRgbSplit * (0.45 + min(uHandSpeed, 2.0)), 0.0);
  vec3 sourceCenter = uUseAlternate > 0.5 ? texture(uAlternate, altUv).rgb : texture(uCamera, camUv).rgb;
  if (uRgbSplit <= 0.0001) return sourceCenter;

  vec2 plusUv = uUseAlternate > 0.5 ? coverUv(eUv + split, uAltSize) : coverUv(eUv + split, uCameraSize);
  vec2 minusUv = uUseAlternate > 0.5 ? coverUv(eUv - split, uAltSize) : coverUv(eUv - split, uCameraSize);
  if (uUseAlternate < 0.5 && uMirror > 0.5) { plusUv.x = 1.0 - plusUv.x; minusUv.x = 1.0 - minusUv.x; }
  vec3 plusC = uUseAlternate > 0.5 ? texture(uAlternate, plusUv).rgb : texture(uCamera, plusUv).rgb;
  vec3 minusC = uUseAlternate > 0.5 ? texture(uAlternate, minusUv).rgb : texture(uCamera, minusUv).rgb;
  return vec3(plusC.r, sourceCenter.g, minusC.b);
}

void main() {
  vec2 camUv = coverUv(vUv, uCameraSize);
  if (uMirror > 0.5) camUv.x = 1.0 - camUv.x;
  vec3 base = texture(uCamera, camUv).rgb;
  vec3 effect = sampleEffect(vUv);

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

export class VfxRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private cameraTexture: WebGLTexture;
  private alternateTexture: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private cameraSize: [number, number] = [1280, 720];
  private altSize: [number, number] = [1280, 720];
  private renderScale = 1;
  private mirror = true;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is unavailable on this device/browser.');
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to create WebGL program');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
    this.program = program;
    this.cameraTexture = createTexture(gl);
    this.alternateTexture = createTexture(gl);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create VAO');
    this.vao = vao;
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

  resize() {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio * this.renderScale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio * this.renderScale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private upload(texture: WebGLTexture, source: TexImageSource, size: [number, number]) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return;
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
  }

  render(camera: HTMLVideoElement, alternate: TexImageSource | undefined, state: RenderState) {
    if (camera.readyState < 2) return;
    this.resize();
    const gl = this.gl;
    this.upload(this.cameraTexture, camera, this.cameraSize);
    this.upload(this.alternateTexture, alternate ?? camera, this.altSize);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.alternateTexture);

    const uniform = (name: string) => gl.getUniformLocation(this.program, name);
    gl.uniform1i(uniform('uCamera'), 0);
    gl.uniform1i(uniform('uAlternate'), 1);
    gl.uniform2f(uniform('uViewport'), this.canvas.width, this.canvas.height);
    gl.uniform2f(uniform('uCameraSize'), this.cameraSize[0], this.cameraSize[1]);
    gl.uniform2f(uniform('uAltSize'), this.altSize[0], this.altSize[1]);
    gl.uniform1f(uniform('uTime'), state.time / 1000);
    gl.uniform1f(uniform('uMirror'), this.mirror ? 1 : 0);
    gl.uniform2f(uniform('uMaskCenter'), state.transform.x, 1 - state.transform.y);
    gl.uniform1f(uniform('uMaskScale'), state.transform.scale);
    gl.uniform1f(uniform('uMaskRotation'), -state.transform.rotation);
    gl.uniform1i(uniform('uMaskType'), state.maskType === 'circle' ? 0 : state.maskType === 'blob' ? 1 : state.maskType === 'portal' ? 2 : 3);
    gl.uniform1f(uniform('uHandSpeed'), state.handSpeed);
    gl.uniform1f(uniform('uRgbSplit'), state.effects.rgbSplit);
    gl.uniform1f(uniform('uRipple'), state.effects.ripple);
    gl.uniform1f(uniform('uPixelate'), state.effects.pixelate);
    gl.uniform1f(uniform('uDistortion'), state.effects.distortion);
    gl.uniform1f(uniform('uGlow'), state.effects.glow);
    gl.uniform1f(uniform('uInvertMask'), state.effects.invertMask ? 1 : 0);
    gl.uniform1f(uniform('uUseAlternate'), state.effects.useAlternateMedia ? 1 : 0);
    const hover = state.hoverPoint;
    gl.uniform2f(uniform('uHover'), hover?.x ?? -2, hover ? 1 - hover.y : -2);
    gl.uniform1f(uniform('uHoverVisible'), hover ? 1 : 0);
    gl.uniform1i(uniform('uGestureState'), ['IDLE', 'HOVER', 'PINCH_START', 'GRABBED', 'DRAGGING', 'TWO_HAND_TRANSFORM', 'RELEASE', 'LOST'].indexOf(state.gestureState));

    const trail = state.trail.slice(-32);
    const flat = new Float32Array(32 * 3);
    trail.forEach((point, index) => {
      flat[index * 3] = point.x;
      flat[index * 3 + 1] = 1 - point.y;
      flat[index * 3 + 2] = point.width;
    });
    gl.uniform1i(uniform('uTrailCount'), trail.length);
    gl.uniform3fv(uniform('uTrail[0]'), flat);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.cameraTexture);
    gl.deleteTexture(this.alternateTexture);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
