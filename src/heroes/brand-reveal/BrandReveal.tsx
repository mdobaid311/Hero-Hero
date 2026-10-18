import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { brand, images, motion, pickLayout, type LayoutKey } from './config'
import { mosaics, type Tile } from './geometry'
import { useBrandRevealTimeline } from './useBrandRevealTimeline'
import './brandReveal.css'

// Re-render only when the breakpoint changes, never per scroll/resize frame.
const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
const currentLayout = (): LayoutKey => pickLayout(window.innerWidth, window.innerHeight)

export default function BrandReveal() {
  const root = useRef<HTMLElement>(null)
  const layoutKey = useSyncExternalStore(subscribe, currentLayout)
  const tiles = mosaics[layoutKey]
  useBrandRevealTimeline(root, tiles, layoutKey)
  // Images sit hidden until the fill phase; decode them up front so they don't pop in late.
  useEffect(() => {
    root.current?.querySelectorAll('img').forEach((img) => img.decode().catch(() => {}))
  }, [layoutKey])

  return (
    <section
      ref={root}
      className="br"
      aria-label={`${brand.name} brand introduction`}
      style={{ '--br-length': motion.scrollLength } as CSSProperties}
    >
      <div className="br-stage">
        <IntroBackground />
        <svg className="br-defs" aria-hidden="true">
          <linearGradient id="br-edge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--gold-light)' }} />
            <stop offset="0.5" style={{ stopColor: 'var(--gold)' }} />
            <stop offset="1" style={{ stopColor: 'var(--platinum)' }} />
          </linearGradient>
        </svg>
        <div className="br-mosaic">
          {tiles.map((t) => (
            <MosaicTile key={`${layoutKey}-${t.id}`} tile={t} />
          ))}
        </div>
        <div className="br-dim" />
        <div className="br-intro">
          <div className="br-intro__glow" />
          <Logo className="br-intro__logo" />
        </div>
        <BrandLogoReveal />
        <div className="br-cue" aria-hidden="true">
          <span>Scroll</span>
          <i />
        </div>
      </div>
    </section>
  )
}

function IntroBackground() {
  return (
    <div className="br-bg" aria-hidden="true">
      <i className="br-bg__light br-bg__light--a" />
      <i className="br-bg__light br-bg__light--b" />
      <i className="br-bg__light br-bg__light--c" />
    </div>
  )
}

function MosaicTile({ tile }: { tile: Tile }) {
  const { box, local } = tile
  const img = images[tile.img]
  const svgPoints = local.map((p) => `${p.x},${p.y}`).join(' ')
  const style: CSSProperties = {
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    clipPath: `polygon(${local.map((p) => `${p.x}% ${p.y}%`).join(', ')})`,
  }
  // object-fit: cover renders at whichever of width/height-driven size is larger.
  const sizes = `max(${Math.ceil(box.w)}vw, ${Math.ceil(box.h * img.ratio)}vh)`

  return (
    <div className="br-tile" data-tile={tile.id} style={style}>
      <img
        className="br-tile__img"
        src={img.src}
        srcSet={`${img.small} 640w, ${img.src} 1280w`}
        sizes={sizes}
        alt=""
        decoding="async"
        style={{ objectPosition: tile.pos ?? img.focus }}
      />
      <svg className="br-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon className="br-edge__glow" points={svgPoints} pathLength={1} />
        <polygon className="br-edge__line" points={svgPoints} pathLength={1} />
        <polygon className="br-edge__spark" points={svgPoints} pathLength={1} />
      </svg>
    </div>
  )
}

function BrandLogoReveal() {
  return (
    <div className="br-final">
      <div className="br-final__glow" />
      <div className="br-final__logo" style={{ '--br-logo': `url(${brand.logo.src})` } as CSSProperties}>
        <Logo className="br-final__img" />
        {/* Highlight clipped to the logo's own alpha via CSS mask */}
        <div className="br-shine" aria-hidden="true">
          <span className="br-shine__band" />
        </div>
      </div>
    </div>
  )
}

function Logo({ className }: { className: string }) {
  const { src, alt, width, height } = brand.logo
  return <img className={className} src={src} alt={alt} width={width} height={height} />
}
