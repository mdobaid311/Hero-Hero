import { useEffect, type RefObject } from 'react'
import { BackgroundRenderer } from './background'
import { config, type Quality } from './config'
import { SymbioteEngine, type TargetPhase } from './engine'
import { SymbioteRenderer } from './renderer'

/**
 * Wires the symbiote to the DOM: measures targets, tracks the pointer, runs the single rAF
 * loop and writes the few per-frame DOM values (reticle position, --grip, data-phase).
 * Everything lives in closures, so React never re-renders because of the animation.
 *
 * Modes: `pointer` (fine pointer + hover) follows the cursor; `ambient` (touch) wanders on its
 * own; `still` (reduced motion) renders a single settled frame and never animates.
 */

type Mode = 'pointer' | 'ambient' | 'still'

const STATUS: Record<TargetPhase, string> = {
  idle: 'Watching',
  retreat: 'Recoiling',
  detect: 'Sensing',
  approach: 'Hunting',
  attached: 'Feeding',
}
const RANK: TargetPhase[] = ['idle', 'retreat', 'detect', 'approach', 'attached']

interface Refs {
  root: RefObject<HTMLElement | null>
  canvas: RefObject<HTMLCanvasElement | null>
  background: RefObject<HTMLCanvasElement | null>
  reticle: RefObject<HTMLElement | null>
  status: RefObject<HTMLElement | null>
}

export function useSymbiote({ root, canvas, background, reticle, status }: Refs) {
  useEffect(() => {
    const hero = root.current
    const cv = canvas.current
    const dot = reticle.current
    if (!hero || !cv || !dot) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const fine = matchMedia('(hover: hover) and (pointer: fine)')
    const mode = (): Mode => (reduced.matches ? 'still' : fine.matches ? 'pointer' : 'ambient')
    let stop = start(hero, cv, background.current, dot, status.current, mode())
    const restart = () => {
      stop()
      stop = start(hero, cv, background.current, dot, status.current, mode())
    }
    reduced.addEventListener('change', restart)
    fine.addEventListener('change', restart)
    return () => {
      reduced.removeEventListener('change', restart)
      fine.removeEventListener('change', restart)
      stop()
    }
  }, [root, canvas, background, reticle, status])
}

