import { config } from './config'
import { FULLSCREEN_VS, NOISE_GLSL, program } from './renderer'

/**
 * The void as a pool of black liquid. A GPU ripple simulation (discrete wave equation,
 * ping-ponged half-float textures) is disturbed by the creature's wake, its heartbeat,
 * its attacks and clicks, then shaded as slow oily swell with capillaries that pulse
 * outward from the creature. Drawn on its own canvas beneath the button faces; the
 * hero's CSS gradient stays underneath as the fallback.
 */

const B = config.background
const f = (n: number) => n.toFixed(4)
const TAU = Math.PI * 2
const MAX_DROPS = 8
const STEP = 1 / 60 // sim rate: waves travel ~0.7 cell per step, so this sets how viscous it feels

const STEP_FS = `#version 300 es
precision highp float;
uniform sampler2D u_state; // r: height now, g: height one step ago
uniform vec2 u_grid;
uniform vec4 u_drops[${MAX_DROPS}]; // x, y (cells, y down), radius (cells), strength
uniform int u_count;
out vec4 o;
void main() {
  vec2 t = 1.0 / u_grid;
  vec2 uv = gl_FragCoord.xy * t;
  vec2 s = texture(u_state, uv).rg;
  float n = texture(u_state, uv + vec2(t.x, 0.0)).r + texture(u_state, uv - vec2(t.x, 0.0)).r
          + texture(u_state, uv + vec2(0.0, t.y)).r + texture(u_state, uv - vec2(0.0, t.y)).r;
  float h = (n * 0.5 - s.g) * ${f(B.damping)};
  vec2 cell = vec2(gl_FragCoord.x, u_grid.y - gl_FragCoord.y);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    vec4 d = u_drops[i];
    vec2 q = (cell - d.xy) / d.z;
    h += d.w * exp(-dot(q, q));
  }
  o = vec4(h, s.r, 0.0, 1.0);
}`

