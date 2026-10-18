import type { RefObject } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { motion as m } from './config'
import type { Tile } from './geometry'

gsap.registerPlugin(useGSAP, ScrollTrigger)
// Mobile address-bar show/hide resizes the viewport; the stage uses dvh, so skip the refresh.
ScrollTrigger.config({ ignoreMobileResize: true })

/**
 * One scrubbed timeline for the whole sequence. Elements render in their final
 * state (CSS), and the timeline's fromTo tweens pull them back to the start —
 * so reduced motion, or a failed script, simply shows the finished composition.
 */
export function useBrandRevealTimeline(root: RefObject<HTMLElement | null>, tiles: Tile[], layoutKey: string) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(root)
        const vw = (n = 0) => (n * window.innerWidth) / 100
        const vh = (n = 0) => (n * window.innerHeight) / 100

        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          scrollTrigger: {
            trigger: root.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: m.scrub,
            invalidateOnRefresh: true,
          },
        })

        // Stage A → exit the opening frame.
        tl.addLabel('intro', 0)
        tl.fromTo(q('.br-cue'), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.35, ease: 'none' }, 0)
        tl.fromTo(
          q('.br-intro'),
          { autoAlpha: 1, scale: 1, filter: 'blur(0px)' },
          { autoAlpha: 0, scale: 1.32, filter: 'blur(8px)', duration: m.intro.duration, ease: 'power2.in' },
          0,
        )

        // Stage B → empty, glowing frames fly in from depth and lock into place.
        const revealAt = m.tiles.start
        const last = Math.max(...tiles.map((t) => t.order))
        const fillAt = revealAt + last * m.tiles.stagger + m.tiles.duration * 0.7
        const fillEnd = fillAt + (tiles.length - 1) * m.fill.stagger + m.fill.duration
        tl.addLabel('mosaicReveal', revealAt)
        tl.fromTo(q('.br-mosaic'), { scale: 1.1 }, { scale: 1, duration: fillEnd - revealAt, ease: 'power2.out' }, revealAt)

        for (const t of tiles) {
          const [el] = q(`[data-tile="${t.id}"]`)
          const at = revealAt + t.order * m.tiles.stagger
          const f = t.from
          const dur = m.tiles.duration
          tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: dur * 0.35, ease: 'none' }, at)
          tl.fromTo(
            el,
            { x: () => vw(f.x), y: () => vh(f.y), z: f.z ?? 0, rotationX: f.rx ?? 0, rotationY: f.ry ?? 0 },
            { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, duration: dur },
            at,
          )
          tl.fromTo(el.querySelector('.br-edge__line'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, at)
          tl.fromTo(el.querySelector('.br-edge__glow'), { opacity: 0 }, { opacity: 1, duration: dur * 0.5, ease: 'power1.in' }, at + dur * 0.45)
          const spark = el.querySelector('.br-edge__spark')
          tl.fromTo(spark, { strokeDashoffset: 0 }, { strokeDashoffset: -1, duration: dur * 1.3, ease: 'none' }, at + dur * 0.3)
          tl.fromTo(spark, { opacity: 0 }, { opacity: 1, duration: dur * 0.25, ease: 'none' }, at + dur * 0.3)
          tl.to(spark, { opacity: 0, duration: dur * 0.35, ease: 'none' }, at + dur * 1.25)
        }

        // Frames fill with imagery, centre outwards.
        tl.addLabel('mosaicFill', fillAt)
        ;[...tiles]
          .sort((a, b) => a.dist - b.dist)
          .forEach((t, i) => {
            const [el] = q(`[data-tile="${t.id}"]`)
            const at = fillAt + i * m.fill.stagger
            tl.fromTo(
              el.querySelector('.br-tile__img'),
              { opacity: 0, scale: m.fill.imageScale },
              { opacity: 1, scale: 1, duration: m.fill.duration, ease: 'power2.out' },
              at,
            )
            tl.to(el.querySelector('.br-edge__glow'), { opacity: m.edge.restGlow, duration: m.fill.duration, ease: 'power1.out' }, at)
          })
        tl.addLabel('mosaicComplete', fillEnd)

        // Stage C → dim, then the logo returns to centre with a single shine pass.
        const dimAt = fillEnd + m.settle
        const brandAt = dimAt + m.dim.duration * 0.35
        tl.fromTo(q('.br-dim'), { autoAlpha: 0 }, { autoAlpha: 1, duration: m.dim.duration, ease: 'power1.inOut' }, dimAt)
        tl.addLabel('brandReveal', brandAt)
        tl.fromTo(
          q('.br-final'),
          { autoAlpha: 0, scale: 0.84, y: 24, filter: 'blur(10px)' },
          { autoAlpha: 1, scale: 1, y: 0, filter: 'blur(0px)', duration: m.brand.duration },
          brandAt,
        )
        tl.fromTo(q('.br-final__glow'), { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: m.brand.duration * 1.2 }, brandAt)
        tl.fromTo(
          q('.br-shine__band'),
          { x: 0, xPercent: -100 },
          { x: 0, xPercent: 100, duration: m.brand.shineDuration, ease: 'power2.inOut' },
          brandAt + m.brand.shineDelay,
        )
        tl.to({}, { duration: m.hold }) // hold the finished frame before the section releases
      })
    },
    { scope: root, dependencies: [layoutKey], revertOnUpdate: true },
  )
}