function start(
  hero: HTMLElement,
  cv: HTMLCanvasElement,
  bgCanvas: HTMLCanvasElement | null,
  dot: HTMLElement,
  label: HTMLElement | null,
  mode: Mode,
): () => void {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4
  const quality: Quality = mode === 'pointer' && !weak ? config.quality.high : config.quality.low
  let dprCap = quality.dprCap
  let fieldScale = quality.fieldScale
  let bgScale = quality.bgScale

  const targets = [...hero.querySelectorAll<HTMLElement>('[data-symbiote-target]')]
  let W = 0
  let H = 0
  let originX = 0 // hero position in document coordinates
  let originY = 0
  let homeX = 0
  let homeY = 0
  const placeHome = () => {
    const wide = W >= 768
    homeX = W * (wide ? 0.74 : 0.66)
    homeY = H * (wide ? 0.48 : 0.24)
  }
  const r0 = hero.getBoundingClientRect()
  W = r0.width
  H = r0.height
  placeHome()

  const engine = new SymbioteEngine(quality, homeX, homeY)
  let renderer: SymbioteRenderer
  try {
    renderer = new SymbioteRenderer(cv, engine.field.data.length)
  } catch (err) {
    // No WebGL2 / float targets: the hero stays fully usable, just without the creature.
    if (import.meta.env.DEV) console.info('[symbiote] disabled:', err)
    return () => {}
  }
  let bg: BackgroundRenderer | null = null
  try {
    if (bgCanvas) bg = new BackgroundRenderer(bgCanvas)
  } catch (err) {
    // The CSS gradient behind the canvas stands in.
    if (import.meta.env.DEV) console.info('[symbiote] background disabled:', err)
  }

  const measure = () => {
    const r = hero.getBoundingClientRect()
    originX = r.left + scrollX
    originY = r.top + scrollY
    W = r.width
    H = r.height
    placeHome()
    renderer.resize(W, H, Math.min(devicePixelRatio || 1, dprCap), fieldScale)
    bg?.resize(W, H, bgScale)
    renderer.matte.fill(0)
    engine.setTargets(
      targets.map((el, i) => {
        const b = el.getBoundingClientRect()
        const hw = b.width / 2
        const hh = b.height / 2
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
        const text = el.querySelector('[data-symbiote-matte]')?.getBoundingClientRect()
        if (text && i < 4) renderer.matte.set([text.left - r.left + text.width / 2, text.top - r.top + text.height / 2, text.width / 2 + 3, text.height / 2 + 3], i * 4)
        return { el, rect: { cx: b.left - r.left + hw, cy: b.top - r.top + hh, hw, hh, r: Math.min(radius, hw, hh) } }
      }),
    )
    if (mode === 'still') {
      engine.settle(homeX, homeY, 2.5)
      renderer.render(engine.field, engine.x, engine.y, engine.time)
      bg?.render(0, engine.x, engine.y, 0, engine.time)
    }
  }

  // Pointer & focus input
  let clientX = 0
  let clientY = 0
  let hasPointer = false
  let focusIndex = -1 // keyboard focus pulls the creature onto that button until the pointer moves
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    clientX = e.clientX
    clientY = e.clientY
    hasPointer = true
    focusIndex = -1
  }
  const onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) hasPointer = false
  }
  // Every press drops a ripple into the pool, touch included.
  const onDown = (e: PointerEvent) => {
    const x = e.clientX - (originX - scrollX)
    const y = e.clientY - (originY - scrollY)
    if (x >= 0 && y >= 0 && x <= W && y <= H) bg?.splash(x, y, config.splash.click, 14)
  }
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target as HTMLElement
    const i = targets.indexOf(el)
    if (i >= 0 && el.matches(':focus-visible')) focusIndex = i
  }
  const onFocusOut = () => {
    focusIndex = -1
  }

  // DOM sync, written only when values change
  const lastGrip: number[] = []
  const lastPhase: string[] = []
  let lastStatus = ''
  const sync = (inside: boolean, x: number, y: number) => {
    let top: TargetPhase = 'idle'
    for (let i = 0; i < engine.targets.length; i++) {
      const tg = engine.targets[i]
      const g = Math.round(Math.min(Math.max(tg.grip.x, 0), 1) * 100) / 100
      if (g !== lastGrip[i]) {
        lastGrip[i] = g
        tg.el.style.setProperty('--grip', String(g))
      }
      if (tg.phase !== lastPhase[i]) {
        lastPhase[i] = tg.phase
        tg.el.dataset.phase = tg.phase
      }
      if (RANK.indexOf(tg.phase) > RANK.indexOf(top)) top = tg.phase
    }
    if (label && STATUS[top] !== lastStatus) {
      lastStatus = STATUS[top]
      label.textContent = lastStatus
    }
    if (mode !== 'pointer') return
    if (inside) dot.style.transform = `translate3d(${x}px, ${y}px, 0)`
    hero.classList.toggle('has-pointer', inside)
    hero.classList.toggle('is-gripping', inside && focusIndex < 0 && top === 'attached')
  }

  // Loop
  let raf = 0
  let last = 0
  let running = false
  let alive = true
  let onScreen = true
  let ema = 1 / 60
  let frames = 0
  let degraded = quality === config.quality.low
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60
    last = now
    const x = clientX - (originX - scrollX)
    const y = clientY - (originY - scrollY)
    const inside = mode === 'pointer' && hasPointer && x >= 0 && y >= 0 && x <= W && y <= H
    let leadX: number
    let leadY: number
    const focused = engine.targets[focusIndex]
    if (focused) {
      leadX = focused.rect.cx
      leadY = focused.rect.cy
    } else if (inside) {
      leadX = x
      leadY = y
    } else {
      // No pointer: drift around home (wider on touch, where this is the whole show).
      const t = engine.time
      const amp = mode === 'ambient' ? 1 : 0.4
      leadX = homeX + W * (0.12 * amp * Math.sin(t * 0.37) + 0.03 * Math.sin(t * 0.91 + 2))
      leadY = homeY + H * (0.1 * amp * Math.sin(t * 0.53 + 1.1) + 0.02 * Math.sin(t * 1.3))
    }
    engine.update(dt, leadX, leadY)
    const sp = engine.splashes
    for (let i = 0; i < sp.length; i += 3) bg?.splash(sp[i], sp[i + 1], sp[i + 2], 16)
    sp.length = 0
    bg?.render(dt, engine.x, engine.y, engine.speed, engine.time)
    renderer.render(engine.field, engine.x, engine.y, engine.time)
    sync(inside, x, y)

    // One-way downgrade if the device can't keep up.
    if (!degraded) {
      ema += (dt - ema) * 0.05
      if (++frames > 120 && ema > 1 / 40) {
        degraded = true
        dprCap = Math.min(dprCap, config.quality.low.dprCap)
        fieldScale = config.quality.low.fieldScale
        bgScale = config.quality.low.bgScale
        measure()
      }
    }
  }
  const play = () => {
    if (running || !alive || !onScreen || document.hidden || mode === 'still') return
    running = true
    last = 0
    raf = requestAnimationFrame(frame)
  }
  const pause = () => {
    running = false
    cancelAnimationFrame(raf)
  }

  const onVisibility = () => (document.hidden ? pause() : play())
  const onLost = () => {
    alive = false
    pause()
    hero.classList.remove('is-live', 'has-pointer', 'is-gripping')
  }
  const ro = new ResizeObserver(() => measure())
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting
    if (onScreen) play()
    else pause()
  })

  measure()
  ro.observe(hero)
  targets.forEach((el) => ro.observe(el))
  io.observe(hero)
  window.addEventListener('resize', measure)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown, { passive: true })
  window.addEventListener('mouseout', onOut)
  hero.addEventListener('focusin', onFocusIn)
  hero.addEventListener('focusout', onFocusOut)
  document.addEventListener('visibilitychange', onVisibility)
  cv.addEventListener('webglcontextlost', onLost)
  bgCanvas?.addEventListener('webglcontextlost', onLost)
  // Web fonts can move the buttons without resizing them.
  document.fonts?.ready.then(() => alive && measure())
  if (mode === 'pointer') hero.classList.add('is-live')
  play()

  return () => {
    alive = false
    pause()
    ro.disconnect()
    io.disconnect()
    window.removeEventListener('resize', measure)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    window.removeEventListener('mouseout', onOut)
    hero.removeEventListener('focusin', onFocusIn)
    hero.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('visibilitychange', onVisibility)
    cv.removeEventListener('webglcontextlost', onLost)
    bgCanvas?.removeEventListener('webglcontextlost', onLost)
    hero.classList.remove('is-live', 'has-pointer', 'is-gripping')
    for (const el of targets) {
      el.style.removeProperty('--grip')
      delete el.dataset.phase
    }
    renderer.clear()
    renderer.dispose()
    bg?.dispose()
  }
}
