import { config } from './config'
import type { RoundRect } from './roundRect'

/**
 * Field primitives. Every shape is drawn as triangles whose `uv` measures distance from
 * the shape's spine (|uv| = 1 at the edge of its influence). The field pass sums the
 * kernel (1 - |uv|²)² of everything additively, so overlapping shapes melt together
 * like metaballs instead of stacking with seams.
 *
 * Vertex layout: x, y (hero-local CSS px), u, v, amplitude, clip slot (0 = unclipped).
 */
export const STRIDE = 6

/** Ratio of influence radius to visible radius: the kernel crosses the iso threshold at |uv| = √(1 − √T). */
const INFLUENCE = 1 / Math.sqrt(1 - Math.sqrt(config.render.threshold))

const MAX_RIBBON = 160

export class FieldBatch {
  readonly data: Float32Array
  count = 0 // vertices
  /** Per clip slot: centre x, centre y, half width, half height — plus corner radii. */
  readonly clips = new Float32Array(16)
  readonly clipRadii = new Float32Array(4)
  private readonly max: number
  private readonly sx = new Float32Array(MAX_RIBBON)
  private readonly sy = new Float32Array(MAX_RIBBON)
  private readonly sw = new Float32Array(MAX_RIBBON)

  constructor(maxVertices = 24000) {
    this.max = maxVertices
    this.data = new Float32Array(maxVertices * STRIDE)
  }

  reset() {
    this.count = 0
  }

  setClip(slot: number, rr: RoundRect) {
    this.clips.set([rr.cx, rr.cy, rr.hw, rr.hh], slot * 4)
    this.clipRadii[slot] = rr.r
  }

  private vertex(x: number, y: number, u: number, v: number, amp: number, clip: number) {
    const o = this.count++ * STRIDE
    const d = this.data
    d[o] = x; d[o + 1] = y; d[o + 2] = u; d[o + 3] = v; d[o + 4] = amp; d[o + 5] = clip
  }

  /** Round blob with visible radius `r`. */
  blob(x: number, y: number, r: number, amp: number, clip = 0) {
    if (r <= 0.05 || this.count + 6 > this.max) return
    const R = r * INFLUENCE
    const x0 = x - R, x1 = x + R, y0 = y - R, y1 = y + R
    this.vertex(x0, y0, -1, -1, amp, clip)
    this.vertex(x1, y0, 1, -1, amp, clip)
    this.vertex(x0, y1, -1, 1, amp, clip)
    this.vertex(x1, y0, 1, -1, amp, clip)
    this.vertex(x1, y1, 1, 1, amp, clip)
    this.vertex(x0, y1, -1, 1, amp, clip)
  }

  /**
   * Tapered tube through n points with per-point visible half-widths. Catmull-Rom smoothed
   * (`sub` samples per segment); a zero width at the last point gives a pointed tip.
   */
  ribbon(xs: ArrayLike<number>, ys: ArrayLike<number>, ws: ArrayLike<number>, n: number, amp: number, sub: number) {
    const { sx, sy, sw } = this
    let m = 0
    for (let i = 0; i < n - 1 && m < MAX_RIBBON - sub - 1; i++) {
      const i0 = i > 0 ? i - 1 : 0
      const i3 = i + 2 < n ? i + 2 : n - 1
      for (let k = 0; k < sub; k++) {
        const t = k / sub
        sx[m] = catmullRom(xs[i0], xs[i], xs[i + 1], xs[i3], t)
        sy[m] = catmullRom(ys[i0], ys[i], ys[i + 1], ys[i3], t)
        sw[m] = ws[i] + (ws[i + 1] - ws[i]) * t
        m++
      }
    }
    sx[m] = xs[n - 1]; sy[m] = ys[n - 1]; sw[m] = ws[n - 1]; m++

    let nx = 0, ny = 1
    let plx = 0, ply = 0, prx = 0, pry = 0
    for (let i = 0; i < m; i++) {
      const a = i > 0 ? i - 1 : 0
      const b = i < m - 1 ? i + 1 : m - 1
      const tx = sx[b] - sx[a]
      const ty = sy[b] - sy[a]
      const len = Math.hypot(tx, ty)
      if (len > 1e-4) { nx = -ty / len; ny = tx / len } // collapsed points keep the last normal
      const W = sw[i] * INFLUENCE
      const lx = sx[i] + nx * W, ly = sy[i] + ny * W
      const rx = sx[i] - nx * W, ry = sy[i] - ny * W
      if (i > 0 && this.count + 6 <= this.max) {
        this.vertex(plx, ply, -1, 0, amp, 0)
        this.vertex(prx, pry, 1, 0, amp, 0)
        this.vertex(lx, ly, -1, 0, amp, 0)
        this.vertex(prx, pry, 1, 0, amp, 0)
        this.vertex(rx, ry, 1, 0, amp, 0)
        this.vertex(lx, ly, -1, 0, amp, 0)
      }
      plx = lx; ply = ly; prx = rx; pry = ry
    }
  }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t)
}
