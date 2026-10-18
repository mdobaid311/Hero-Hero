/**
 * Brand Reveal — single source of truth for assets, mosaic geometry and motion.
 *
 * Geometry model: each layout is a warped grid. `h` lines run left→right and are
 * given as [y at x=0, y at x=100]; `v` lines run top→bottom as [x at y=0, x at y=100]
 * (all in % of the viewport). A tile spans grid cells (`rows`/`cols` are line
 * indices, end exclusive) and its 4 corners are line intersections, so neighbours
 * always share exact edges and the outer border stays a clean rectangle.
 * Lines must not cross inside the frame; geometry.ts asserts coverage in dev.
 */

export const brand = {
  name: 'Velix',
  logo: { src: '/brand/velix-logo.svg', alt: 'Velix', width: 400, height: 340 },
}

/** Free-for-commercial-use photos (Unsplash License). Swap `src`/`small` for brand photography. */
const photo = (n: string, ratio: number, focus: string, unsplashId: string) => ({
  src: `/cars/car-${n}.jpg`, // 1280w
  small: `/cars/car-${n}-640.jpg`, // 640w
  ratio, // width / height
  focus, // object-position
  source: `https://images.unsplash.com/photo-${unsplashId}`,
})

export const images = {
  car01: photo('01', 0.8, '50% 72%', '1580273916550-e323be2ae537'),
  car02: photo('02', 1.99, '55% 55%', '1762170904867-eda21916d7ec'),
  car03: photo('03', 0.667, '50% 48%', '1541348263662-e068662d82af'),
  car04: photo('04', 0.8, '50% 76%', '1769863467291-23cf7902f686'),
  car05: photo('05', 0.667, '62% 70%', '1628519592419-bf288f08cef5'),
  car06: photo('06', 1.5, '62% 62%', '1503376780353-7e6692767b70'),
  car07: photo('07', 0.571, '50% 54%', '1776883169187-b0e842d599ee'),
  car08: photo('08', 1.5, '50% 72%', '1542362567-b07e54358753'),
  car09: photo('09', 1.78, '45% 62%', '1773866117133-c0b3c85e2af1'),
  car10: photo('10', 0.666, '50% 72%', '1625231334168-35067f8853ed'),
  car11: photo('11', 0.713, '38% 66%', '1785327831299-eddf16a18328'),
  car12: photo('12', 1.69, '66% 66%', '1492144534655-ae79c964c9d7'),
  car13: photo('13', 1.5, '45% 64%', '1603584173870-7f23fdae1b7a'),
  car14: photo('14', 1.5, '50% 60%', '1494976388531-d1058494cdd8'),
  car15: photo('15', 1.5, '66% 62%', '1583121274602-3e2820c69888'),
}

export type ImageKey = keyof typeof images
export type Line = readonly [number, number]

/** Where a tile flies in from: x/y in % of viewport, z in px (positive = from the camera), rx/ry in degrees. */
export interface Entrance { x?: number; y?: number; z?: number; rx?: number; ry?: number }

export interface TileSpec {
  id: string
  img: ImageKey
  rows: readonly [number, number]
  cols: readonly [number, number]
  /** Reveal order (0 = first). */
  order: number
  from: Entrance
  /** Overrides the image's default object-position for this tile. */
  pos?: string
}

export interface MosaicLayout { h: Line[]; v: Line[]; tiles: TileSpec[] }

export type LayoutKey = 'desktop' | 'tablet' | 'mobile'

/** < 768 → mobile; < 1200 or portrait → tablet; else desktop. */
export function pickLayout(w: number, h: number): LayoutKey {
  if (w < 768) return 'mobile'
  if (w < 1200 || h > w) return 'tablet'
  return 'desktop'
}

