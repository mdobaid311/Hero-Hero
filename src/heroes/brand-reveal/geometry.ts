import { layouts, type LayoutKey, type Line, type MosaicLayout, type TileSpec } from './config'

type Point = { x: number; y: number }

export interface Tile extends TileSpec {
  /** Bounding box in % of the stage. */
  box: { x: number; y: number; w: number; h: number }
  /** Polygon in % of the bounding box (for clip-path and the edge SVG). */
  local: Point[]
  /** Distance of the tile centre from the stage centre, used for the fill order. */
  dist: number
}

/** Intersection of an h line (y = a + (b-a)·x/100) with a v line (x = c + (d-c)·y/100). */
function meet([a, b]: Line, [c, d]: Line): Point {
  const k = (b - a) / 100
  const m = (d - c) / 100
  const y = (a + k * c) / (1 - k * m)
  return { x: c + m * y, y }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

function buildTile(layout: MosaicLayout, t: TileSpec): Tile {
  const [top, bottom] = [layout.h[t.rows[0]], layout.h[t.rows[1]]]
  const [left, right] = [layout.v[t.cols[0]], layout.v[t.cols[1]]]
  const pts = [meet(top, left), meet(top, right), meet(bottom, right), meet(bottom, left)]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const w = Math.max(...xs) - x
  const h = Math.max(...ys) - y
  const cx = x + w / 2
  const cy = y + h / 2
  return {
    ...t,
    box: { x, y, w, h },
    local: pts.map((p) => ({ x: r3(((p.x - x) / w) * 100), y: r3(((p.y - y) / h) * 100) })),
    dist: Math.hypot(cx - 50, cy - 50),
  }
}

/** Dev guard: lines must not cross, and every grid cell must belong to exactly one tile. */
export function validateLayout(name: string, layout: MosaicLayout) {
  const increasing = (lines: Line[]) =>
    lines.every((l, i) => i === 0 || (l[0] > lines[i - 1][0] && l[1] > lines[i - 1][1]))
  if (!increasing(layout.h) || !increasing(layout.v)) throw new Error(`[brand-reveal] ${name}: grid lines cross`)
  const cols = layout.v.length - 1
  const cells = new Array((layout.h.length - 1) * cols).fill(0)
  for (const t of layout.tiles)
    for (let r = t.rows[0]; r < t.rows[1]; r++)
      for (let c = t.cols[0]; c < t.cols[1]; c++) cells[r * cols + c]++
  const bad = cells.findIndex((n) => n !== 1)
  if (bad >= 0) throw new Error(`[brand-reveal] ${name}: cell r${Math.floor(bad / cols)} c${bad % cols} covered ${cells[bad]}×`)
}

if (import.meta.env.DEV) for (const [k, l] of Object.entries(layouts)) validateLayout(k, l)

export const mosaics = Object.fromEntries(
  Object.entries(layouts).map(([k, l]) => [k, l.tiles.map((t) => buildTile(l, t))]),
) as Record<LayoutKey, Tile[]>