const SHADE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_ripple;
uniform vec2 u_res;
uniform vec2 u_css;
uniform vec2 u_body; // CSS px, y down
uniform float u_time;
out vec4 o;
${NOISE_GLSL}
float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.03 + 7.1) * 0.3 + noise(p * 4.1 + 3.3) * 0.1; }
// Slow, domain-warped swell of the oil surface.
float oil(vec2 p) {
  vec2 q = p * 0.0024;
  vec2 w = vec2(noise(q * 1.7 + u_time * 0.03), noise(q * 1.7 + vec2(4.3, 9.1) - u_time * 0.025));
  return fbm(q + w * 1.6 + u_time * 0.01);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 css = vec2(uv.x, 1.0 - uv.y) * u_css;

  // Surface normal: ripples plus the oil swell (texture space is y-up).
  vec2 rt = 1.0 / vec2(textureSize(u_ripple, 0));
  float hx = texture(u_ripple, uv + vec2(rt.x, 0.0)).r - texture(u_ripple, uv - vec2(rt.x, 0.0)).r;
  float hy = texture(u_ripple, uv + vec2(0.0, rt.y)).r - texture(u_ripple, uv - vec2(0.0, rt.y)).r;
  float o0 = oil(css);
  vec2 og = vec2(oil(css + vec2(6.0, 0.0)) - o0, oil(css - vec2(0.0, 6.0)) - o0);
  vec3 n = normalize(vec3(-(vec2(hx, hy) * ${f(B.ripple)} + og * ${f(B.oil)}), 1.0));

  // Charcoal pool, lit where the creature usually lives.
  float aspect = u_css.x / u_css.y;
  float d = length(vec2(uv.x * aspect, 1.0 - uv.y) - vec2(0.72 * aspect, 0.46));
  vec3 col = mix(vec3(0.078, 0.078, 0.09), vec3(0.02, 0.02, 0.024), smoothstep(0.0, 1.0, d));
  vec2 gb = css - u_body;
  float near = exp(-dot(gb, gb) / ${f(2 * 300 * 300)});
  col += vec3(0.62, 0.66, 0.74) * near * 0.04;

  // Wet sheen: ripples and swells only show where they tilt toward the key light.
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.5, 0.75, 0.6));
  float spec = pow(max(dot(n, normalize(L + V)), 0.0), 90.0);
  vec3 r = reflect(-V, n);
  float band = smoothstep(0.1, 0.25, r.y) * (1.0 - smoothstep(0.28, 0.45, r.y));
  col += vec3(0.85, 0.88, 0.95) * (spec * ${f(B.sheen)} + band * 0.02) * (0.3 + 1.6 * near);

  // Capillaries in the substrate, lit by the creature, a pulse travelling outward each heartbeat.
  vec2 vp = css * 0.006;
  vec2 vw = vec2(noise(vp * 1.3 + 11.0), noise(vp * 1.3 + 23.0)) * 1.4;
  float vein = pow(1.0 - abs(fbm(vp + vw) * 2.0 - 1.0), 22.0);
  float ph = fract(u_time / ${f(B.beatPeriod)} - length(gb) * 0.0011);
  float pulse = 0.3 + 0.7 * exp(-ph * 5.0);
  float reach = exp(-dot(gb, gb) / ${f(2 * 380 * 380)});
  col += vec3(0.42, 0.45, 0.55) * vein * reach * pulse * ${f(B.veins)};

  vec2 vq = (uv - 0.5) * vec2(aspect, 1.0);
  col *= 1.0 - 0.55 * smoothstep(0.4, 1.2, length(vq));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding in the dark gradients
  o = vec4(col, 1.0);
}`

export class BackgroundRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly stepProg: WebGLProgram
  private readonly shadeProg: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly fbos: WebGLFramebuffer[]
  private textures: WebGLTexture[] = []
  private cur = 0
  private gridW = 1
  private gridH = 1
  private cssW = 1
  private cssH = 1
  private acc = 0
  private readonly drops = new Float32Array(MAX_DROPS * 4)
  private dropCount = 0
  private readonly u: Record<string, WebGLUniformLocation | null>

  /** Throws when WebGL2 or float render targets are unavailable; the CSS background remains. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('float render targets unavailable')
    }
    this.gl = gl
    this.stepProg = program(gl, FULLSCREEN_VS, STEP_FS)
    this.shadeProg = program(gl, FULLSCREEN_VS, SHADE_FS)
    this.u = {
      state: gl.getUniformLocation(this.stepProg, 'u_state'),
      grid: gl.getUniformLocation(this.stepProg, 'u_grid'),
      drops: gl.getUniformLocation(this.stepProg, 'u_drops'),
      count: gl.getUniformLocation(this.stepProg, 'u_count'),
      ripple: gl.getUniformLocation(this.shadeProg, 'u_ripple'),
      res: gl.getUniformLocation(this.shadeProg, 'u_res'),
      css: gl.getUniformLocation(this.shadeProg, 'u_css'),
      body: gl.getUniformLocation(this.shadeProg, 'u_body'),
      time: gl.getUniformLocation(this.shadeProg, 'u_time'),
    }
    this.vao = gl.createVertexArray()
    this.fbos = [gl.createFramebuffer(), gl.createFramebuffer()]
  }

  /** `scale` is canvas px per CSS px: the surface is soft, so it renders well below device resolution. */
  resize(cssW: number, cssH: number, scale: number) {
    const { gl, canvas } = this
    this.cssW = Math.max(1, cssW)
    this.cssH = Math.max(1, cssH)
    canvas.width = Math.max(1, Math.round(this.cssW * scale))
    canvas.height = Math.max(1, Math.round(this.cssH * scale))
    const gw = Math.max(2, Math.ceil(this.cssW / B.cell))
    const gh = Math.max(2, Math.ceil(this.cssH / B.cell))
    if (gw === this.gridW && gh === this.gridH && this.textures.length) return
    this.gridW = gw
    this.gridH = gh
    for (const t of this.textures) gl.deleteTexture(t)
    this.textures = this.fbos.map((fbo) => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      for (const [internal, format] of [[gl.RG16F, gl.RG], [gl.RGBA16F, gl.RGBA]]) {
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, gw, gh, 0, format, gl.HALF_FLOAT, null)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) break
      }
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return tex
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Queue a ripple impulse at hero-local CSS px; negative strength pushes the surface down. */
  splash(x: number, y: number, strength: number, radius = 18) {
    if (this.dropCount >= MAX_DROPS - 1) return // last slot is reserved for the body
    this.drops.set([x / B.cell, y / B.cell, radius / B.cell, strength], this.dropCount++ * 4)
  }

  render(dt: number, bodyX: number, bodyY: number, speed: number, time: number) {
    const { gl, canvas, u } = this
    gl.bindVertexArray(this.vao)
    this.acc = Math.min(this.acc + dt, STEP * 4)
    if (this.acc >= STEP) {
      gl.useProgram(this.stepProg)
      gl.viewport(0, 0, this.gridW, this.gridH)
      gl.uniform2f(u.grid, this.gridW, this.gridH)
      gl.uniform1i(u.state, 0)
      gl.activeTexture(gl.TEXTURE0)
      // The body is always a source: a trough dragged along while it moves, a ring each heartbeat at rest.
      const beat = (time / B.beatPeriod) % 1
      const strength = -B.wake * Math.min(speed / 900, 1) + B.heartbeat * Math.sin(beat * TAU * 2.5) * Math.exp(-beat * 10)
      while (this.acc >= STEP) {
        this.acc -= STEP
        this.drops.set([bodyX / B.cell, bodyY / B.cell, 16 / B.cell, strength], this.dropCount * 4)
        gl.uniform4fv(u.drops, this.drops)
        gl.uniform1i(u.count, this.dropCount + 1)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[1 - this.cur])
        gl.bindTexture(gl.TEXTURE_2D, this.textures[this.cur])
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        this.cur = 1 - this.cur
        this.dropCount = 0 // queued splashes land on the first step only
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(this.shadeProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.cur])
    gl.uniform1i(u.ripple, 0)
    gl.uniform2f(u.res, canvas.width, canvas.height)
    gl.uniform2f(u.css, this.cssW, this.cssH)
    gl.uniform2f(u.body, bodyX, bodyY)
    gl.uniform1f(u.time, time)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** Frees GPU resources; the context stays alive for StrictMode remounts (see SymbioteRenderer.dispose). */
  dispose() {
    const { gl } = this
    gl.deleteProgram(this.stepProg)
    gl.deleteProgram(this.shadeProg)
    gl.deleteVertexArray(this.vao)
    for (const fbo of this.fbos) gl.deleteFramebuffer(fbo)
    for (const t of this.textures) gl.deleteTexture(t)
  }
}