export const layouts: Record<LayoutKey, MosaicLayout> = {
  // 15 tiles, 3 bands × 9 columns; centre tile I sits behind the logo.
  desktop: {
    h: [[0, 0], [31, 26], [66, 72], [100, 100]],
    v: [[0, 0], [11, 7], [24, 21], [33, 37], [46, 42], [55, 58], [67, 63], [78, 82], [89, 86], [100, 100]],
    tiles: [
      { id: 'A', img: 'car08', rows: [0, 1], cols: [0, 2], order: 2, from: { x: -8, y: -14, z: 220 } },
      { id: 'B', img: 'car11', rows: [0, 1], cols: [2, 3], order: 8, from: { x: -10, y: -10, z: 420 } },
      { id: 'C', img: 'car09', rows: [0, 1], cols: [3, 5], order: 6, from: { y: -18, z: 140, rx: 18 } },
      { id: 'D', img: 'car01', rows: [0, 1], cols: [5, 6], order: 10, from: { x: 6, y: -16, z: 260 } },
      { id: 'E', img: 'car02', rows: [0, 1], cols: [6, 8], order: 4, from: { y: -22, z: -320 } },
      { id: 'F', img: 'car07', rows: [0, 2], cols: [8, 9], order: 0, from: { x: 14, y: -8, z: 320, ry: -12 } },
      { id: 'G', img: 'car03', rows: [1, 3], cols: [0, 1], order: 1, from: { x: -14, y: 10, z: 320, ry: 12 } },
      { id: 'H', img: 'car06', rows: [1, 2], cols: [1, 3], order: 12, from: { x: -20, z: 160, ry: 16 } },
      { id: 'I', img: 'car13', rows: [1, 2], cols: [3, 6], order: 14, from: { z: -640 } },
      { id: 'J', img: 'car04', rows: [1, 2], cols: [6, 8], order: 13, from: { x: 20, z: 160, ry: -16 } },
      { id: 'K', img: 'car05', rows: [2, 3], cols: [1, 2], order: 5, from: { y: 24, z: -320 } },
      { id: 'L', img: 'car14', rows: [2, 3], cols: [2, 4], order: 11, from: { x: -6, y: 16, z: 260 } },
      { id: 'M', img: 'car12', rows: [2, 3], cols: [4, 6], order: 7, from: { y: 18, z: 140, rx: -18 } },
      { id: 'N', img: 'car10', rows: [2, 3], cols: [6, 7], order: 9, from: { x: 10, y: 10, z: 420 } },
      { id: 'O', img: 'car15', rows: [2, 3], cols: [7, 9], order: 3, from: { x: 8, y: 14, z: 220 } },
    ],
  },
  // 11 tiles, tuned to work from 3:4 portrait to 4:3 landscape.
  tablet: {
    h: [[0, 0], [29, 23], [71, 76], [100, 100]],
    v: [[0, 0], [18, 12], [34, 39], [63, 59], [80, 86], [100, 100]],
    tiles: [
      { id: 'A', img: 'car09', rows: [0, 1], cols: [0, 2], order: 2, from: { x: -10, y: -14, z: 220 } },
      { id: 'B', img: 'car02', rows: [0, 1], cols: [2, 3], order: 6, from: { y: -20, z: -280 } },
      { id: 'C', img: 'car01', rows: [0, 1], cols: [3, 4], order: 4, from: { x: 8, y: -16, z: 300 } },
      { id: 'K', img: 'car11', rows: [0, 1], cols: [4, 5], order: 0, from: { x: 14, y: -10, z: 320, ry: -12 } },
      { id: 'D', img: 'car07', rows: [1, 3], cols: [0, 1], order: 1, from: { x: -14, y: 8, z: 320, ry: 12 } },
      { id: 'E', img: 'car03', rows: [1, 2], cols: [1, 2], order: 7, from: { x: -18, z: 180, ry: 14 } },
      { id: 'F', img: 'car13', rows: [1, 2], cols: [2, 3], order: 10, from: { z: -600 } },
      { id: 'G', img: 'car10', rows: [1, 2], cols: [3, 4], order: 8, from: { x: 18, z: 180, ry: -14 } },
      { id: 'H', img: 'car05', rows: [1, 3], cols: [4, 5], order: 3, from: { x: 14, y: 10, z: 300, ry: -12 } },
      { id: 'I', img: 'car06', rows: [2, 3], cols: [1, 3], order: 5, from: { y: 22, z: -280 } },
      { id: 'J', img: 'car15', rows: [2, 3], cols: [3, 4], order: 9, from: { x: 8, y: 16, z: 240 } },
    ],
  },
  // 8 large tiles for portrait phones; full-width centre band behind the logo.
  mobile: {
    h: [[0, 0], [20, 16], [38, 43], [63, 60], [82, 86], [100, 100]],
    v: [[0, 0], [40, 30], [64, 58], [100, 100]],
    tiles: [
      { id: 'A', img: 'car09', rows: [0, 1], cols: [0, 2], order: 0, from: { x: -10, y: -12, z: 200 } },
      { id: 'B', img: 'car07', rows: [0, 2], cols: [2, 3], order: 1, from: { x: 12, y: -8, z: 240 } },
      { id: 'C', img: 'car01', rows: [1, 2], cols: [0, 1], order: 3, from: { x: -16, z: 160 } },
      { id: 'D', img: 'car11', rows: [1, 2], cols: [1, 2], order: 4, from: { y: -14, z: 200 } },
      { id: 'E', img: 'car13', rows: [2, 3], cols: [0, 3], order: 7, from: { z: -500 } },
      { id: 'F', img: 'car05', rows: [3, 5], cols: [0, 1], order: 2, from: { x: -12, y: 10, z: 240 } },
      { id: 'G', img: 'car02', rows: [3, 4], cols: [1, 3], order: 5, from: { x: 16, z: 160 } },
      { id: 'H', img: 'car15', rows: [4, 5], cols: [1, 3], order: 6, from: { y: 14, z: 200 } },
    ],
  },
}

/**
 * Timeline, in abstract units — the whole timeline is stretched across `scrollLength`
 * viewport heights of scrolling, so only ratios matter.
 */
export const motion = {
  scrollLength: 4.5, // viewport heights scrolled while the stage is pinned
  scrub: 0.8, // seconds of catch-up smoothing on top of Lenis
  intro: { duration: 1.3 },
  tiles: { start: 0.45, stagger: 0.17, duration: 1.8 },
  fill: { stagger: 0.08, duration: 1.1, imageScale: 1.22 },
  settle: 0.5, // pause on the finished mosaic before dimming
  dim: { duration: 1 },
  brand: { duration: 1.4, shineDelay: 0.85, shineDuration: 1.5 },
  hold: 1.6,
  edge: { restGlow: 0.18 }, // glow opacity once a tile's image has landed
}
