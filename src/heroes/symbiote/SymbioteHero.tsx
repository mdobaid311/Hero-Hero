import { useRef } from 'react'
import { useSymbiote } from './useSymbiote'
import './symbiote.css'

const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=JetBrains+Mono:wght@400;500&display=swap'

export default function SymbioteHero() {
  const root = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const background = useRef<HTMLCanvasElement>(null)
  const reticle = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLElement>(null)
  useSymbiote({ root, canvas, background, reticle, status })

  return (
    <div className="sy-page">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={FONTS} precedence="default" />
      <section ref={root} className="sy" aria-labelledby="sy-title">
        <canvas ref={background} className="sy-bg" aria-hidden="true" />
        <canvas ref={canvas} className="sy-canvas" aria-hidden="true" />
        <div className="sy-content">
          <p className="sy-eyebrow">An experiment in living interfaces</p>
          <h1 id="sy-title" className="sy-title">
            <span>It knows</span> <span>you’re here.</span>
          </h1>
          <p className="sy-lede">
            Move slowly. Something in the dark is learning the shape of your hand, and everything you reach for.
          </p>
          <div className="sy-actions">
            <SymbioteLink href="#void" variant="solid">Enter the void</SymbioteLink>
            <SymbioteLink href="#void" variant="ghost">Discover the unknown</SymbioteLink>
          </div>
        </div>
        <div className="sy-foot" aria-hidden="true">
          <span className="sy-scroll">
            <i />
            Scroll
          </span>
          <span>
            Organism 01 / <b ref={status}>Watching</b>
          </span>
        </div>
        <div ref={reticle} className="sy-reticle" aria-hidden="true" />
      </section>
      <div id="void" className="sy-void" />
    </div>
  )
}

/**
 * A real link the creature can hunt: `data-symbiote-target` opts it in, and the creature's
 * highlights are muted behind `data-symbiote-matte` so the label stays legible.
 */
function SymbioteLink({ href, variant, children }: { href: string; variant: 'solid' | 'ghost'; children: string }) {
  return (
    <a href={href} className={`sy-btn sy-btn--${variant}`} data-symbiote-target="">
      <span className="sy-btn__face" aria-hidden="true" />
      <span className="sy-btn__label" data-symbiote-matte="">
        {children}
      </span>
      <span className="sy-btn__ring" aria-hidden="true" />
    </a>
  )
}
