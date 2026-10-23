import { config } from './config'
import { STRIDE, type FieldBatch } from './field'

/**
 * Two-pass WebGL2 renderer.
 *  1. Field pass: every primitive adds its kernel into a half-float texture (additive blend).
 *  2. Shade pass: one full-screen triangle thresholds the field, derives surface normals
 *     from its gradient and lights it as wet black material, plus contact shadow and glow.
 * Upgrade path: swap SHADE_FS for a richer material; the field contract stays the same.
 */

const R = config.render
const f = (n: number) => n.toFixed(4)

const FIELD_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_amp;
layout(location = 3) in float a_clip;
uniform vec2 u_css;
out vec2 v_uv;
out vec2 v_pos;
out float v_amp;
flat out int v_clip;
void main() {
  v_uv = a_uv;
  v_pos = a_pos;
  v_amp = a_amp;
  v_clip = int(a_clip + 0.5);
  vec2 c = a_pos / u_css * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`

const FIELD_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_pos;
in float v_amp;
flat in int v_clip;
uniform vec4 u_clip[4]; // centre.xy, half extents.zw (CSS px)
uniform float u_clipR[4];
out vec4 o;
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d2 = dot(v_uv, v_uv);
  if (d2 >= 1.0) discard;
  float k = 1.0 - d2;
  float f = k * k * v_amp;
  if (v_clip > 0) {
    // Coating stays inside the button and follows its rounded corners.
    vec4 c = u_clip[v_clip - 1];
    f *= 1.0 - smoothstep(-3.0, 0.0, sdRoundBox(v_pos - c.xy, c.zw, u_clipR[v_clip - 1]));
  }
  o = vec4(f, 0.0, 0.0, 1.0);
}`

/** Smooth value noise, shared with the background shader. */
export const NOISE_GLSL = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`

export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const SHADE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_res;   // drawing buffer px
uniform vec2 u_css;   // CSS px
uniform float u_fieldScale;
uniform vec2 u_glow;  // CSS px, y down; also the body centre
uniform float u_time;
uniform vec4 u_matte[4]; // label boxes (centre, half size; CSS px) where highlights are muted
out vec4 o;

const float T = ${f(R.threshold)};
float field(vec2 uv) { return texture(u_field, uv).r; }
${NOISE_GLSL}
// Surface height: steep at the rim, still rising toward thick centres (never a flat plateau),
// plus slow swells and sinewy ridges anchored to the body, so thick parts catch moving streaks.
float height(vec2 uv) {
  float v = field(uv);
  float base = 1.0 - exp(-max(v - T, 0.0) / ${f(R.heightRange)});
  vec2 p = (vec2(uv.x, 1.0 - uv.y) * u_css - u_glow) * 0.03 + u_time * vec2(0.05, 0.08);
  float ridge = 1.0 - abs(noise(p * 2.6 + 4.7) * 2.0 - 1.0);
  return base + smoothstep(T, T + 1.5, v) * (0.07 * noise(p) + 0.035 * ridge * ridge);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float v = field(uv);
  float aa = fwidth(v) * 0.75 + 1e-4;

  // Faint light the creature carries across the background.
  vec2 g = vec2(uv.x, 1.0 - uv.y) * u_css - u_glow;
  float glow = ${f(R.glow)} * exp(-dot(g, g) / ${f(2 * R.glowSigma * R.glowSigma)});
  vec4 bg = vec4(vec3(0.62, 0.66, 0.74) * glow, glow);
  if (v < 0.03) { o = bg; return; }

  // Contact shadow hugging the silhouette.
  float shadow = ${f(R.shadow)} * smoothstep(0.03, T, v);
  bg = bg * (1.0 - shadow) + vec4(0.0, 0.0, 0.0, shadow);
  float a = smoothstep(T - aa, T + aa, v);
  if (a <= 0.0) { o = bg; return; }

  // Sobel gradient at 1.5-texel spacing. Bilinear filtering makes the field's gradient constant
  // inside each texel, so plain neighbour differences leave faceted, blocky highlights.
  vec2 t = 1.5 / vec2(textureSize(u_field, 0));
  float tl = height(uv + vec2(-t.x, t.y)), tc = height(uv + vec2(0.0, t.y)), tr = height(uv + t);
  float ml = height(uv - vec2(t.x, 0.0)), mr = height(uv + vec2(t.x, 0.0));
  float bl = height(uv - t), bc = height(uv - vec2(0.0, t.y)), br = height(uv + vec2(t.x, -t.y));
  vec2 grad = vec2(tr + 2.0 * mr + br - tl - 2.0 * ml - bl, tl + 2.0 * tc + tr - bl - 2.0 * bc - br) / 4.0;
  vec3 n = normalize(vec3(-grad * u_fieldScale / 3.0 * ${f(R.bump)}, 1.0));

  // Texture space is y-up, so "above" is +y.
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.5, 0.75, 0.6));   // key light, upper left
  vec3 L2 = normalize(vec3(0.8, -0.35, 0.5));  // cool rim, lower right
  float nh = max(dot(n, normalize(L + V)), 0.0);
  float spec = pow(nh, 70.0) * 1.3 + pow(nh, 12.0) * 0.12;
  float rim = pow(max(dot(n, normalize(L2 + V)), 0.0), 40.0) * 0.35;
  vec3 r = reflect(-V, n);
  float softbox = smoothstep(0.2, 0.5, r.y) * (1.0 - smoothstep(0.8, 0.97, r.y));
  float fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  float sky = smoothstep(-0.3, 0.9, r.y); // broad overhead sheen across domed surfaces
  float edge = pow(1.0 - n.z, 2.0);

  // Behind button labels the goo goes matte, so difference-blended text stays crisp white.
  vec2 css = vec2(uv.x, 1.0 - uv.y) * u_css;
  float matte = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 m = u_matte[i];
    if (m.z <= 0.0) continue;
    vec2 d = abs(css - m.xy) - m.zw;
    matte = max(matte, 1.0 - smoothstep(0.0, 8.0, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0)));
  }

  vec3 shine = vec3(0.07, 0.075, 0.09) * sky * (0.35 + fres);
  shine += vec3(0.78, 0.82, 0.9) * softbox * fres * 0.9;
  shine += vec3(1.0, 0.98, 0.95) * spec;
  shine += vec3(0.55, 0.62, 0.8) * rim;
  shine += vec3(0.14, 0.12, 0.24) * edge * 0.3; // faint oil-slick sheen toward the edges
  vec3 c = vec3(0.008, 0.008, 0.011) + vec3(0.03, 0.031, 0.038) * max(dot(n, L), 0.0);
  c += shine * (1.0 - 0.88 * matte);
  o = vec4(c, 1.0) * a + bg * (1.0 - a);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed')
  return s
}

export function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const fr = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(p, v)
  gl.attachShader(p, fr)
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(fr)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed')
  return p
}

export class SymbioteRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly fieldProg: WebGLProgram
  private readonly shadeProg: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly emptyVao: WebGLVertexArrayObject
  private readonly vbo: WebGLBuffer
  private readonly fbo: WebGLFramebuffer
  private tex: WebGLTexture | null = null
  private cssW = 1
  private cssH = 1
  private fieldScale = 1
  /** Label boxes, 4 slots of centre x, centre y, half width, half height (CSS px); 0 width = unused. */
  readonly matte = new Float32Array(16)
  private readonly u: Record<string, WebGLUniformLocation | null>

  /** Throws when WebGL2 or renderable half-float targets are unavailable; the hero then stays static. */
  constructor(private readonly canvas: HTMLCanvasElement, capacity: number) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('float render targets unavailable')
    }
    this.gl = gl
    this.fieldProg = program(gl, FIELD_VS, FIELD_FS)
    this.shadeProg = program(gl, FULLSCREEN_VS, SHADE_FS)
    this.u = {
      css: gl.getUniformLocation(this.fieldProg, 'u_css'),
      clip: gl.getUniformLocation(this.fieldProg, 'u_clip'),
      clipR: gl.getUniformLocation(this.fieldProg, 'u_clipR'),
      field: gl.getUniformLocation(this.shadeProg, 'u_field'),
      res: gl.getUniformLocation(this.shadeProg, 'u_res'),
      shadeCss: gl.getUniformLocation(this.shadeProg, 'u_css'),
      fieldScale: gl.getUniformLocation(this.shadeProg, 'u_fieldScale'),
      glow: gl.getUniformLocation(this.shadeProg, 'u_glow'),
      time: gl.getUniformLocation(this.shadeProg, 'u_time'),
      matte: gl.getUniformLocation(this.shadeProg, 'u_matte'),
    }

    this.vbo = gl.createBuffer()
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW)
    const bytes = STRIDE * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, bytes, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, bytes, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bytes, 16)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bytes, 20)
    this.emptyVao = gl.createVertexArray()
    gl.bindVertexArray(null)
    this.fbo = gl.createFramebuffer()
  }

  resize(cssW: number, cssH: number, dpr: number, fieldScale: number) {
    const { gl, canvas } = this
    this.cssW = Math.max(1, cssW)
    this.cssH = Math.max(1, cssH)
    this.fieldScale = fieldScale
    canvas.width = Math.max(1, Math.round(this.cssW * dpr))
    canvas.height = Math.max(1, Math.round(this.cssH * dpr))

    const fw = Math.max(1, Math.round(this.cssW * fieldScale))
    const fh = Math.max(1, Math.round(this.cssH * fieldScale))
    if (this.tex) gl.deleteTexture(this.tex)
    this.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    // Single-channel first; some drivers only render to RGBA half floats.
    for (const [internal, format] of [[gl.R16F, gl.RED], [gl.RGBA16F, gl.RGBA]]) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, fw, fh, 0, format, gl.HALF_FLOAT, null)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) break
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  render(batch: FieldBatch, glowX: number, glowY: number, time: number) {
    const { gl, canvas, u } = this
    const fw = Math.max(1, Math.round(this.cssW * this.fieldScale))
    const fh = Math.max(1, Math.round(this.cssH * this.fieldScale))

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, fw, fh)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (batch.count > 0) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(this.fieldProg)
      gl.uniform2f(u.css, this.cssW, this.cssH)
      gl.uniform4fv(u.clip, batch.clips)
      gl.uniform1fv(u.clipR, batch.clipRadii)
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * STRIDE)
      gl.drawArrays(gl.TRIANGLES, 0, batch.count)
      gl.disable(gl.BLEND)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(this.shadeProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(u.field, 0)
    gl.uniform2f(u.res, canvas.width, canvas.height)
    gl.uniform2f(u.shadeCss, this.cssW, this.cssH)
    gl.uniform1f(u.fieldScale, this.fieldScale)
    gl.uniform2f(u.glow, glowX, glowY)
    gl.uniform1f(u.time, time)
    gl.uniform4fv(u.matte, this.matte)
    gl.bindVertexArray(this.emptyVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  clear() {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /**
   * Frees GPU resources. The context itself is left alive: StrictMode remounts reuse the
   * same canvas, and getContext would hand back a context we had deliberately lost.
   */
  dispose() {
    const { gl } = this
    gl.deleteProgram(this.fieldProg)
    gl.deleteProgram(this.shadeProg)
    gl.deleteBuffer(this.vbo)
    gl.deleteVertexArray(this.vao)
    gl.deleteVertexArray(this.emptyVao)
    gl.deleteFramebuffer(this.fbo)
    if (this.tex) gl.deleteTexture(this.tex)
  }
}
