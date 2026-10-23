/**
 * Rounded-rectangle geometry for button targets, in hero-local CSS px.
 * The perimeter is parametrised by arc length `s`, clockwise from the left end of the top edge.
 */
export interface RoundRect {
  cx: number
  cy: number
  hw: number // half width
  hh: number // half height
  r: number // corner radius, ≤ min(hw, hh)
}

export interface PerimeterPoint {
  x: number
  y: number
  nx: number // outward normal
  ny: number
}

const HALF_PI = Math.PI / 2

export function sdRoundRect(rr: RoundRect, px: number, py: number): number {
  const qx = Math.abs(px - rr.cx) - rr.hw + rr.r
  const qy = Math.abs(py - rr.cy) - rr.hh + rr.r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr.r
}

export function perimeterLength(rr: RoundRect): number {
  return 4 * (rr.hw - rr.r) + 4 * (rr.hh - rr.r) + 2 * Math.PI * rr.r
}

/** Point at arc length `s` (wraps), pushed `offset` px along the outward normal. */
export function perimeterPoint(rr: RoundRect, s: number, offset: number, out: PerimeterPoint): PerimeterPoint {
  const r = Math.max(rr.r, 1e-3)
  const a = rr.hw - rr.r
  const b = rr.hh - rr.r
  const q = HALF_PI * r
  const total = perimeterLength(rr)
  s = ((s % total) + total) % total
  // Segments 0..7: top edge, TR arc, right edge, BR arc, bottom edge, BL arc, left edge, TL arc.
  let i = 0
  for (; i < 7; i++) {
    const len = i & 1 ? q : i & 2 ? 2 * b : 2 * a
    if (s < len) break
    s -= len
  }
  let x: number, y: number, nx: number, ny: number
  if (i & 1) {
    const k = (i - 1) / 2 // corner: 0 TR, 1 BR, 2 BL, 3 TL
    const ang = (k - 1) * HALF_PI + s / r
    nx = Math.cos(ang)
    ny = Math.sin(ang)
    x = (k < 2 ? a : -a) + nx * r
    y = (k === 1 || k === 2 ? b : -b) + ny * r
  } else if (i === 0) {
    x = -a + s; y = -rr.hh; nx = 0; ny = -1
  } else if (i === 2) {
    x = rr.hw; y = -b + s; nx = 1; ny = 0
  } else if (i === 4) {
    x = a - s; y = rr.hh; nx = 0; ny = 1
  } else {
    x = -rr.hw; y = b - s; nx = -1; ny = 0
  }
  out.x = rr.cx + x + nx * offset
  out.y = rr.cy + y + ny * offset
  out.nx = nx
  out.ny = ny
  return out
}

/** Arc length of the perimeter point closest to (px, py). */
export function perimeterParam(rr: RoundRect, px: number, py: number): number {
  const a = rr.hw - rr.r
  const b = rr.hh - rr.r
  const r = rr.r
  const q = HALF_PI * r
  const dx = px - rr.cx
  const dy = py - rr.cy
  const qx = Math.min(Math.max(dx, -a), a)
  const qy = Math.min(Math.max(dy, -b), b)
  let ex = dx - qx
  let ey = dy - qy
  if (ex === 0 && ey === 0) {
    // Inside the straight-edged core: snap toward the nearest side.
    if (a - Math.abs(dx) < b - Math.abs(dy)) ex = Math.sign(dx) || 1
    else ey = Math.sign(dy) || 1
  }
  const ang = Math.atan2(ey, ex)
  // Straight edges, then corner arcs; segment order matches perimeterPoint.
  if (ex === 0) return ey < 0 ? a + qx : 3 * a + 2 * q + 2 * b - qx
  if (ey === 0) return ex > 0 ? 2 * a + q + b + qy : 4 * a + 3 * q + 3 * b - qy
  if (ex > 0) return ey < 0 ? 2 * a + r * (ang + HALF_PI) : 2 * a + q + 2 * b + r * ang
  return ey > 0 ? 4 * a + 2 * q + 2 * b + r * (ang - HALF_PI) : 4 * a + 3 * q + 4 * b + r * (ang + Math.PI)
}

// Round-trip check, like the dev assertions in brand-reveal/geometry.ts.
if (import.meta.env.DEV) {
  const p = { x: 0, y: 0, nx: 0, ny: 0 }
  for (const rr of [{ cx: 10, cy: -4, hw: 90, hh: 28, r: 20 }, { cx: 0, cy: 0, hw: 120, hh: 29, r: 29 }]) {
    for (let s = 0; s < perimeterLength(rr) - 1e-6; s += 7) {
      perimeterPoint(rr, s, 0, p)
      const back = perimeterParam(rr, p.x + p.nx * 5, p.y + p.ny * 5)
      console.assert(
        Math.abs(sdRoundRect(rr, p.x, p.y)) < 1e-6 && Math.abs(back - s) < 1e-6,
        `[symbiote] perimeter round-trip failed at s=${s}: got ${back}`,
      )
    }
  }
}
