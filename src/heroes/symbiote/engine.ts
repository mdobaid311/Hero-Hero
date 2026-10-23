import { config, type Quality } from './config'
import { FieldBatch } from './field'
import { perimeterLength, perimeterParam, perimeterPoint, sdRoundRect, type RoundRect } from './roundRect'

/**
 * Symbiote simulation: a spring-driven body, spring-chain tendrils and the per-button
 * hunting state machine. Each frame it writes the creature as field primitives into
 * `field` and queues background ripple impulses in `splashes`; it never touches the DOM.
 *
 * Button phases: idle → detect (inside the attraction radius: hunters start lunging and
 * snatching at it) → approach (strikes come faster and land closer) → attached (inside the
 * catch radius: crawling the perimeter, coating spreading) → retreat (letting go: goo
 * strands stretch, snap and recoil) → idle. Everything runs on springs, so nothing snaps
 * except the strands, on purpose.
 */

export type TargetPhase = 'idle' | 'detect' | 'approach' | 'attached' | 'retreat'

interface Spring {
  x: number
  v: number
}

export interface Target {
  el: HTMLElement
  rect: RoundRect
  perimeter: number
  /** Signed distance from the creature's lead point to the button edge (negative = inside). */
  dist: number
  reach: Spring // closeness: 0 at the attraction radius, 1 at the catch radius
  grip: Spring // 0: loose, 1: wrapped around the perimeter
  coat: Spring // how far the coating has spread over the face
  entry: number // smoothed perimeter arc length where the tendrils land
  hasEntry: boolean
  held: boolean // latched; letting go spawns goo strands
  seeds: Float32Array // coating blobs: dx, dy (from the centre), radius, phase
  phase: TargetPhase
}

interface Limb {
  angle: number
  length: number
  width: number
  curl: number
  hook: number // signed tip curl
  freq: number
  phase: number
  fan: number // angular offset when trailing behind a moving body
  side: number // which side its branch grows from
}

interface Filament extends Limb {
  life: number
  period: number
  env: number
}

interface Lobe {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  dist: number
  size: number
  omega: number
  freq: number
}

interface Hunter {
  index: number
  chain: Chain
  limb: Limb
  reach: Spring // 0: tip at the body, 1: touching the edge
  cycle: number // lunge phase accumulator
  open: number // claw spread
}

interface Strand {
  ax: number // anchor on the button edge
  ay: number
  life: number
  snapAt: number
  bend: number
}

interface Drop {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
}

const TAU = Math.PI * 2
const BEZ = 12 // samples along a hunter's approach curve
const STRAND = 9 // points along an unbroken goo strand

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const mix = (range: readonly number[], t: number) => range[0] + (range[1] - range[0]) * t
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mixAngle = (a: number, b: number, t: number) => {
  const d = b - a
  return a + (d - TAU * Math.round(d / TAU)) * t
}
const hash = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

function spring(s: Spring, target: number, [omega, zeta]: readonly number[], dt: number) {
  s.v += (omega * omega * (target - s.x) - 2 * zeta * omega * s.v) * dt
  s.x += s.v * dt
}

/** One strike cycle (p in 0..1): wind-up, strike, hold, recoil, rest. Drives reach toward the edge. */
function lunge(p: number) {
  if (p < 0.18) return -0.12 * Math.sin((p / 0.18) * Math.PI)
  if (p < 0.42) return smoothstep(0.18, 0.3, p)
  return 1 - smoothstep(0.42, 0.75, p)
}

/** mulberry32: the creature's anatomy and coating are identical on every load. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Points sprung toward a target pose; springs loosen toward the tip so tips lag, overshoot and recoil. */
class Chain {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly tx: Float32Array
  readonly ty: Float32Array
  readonly w: Float32Array // visible half-width per point
  readonly s: Float32Array // hunters: arc length past the landing point (< 0 = still approaching)

  constructor(readonly n: number, x0: number, y0: number) {
    this.x = new Float32Array(n).fill(x0)
    this.y = new Float32Array(n).fill(y0)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.tx = new Float32Array(n).fill(x0)
    this.ty = new Float32Array(n).fill(y0)
    this.w = new Float32Array(n)
    this.s = new Float32Array(n).fill(-1)
  }

  step(dt: number, omegaRoot: number, omegaTip: number, zeta: number) {
    const { n, x, y, vx, vy, tx, ty } = this
    x[0] = tx[0]
    y[0] = ty[0]
    for (let j = 1; j < n; j++) {
      const w = omegaRoot + (omegaTip - omegaRoot) * (j / (n - 1))
      const k = w * w
      const c = 2 * zeta * w
      vx[j] += (k * (tx[j] - x[j]) - c * vx[j]) * dt
      vy[j] += (k * (ty[j] - y[j]) - c * vy[j]) * dt
      x[j] += vx[j] * dt
      y[j] += vy[j] * dt
    }
  }

  /** Keep segments from tearing apart in fast flicks: each may stretch to `stretch`× its target length. */
  limit(stretch: number) {
    const { n, x, y, tx, ty } = this
    for (let j = 1; j < n; j++) {
      const rest = Math.hypot(tx[j] - tx[j - 1], ty[j] - ty[j - 1]) * stretch + 1
      const dx = x[j] - x[j - 1]
      const dy = y[j] - y[j - 1]
      const d = Math.hypot(dx, dy)
      if (d > rest) {
        x[j] = x[j - 1] + (dx * rest) / d
        y[j] = y[j - 1] + (dy * rest) / d
      }
    }
  }
}

export class SymbioteEngine {
  readonly field = new FieldBatch()
  /** Ripple impulses for the background since the last drain: x, y, strength triples (hero-local px). */
  readonly splashes: number[] = []
  targets: Target[] = []
  engaged = -1
  time = 0
  x: number
  y: number
  speed = 0
  private vx = 0
  private vy = 0
  private heading = 0
  private radius: number = config.body.radius
  private fast = 0
  private trail = 0
  private lean = 0
  private strike = 0 // widest claw spread this frame
  private hunterReach = 0 // furthest hunter extension this frame
  private targetAngle = 0
  private dropAcc = 0
  private readonly lobes: Lobe[] = []
  private readonly limbs: Limb[] = []
  private readonly limbChains: Chain[] = []
  private readonly hunters: Hunter[] = []
  private readonly filaments: Filament[] = []
  private readonly filamentChains: Chain[] = []
  private readonly strands: Strand[] = []
  private readonly drops: Drop[] = []
  private readonly rand = rng(0x5ee0)
  private readonly pp = { x: 0, y: 0, nx: 0, ny: 0 }
  private readonly bx = new Float32Array(BEZ + 1)
  private readonly by = new Float32Array(BEZ + 1)
  private readonly bl = new Float32Array(BEZ + 1)
  // scratch for short procedural ribbons (veins, claws, branches, strands)
  private readonly tmpX = new Float32Array(16)
  private readonly tmpY = new Float32Array(16)
  private readonly tmpW = new Float32Array(16)

  constructor(private readonly q: Quality, x: number, y: number) {
    const r = this.rand
    const { body: B, tendrils: T, hunters: H, filaments: F } = config
    this.x = x
    this.y = y
    const limb = (angle: number, length: number, width: number, curl: number, freq: number, fan: number): Limb => ({
      angle,
      length,
      width,
      curl,
      hook: (r() < 0.5 ? -1 : 1) * mix(T.hook, r()),
      freq,
      phase: r() * TAU,
      fan,
      side: r() < 0.5 ? -1 : 1,
    })
    for (let k = 0; k < B.lobes; k++) {
      this.lobes.push({
        x, y, vx: 0, vy: 0,
        angle: (k / B.lobes) * TAU + (r() - 0.5) * 0.6,
        dist: 0.36 + r() * 0.28,
        size: 0.4 + r() * 0.26,
        omega: mix(B.lobeOmega, r()),
        freq: 0.4 + r() * 0.8,
      })
    }
    for (let i = 0; i < q.tendrils; i++) {
      const fan = (q.tendrils > 1 ? i / (q.tendrils - 1) - 0.5 : 0) * 1.7
      this.limbs.push(limb((i / q.tendrils) * TAU + (r() - 0.5) * 0.5, mix(T.length, r()), mix(T.width, r()), mix(T.curl, r()), 1.1 + r() * 1.2, fan))
      this.limbChains.push(new Chain(T.points, x, y))
    }
    for (let h = 0; h < 3; h++) {
      this.hunters.push({
        index: h,
        chain: new Chain(H.points, x, y),
        limb: limb((h / 3) * TAU + 0.9, H.idleLength, 4.6, 0.4, 1.4 + h * 0.3, (h - 1) * 0.6),
        reach: { x: 0, v: 0 },
        cycle: h * 0.37, // staggered, so strikes alternate
        open: 0,
      })
    }
    for (let i = 0; i < q.filaments; i++) {
      this.filaments.push({
        ...limb(r() * TAU, mix(F.length, r()), mix(F.width, r()), 0.6, 2.5 + r() * 1.5, (r() - 0.5) * 2),
        life: r(),
        period: mix(F.period, r()),
        env: 0,
      })
      this.filamentChains.push(new Chain(F.points, x, y))
    }
    for (let i = 0; i < config.drops.max; i++) this.drops.push({ x, y, vx: 0, vy: 0, r: 0, life: 0 })
  }

  /** Register buttons (hero-local rects). Existing targets keep their springs across re-measures. */
  setTargets(list: { el: HTMLElement; rect: RoundRect }[]) {
    const engagedEl = this.targets[this.engaged]?.el
    this.targets = list.slice(0, config.interaction.maxTargets).map((item, i) => {
      const prev = this.targets.find((t) => t.el === item.el)
      const tg: Target = prev ?? {
        el: item.el,
        rect: item.rect,
        perimeter: 0,
        dist: Infinity,
        reach: { x: 0, v: 0 },
        grip: { x: 0, v: 0 },
        coat: { x: 0, v: 0 },
        entry: 0,
        hasEntry: false,
        held: false,
        seeds: new Float32Array(0),
        phase: 'idle',
      }
      const old = prev?.rect
      const resized = !old || Math.abs(old.hw - item.rect.hw) > 0.5 || Math.abs(old.hh - item.rect.hh) > 0.5 || Math.abs(old.r - item.rect.r) > 0.5
      tg.rect = item.rect
      tg.perimeter = perimeterLength(item.rect)
      if (resized) tg.seeds = makeSeeds(item.rect, 0x9e37 + i * 101)
      return tg
    })
    this.engaged = engagedEl ? this.targets.findIndex((t) => t.el === engagedEl) : -1
  }

  /** Run the simulation without rendering, e.g. to pose a still frame for reduced motion. */
  settle(x: number, y: number, seconds: number) {
    for (let i = 0; i < seconds * 60; i++) this.update(1 / 60, x, y)
    this.splashes.length = 0
  }

  update(dt: number, leadX: number, leadY: number) {
    const steps = Math.max(1, Math.ceil(dt / config.step - 1e-6))
    const h = dt / steps
    const [om, ze] = config.body.follow
    for (let i = 0; i < steps; i++) {
      this.vx += (om * om * (leadX - this.x) - 2 * ze * om * this.vx) * h
      this.vy += (om * om * (leadY - this.y) - 2 * ze * om * this.vy) * h
      this.x += this.vx * h
      this.y += this.vy * h
    }
    this.time += dt

    const sp = Math.hypot(this.vx, this.vy)
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt * 12))
    if (sp > 4) this.heading = Math.atan2(this.vy, this.vx)
    const moving = smoothstep(config.motion.moving[0], config.motion.moving[1], this.speed)
    this.fast = smoothstep(config.motion.fast[0], config.motion.fast[1], this.speed)
    this.trail = clamp01(moving * 0.35 + this.fast * 0.65)
    // Slow, deliberate movement pulls the creature in tight; at rest it relaxes.
    const compact = moving * (1 - this.fast)
    const B = config.body
    const t = this.time
    this.radius = B.radius * (1 + B.pulse * Math.sin(t * 1.9) + B.pulse * 0.5 * Math.sin(t * 4.3 + 1.3)) * (1 - 0.1 * compact)

    this.updateTargets(dt, leadX, leadY)
    this.stepLobes(steps, h, compact)
    this.stepLimbs(dt, steps, h, compact)
    this.stepResidue(dt)
    this.emit()
  }

  private updateTargets(dt: number, leadX: number, leadY: number) {
    const I = config.interaction
    const S = config.springs
    const targets = this.targets
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < targets.length; i++) {
      const d = (targets[i].dist = sdRoundRect(targets[i].rect, leadX, leadY))
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    let desired = bestD < I.attractRadius ? best : -1
    const cur = this.engaged >= 0 ? targets[this.engaged] : undefined
    // Stay with the current target while it is in range and nothing is clearly closer.
    if (cur && desired !== this.engaged && cur.dist < I.attractRadius + I.releaseSlack && (desired < 0 || targets[desired].dist > cur.dist - I.switchMargin)) {
      desired = this.engaged
    }
    // Hunters serve one target at a time: pull everything back before reaching for the next.
    if (desired !== this.engaged && (!cur || (cur.reach.x < 0.04 && cur.grip.x < 0.04 && this.hunterReach < 0.12))) this.engaged = desired

    for (let i = 0; i < targets.length; i++) {
      const tg = targets[i]
      const active = i === this.engaged && desired === i
      const wantReach = active ? smoothstep(I.attractRadius, I.attachRadius, tg.dist) : 0
      const wantGrip = active && tg.dist < I.attachRadius + (tg.grip.x > 0.5 ? I.releaseSlack : 0) ? 1 : 0
      spring(tg.reach, wantReach, wantReach > tg.reach.x ? S.reachOut : S.reachIn, dt)
      spring(tg.grip, wantGrip, wantGrip > tg.grip.x ? S.gripOn : S.gripOff, dt)
      spring(tg.coat, wantGrip, wantGrip > tg.coat.x ? S.coatOn : S.coatOff, dt)

      if (i === this.engaged) {
        // Landing point: the edge nearest the body, eased so it slides instead of jumping sides.
        const raw = perimeterParam(tg.rect, this.x, this.y)
        if (!tg.hasEntry) {
          tg.entry = raw
          tg.hasEntry = true
        } else {
          const d = raw - tg.entry
          tg.entry += (d - tg.perimeter * Math.round(d / tg.perimeter)) * (1 - Math.exp(-dt * 7))
        }
      } else if (tg.coat.x < 0.01 && tg.reach.x < 0.01) {
        tg.hasEntry = false
      }

      if (!tg.held && tg.grip.x > 0.6) {
        tg.held = true
        perimeterPoint(tg.rect, tg.entry, 0, this.pp)
        this.splashes.push(this.pp.x, this.pp.y, config.splash.latch)
      } else if (tg.held && tg.grip.x < 0.45) {
        tg.held = false
        this.spawnStrands(tg)
      }

      tg.phase = active
        ? tg.grip.x > 0.5 ? 'attached' : tg.reach.x > 0.3 ? 'approach' : 'detect'
        : tg.reach.x > 0.02 || tg.grip.x > 0.02 || tg.coat.x > 0.02 ? 'retreat' : 'idle'
    }

    const eng = targets[this.engaged]
    this.lean = eng ? clamp01(eng.reach.x * 0.7 + 0.3 * (eng.phase === 'idle' || eng.phase === 'retreat' ? 0 : 1)) : 0
    // While gripping, the body pours itself into the button and thins out over the label.
    if (eng) this.radius *= 1 - 0.22 * clamp01(eng.grip.x)
    if (eng) {
      perimeterPoint(eng.rect, eng.entry, 0, this.pp)
      this.targetAngle = Math.atan2(this.pp.y - this.y, this.pp.x - this.x)
    }
  }

  private stepLobes(steps: number, h: number, compact: number) {
    const R = this.radius
    const t = this.time
    const ux = Math.cos(this.heading)
    const uy = Math.sin(this.heading)
    const e = this.fast
    // Lean the whole mass toward a target it is hunting, lurching forward on every strike.
    const lean = this.lean * config.body.lean * (1 + 0.8 * this.strike)
    const lx = Math.cos(this.targetAngle) * lean
    const ly = Math.sin(this.targetAngle) * lean
    const zeta = config.body.lobeZeta
    for (const lobe of this.lobes) {
      const a = lobe.angle + 0.3 * Math.sin(t * lobe.freq + lobe.angle * 3)
      const d = lobe.dist * R * (1 + 0.1 * Math.sin(t * 1.3 + lobe.angle * 5))
      const ox = Math.cos(a) * d
      const oy = Math.sin(a) * d
      // Stretch along the heading and pull lobes backward into a teardrop when fast.
      const along = (ox * ux + oy * uy) * (1 + 0.8 * e) - e * R * 0.45
      const across = (oy * ux - ox * uy) * (1 - 0.28 * e - 0.2 * compact)
      const tx = this.x + along * ux - across * uy + lx
      const ty = this.y + along * uy + across * ux + ly
      const k = lobe.omega * lobe.omega
      const c = 2 * zeta * lobe.omega
      for (let i = 0; i < steps; i++) {
        lobe.vx += (k * (tx - lobe.x) - c * lobe.vx) * h
        lobe.vy += (k * (ty - lobe.y) - c * lobe.vy) * h
        lobe.x += lobe.vx * h
        lobe.y += lobe.vy * h
      }
    }
  }

  private stepLimbs(dt: number, steps: number, h: number, compact: number) {
    const { tendrils: T, hunters: H, filaments: F } = config
    const R = this.radius

    for (let i = 0; i < this.limbs.length; i++) {
      const limb = this.limbs[i]
      const c = this.limbChains[i]
      const ang = this.limbAngle(limb)
      let reach = (0.85 + 0.15 * Math.sin(this.time * 0.9 + limb.phase)) * (1 - 0.38 * compact) * (1 + 0.45 * this.fast)
      // Tendrils facing a hunted button stretch toward it too.
      if (this.lean > 0) reach *= 1 + 0.6 * this.lean * Math.max(0, Math.cos(ang - this.targetAngle))
      this.curlPose(c, limb, ang, limb.length * reach, limb.width, R * 0.3)
      // The odd involuntary flick keeps it from ever looking mechanical.
      if (this.rand() < dt * T.twitch) {
        const kick = (this.rand() - 0.5) * 840
        const px = -Math.sin(ang)
        const py = Math.cos(ang)
        for (let j = c.n >> 1; j < c.n; j++) {
          const s = j / (c.n - 1)
          c.vx[j] += px * kick * s
          c.vy[j] += py * kick * s
        }
      }
      for (let s = 0; s < steps; s++) c.step(h, T.omegaRoot, T.omegaTip, T.zeta)
      c.limit(T.stretch)
    }

    const eng = this.targets[this.engaged]
    const hunting = !!eng && eng.phase !== 'retreat' && eng.phase !== 'idle'
    const close = eng ? clamp01(eng.reach.x) : 0
    const grip = eng ? clamp01(eng.grip.x) : 0
    const LG = H.lunge
    this.strike = 0
    this.hunterReach = 0
    for (const hu of this.hunters) {
      const c = hu.chain
      this.curlPose(c, hu.limb, this.limbAngle(hu.limb), hu.limb.length * (1 - 0.3 * compact), hu.limb.width, R * 0.3)
      let want = 0
      let open = 0
      if (hunting) {
        // Snatching: strikes speed up and land closer as the pointer nears, falling just short
        // of the edge until the pointer is inside the catch radius and they connect.
        hu.cycle += dt / mix(LG.period, close)
        const p = hu.cycle % 1
        want = mix(LG.base, close) + mix(LG.amp, close) * lunge(p)
        want += (1 - want) * smoothstep(0, 0.3, grip) // once one grabs hold, all of them latch
        open = smoothstep(0.16, 0.26, p) * (1 - smoothstep(0.36, 0.46, p)) * (1 - grip)
      }
      spring(hu.reach, want, want > hu.reach.x ? LG.out : LG.back, dt)
      hu.open += (open - hu.open) * (1 - Math.exp(-dt * 18))
      this.strike = Math.max(this.strike, hu.open)
      this.hunterReach = Math.max(this.hunterReach, hu.reach.x)
      const blend = eng ? smoothstep(0.02, 0.2, hu.reach.x) : 0
      if (eng && blend > 0) this.huntPose(eng, hu, blend)
      else c.s.fill(-1)
      for (let s = 0; s < steps; s++) c.step(h, H.omegaRoot, H.omegaTip, H.zeta)
      c.limit(T.stretch)
    }

    // Short-lived filaments sprout at random points, wriggle, and are reabsorbed.
    for (let i = 0; i < this.filaments.length; i++) {
      const fil = this.filaments[i]
      const c = this.filamentChains[i]
      fil.life += dt / fil.period
      if (fil.life >= 1) {
        fil.life -= 1
        fil.angle = this.rand() * TAU
        fil.length = mix(F.length, this.rand())
        fil.phase = this.rand() * TAU
      }
      fil.env = Math.sin(Math.PI * fil.life) ** 2
      this.curlPose(c, fil, this.limbAngle(fil), fil.length * fil.env, fil.width * Math.sqrt(fil.env), R * 0.55)
      for (let s = 0; s < steps; s++) c.step(h, 34, 16, 0.4)
    }
  }

  /** Goo strands left behind on release, and droplets flung off fast moves. */
  private stepResidue(dt: number) {
    const S = config.strands
    for (let i = this.strands.length - 1; i >= 0; i--) {
      const s = this.strands[i]
      const before = s.life
      s.life += dt
      if (s.life < s.snapAt && Math.hypot(this.x - s.ax, this.y - s.ay) > S.maxLength) s.snapAt = s.life
      if (before < s.snapAt && s.life >= s.snapAt) this.splashes.push(s.ax, s.ay, config.splash.snap)
      if (s.life > s.snapAt + S.retract) {
        this.strands[i] = this.strands[this.strands.length - 1]
        this.strands.pop()
      }
    }

    const D = config.drops
    if (this.speed > D.minSpeed) {
      this.dropAcc += dt * (this.speed - D.minSpeed) * D.rate
      const ux = Math.cos(this.heading)
      const uy = Math.sin(this.heading)
      const R = this.radius
      while (this.dropAcc >= 1) {
        this.dropAcc -= 1
        let d: Drop | undefined
        for (const q of this.drops) {
          if (q.life <= 0) {
            d = q
            break
          }
        }
        if (!d) break
        const side = (this.rand() - 0.5) * R * 0.9
        d.x = this.x - ux * R * 0.8 - uy * side
        d.y = this.y - uy * R * 0.8 + ux * side
        d.vx = this.vx * 0.12
        d.vy = this.vy * 0.12
        d.r = mix(D.size, this.rand())
        d.life = 1
      }
    } else {
      this.dropAcc = 0
    }
    const drag = Math.exp(-dt * 7)
    for (const d of this.drops) {
      if (d.life <= 0) continue
      d.life -= dt / D.life
      d.vx *= drag
      d.vy *= drag
      d.x += d.vx * dt
      d.y += d.vy * dt
    }
  }

  private spawnStrands(tg: Target) {
    const S = config.strands
    for (let k = 0; k < S.count; k++) {
      perimeterPoint(tg.rect, tg.entry + (k - (S.count - 1) / 2) * 26, 0, this.pp)
      this.strands.push({ ax: this.pp.x, ay: this.pp.y, life: 0, snapAt: mix(S.snap, this.rand()), bend: (this.rand() - 0.5) * 2 })
    }
  }

  /** Rest direction of a limb: idle sway, swept back into a fan behind a moving body. */
  private limbAngle(limb: Limb) {
    const a = limb.angle + 0.35 * Math.sin(this.time * 0.6 * limb.freq + limb.phase)
    return mixAngle(a, this.heading + Math.PI + limb.fan, this.trail)
  }

  /**
   * Idle pose, grown segment by segment from the body: a wave travels root to tip,
   * the tip hooks over like a tentacle, and the root flares where it leaves the mass.
   */
  private curlPose(c: Chain, limb: Limb, ang: number, len: number, width: number, rootR: number) {
    const n = c.n
    const t = this.time
    const seg = len / (n - 1)
    const hook = limb.hook * (0.75 + 0.25 * Math.sin(t * 0.8 + limb.phase))
    let px = this.x + Math.cos(ang) * rootR
    let py = this.y + Math.sin(ang) * rootR
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1)
      if (j > 0) {
        const th = ang + limb.curl * Math.sin(t * limb.freq - u * 3.4 + limb.phase) * (0.4 + u) + hook * u * u * u
        px += Math.cos(th) * seg
        py += Math.sin(th) * seg
      }
      c.tx[j] = px
      c.ty[j] = py
      const v = 1 - u
      c.w[j] = width * Math.pow(v, 0.85) * (1 + 0.9 * v * v * v * v)
    }
  }

  /**
   * Hunting pose, blended over the idle pose: a curved approach from the body to a landing
   * point on the edge (covered `reach` of the way), then a crawl along the perimeter
   * (hunters 0 and 1, opposite directions) or across the face (hunter 2), `grip` of the way.
   */
  private huntPose(tg: Target, hu: Hunter, blend: number) {
    const H = config.hunters
    const h = hu.index
    const c = hu.chain
    const rr = tg.rect
    const p = this.pp
    const t = this.time
    const reach = clamp01(hu.reach.x)
    const grip = clamp01(tg.grip.x)
    const s0 = tg.entry + H.spread[h]
    perimeterPoint(rr, s0, H.edgeOffset, p)
    const ex = p.x
    const ey = p.y
    const enx = p.nx
    const eny = p.ny

    let dx = ex - this.x
    let dy = ey - this.y
    const dist = Math.hypot(dx, dy) || 1
    dx /= dist
    dy /= dist
    const x0 = this.x + dx * this.radius * 0.3
    const y0 = this.y + dy * this.radius * 0.3
    const bend = Math.min(dist * 0.3, 44) * H.side[h] + Math.sin(t * 1.7 + h * 2.1) * 5
    // Land along the edge normal: from outside while approaching, from inside once the body is on the button.
    const land = Math.max(-1, Math.min(1, sdRoundRect(rr, this.x, this.y) / 24)) * dist * 0.35
    const x1 = x0 + dx * dist * 0.35 - dy * bend
    const y1 = y0 + dy * dist * 0.35 + dx * bend
    const x2 = ex + enx * land
    const y2 = ey + eny * land

    const { bx, by, bl } = this
    let L = 0
    for (let i = 0; i <= BEZ; i++) {
      const u = i / BEZ
      const v = 1 - u
      const px = v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * ex
      const py = v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * ey
      if (i > 0) L += Math.hypot(px - bx[i - 1], py - by[i - 1])
      bx[i] = px
      by[i] = py
      bl[i] = L
    }
    L = Math.max(L, 1e-3)

    const toCentre = Math.hypot(rr.cx - ex, rr.cy - ey)
    const crawlMax = h < 2 ? Math.min(tg.perimeter * H.wrap, H.crawlMax) : Math.min(toCentre + rr.hw * 0.55, H.faceMax)
    const total = L * reach + grip * crawlMax * smoothstep(0.7, 1, reach)
    const tip = Math.max(Math.min(34, total * 0.45), 1)
    let seg = 1
    for (let j = 0; j < c.n; j++) {
      const s = (total * j) / (c.n - 1)
      let px: number, py: number, w: number
      if (s <= L) {
        while (seg < BEZ && bl[seg] < s) seg++
        const a = bl[seg - 1]
        const k = bl[seg] > a ? (s - a) / (bl[seg] - a) : 0
        px = bx[seg - 1] + (bx[seg] - bx[seg - 1]) * k
        py = by[seg - 1] + (by[seg] - by[seg - 1]) * k
        w = H.width * (1 - (0.4 * s) / L)
      } else {
        const u = s - L
        this.crawlPoint(tg, h, s0, ex, ey, toCentre, u)
        px = p.x
        py = p.y
        w = H.width * 0.6 * (1 - (0.3 * u) / crawlMax)
      }
      w *= Math.pow(clamp01((total - s) / tip), 0.7)
      c.tx[j] += (px - c.tx[j]) * blend
      c.ty[j] += (py - c.ty[j]) * blend
      c.w[j] += (w - c.w[j]) * blend
      c.s[j] = s - L
    }
  }

  /** Writes into `this.pp` the point `u` px into a hunter's crawl. */
  private crawlPoint(tg: Target, h: number, s0: number, ex: number, ey: number, toCentre: number, u: number) {
    const rr = tg.rect
    const t = this.time
    const out = this.pp
    if (h < 2) {
      const wobble = Math.sin(u * 0.11 + t * 2.3 + h * 1.7) * 1.3
      perimeterPoint(rr, s0 + (h === 0 ? -u : u), config.hunters.edgeOffset + wobble, out)
      return
    }
    // Third hunter creeps over the face: to the centre, then along the long axis.
    let dx: number, dy: number, px: number, py: number
    if (u <= toCentre || toCentre < 1e-3) {
      dx = (rr.cx - ex) / (toCentre || 1)
      dy = (rr.cy - ey) / (toCentre || 1)
      px = ex + dx * u
      py = ey + dy * u
    } else {
      const wide = rr.hw >= rr.hh
      const sgn = (wide ? ex < rr.cx : ey < rr.cy) ? 1 : -1
      dx = wide ? sgn : 0
      dy = wide ? 0 : sgn
      px = rr.cx + dx * (u - toCentre)
      py = rr.cy + dy * (u - toCentre)
    }
    const wig = Math.sin(u * 0.09 + t * 1.4) * 6 * smoothstep(0, 24, u)
    out.x = px - dy * wig
    out.y = py + dx * wig
  }

  private emit() {
    const f = this.field
    const R = this.radius
    const t = this.time
    const sub = this.q.subdivisions
    f.reset()

    // Body: a dense core plus sprung lobes that summed together make an irregular mass.
    f.blob(this.x, this.y, R * 0.78, 1)
    for (const lobe of this.lobes) f.blob(lobe.x, lobe.y, R * lobe.size * (1 + 0.1 * Math.sin(t * lobe.freq * 2 + lobe.angle)), 0.9)
    if (this.fast > 0.02) {
      const bx = -Math.cos(this.heading)
      const by = -Math.sin(this.heading)
      const e = this.fast
      f.blob(this.x + bx * R * 0.8 * e, this.y + by * R * 0.8 * e, R * 0.5, 0.8 * e)
      f.blob(this.x + bx * R * 1.45 * e, this.y + by * R * 1.45 * e, R * 0.32, 0.75 * e)
    }
    // Pseudopod: the mass itself flows toward its prey, surging with every strike.
    if (this.lean > 0.05) {
      const ca = Math.cos(this.targetAngle)
      const sa = Math.sin(this.targetAngle)
      const s = this.lean * (0.55 + 0.45 * this.strike)
      f.blob(this.x + ca * R * 0.8 * s, this.y + sa * R * 0.8 * s, R * 0.5, 0.85 * s)
      f.blob(this.x + ca * R * 1.3 * s, this.y + sa * R * 1.3 * s, R * 0.3, 0.8 * s)
    }

    for (const c of this.limbChains) f.ribbon(c.x, c.y, c.w, c.n, 1, sub)
    this.emitBranches()
    const eng = this.targets[this.engaged]
    for (const hu of this.hunters) {
      const c = hu.chain
      f.ribbon(c.x, c.y, c.w, c.n, 1, sub)
      if (hu.open > 0.03) this.emitClaw(hu)
      if (eng && hu.index < 2 && eng.grip.x > 0.05) this.emitVeins(eng, c, hu.index)
    }
    for (let i = 0; i < this.filaments.length; i++) {
      const c = this.filamentChains[i]
      if (this.filaments[i].env > 0.03) f.ribbon(c.x, c.y, c.w, c.n, 1, 2)
    }
    for (const s of this.strands) this.emitStrand(s)
    for (const d of this.drops) if (d.life > 0) f.blob(d.x, d.y, d.r * Math.sqrt(d.life), 0.95)

    for (let i = 0; i < this.targets.length; i++) {
      f.setClip(i, this.targets[i].rect)
      this.emitCoating(this.targets[i], i)
    }
  }

  /** A curling side branch halfway along each main tendril. */
  private emitBranches() {
    const T = config.tendrils
    const t = this.time
    const { tmpX: xs, tmpY: ys, tmpW: ws } = this
    for (let i = 0; i < this.limbChains.length; i++) {
      const c = this.limbChains[i]
      const limb = this.limbs[i]
      const k = Math.round((c.n - 1) * 0.5)
      if (c.w[k] < 0.8) continue
      const a = Math.atan2(c.y[k + 1] - c.y[k - 1], c.x[k + 1] - c.x[k - 1]) + limb.side * (0.7 + 0.2 * Math.sin(t * 1.9 + limb.phase))
      const len = limb.length * T.branch * (0.85 + 0.15 * Math.sin(t * 1.3 + limb.phase))
      for (let j = 0; j < 4; j++) {
        const u = j / 3
        const b = a + limb.side * u * u * 0.9
        xs[j] = c.x[k] + Math.cos(b) * len * u
        ys[j] = c.y[k] + Math.sin(b) * len * u
        ws[j] = c.w[k] * 0.55 * Math.pow(1 - u, 0.9)
      }
      this.field.ribbon(xs, ys, ws, 4, 1, 2)
    }
  }

  /** Three talons at a striking hunter's tip: they splay open on the strike and close on the grab. */
  private emitClaw(hu: Hunter) {
    const CL = config.claws
    const c = hu.chain
    const n = c.n
    const open = hu.open
    const dx = c.x[n - 1] - c.x[n - 4]
    const dy = c.y[n - 1] - c.y[n - 4]
    if (dx * dx + dy * dy < 1) return
    const a0 = Math.atan2(dy, dx)
    const bx = c.x[n - 2]
    const by = c.y[n - 2]
    const { tmpX: xs, tmpY: ys, tmpW: ws } = this
    for (let finger = -1; finger <= 1; finger++) {
      const len = CL.length * open * (finger === 0 ? 0.75 : 1)
      for (let k = 0; k < 4; k++) {
        const u = k / 3
        const a = a0 + finger * CL.spread * open - finger * u * u * 1.3 * open
        xs[k] = bx + Math.cos(a) * len * u
        ys[k] = by + Math.sin(a) * len * u
        ws[k] = CL.width * Math.pow(1 - u, 0.8)
      }
      this.field.ribbon(xs, ys, ws, 4, 1, 2)
    }
  }

  /** A stretched goo strand: necks thin as it stretches, then snaps and both halves recoil. */
  private emitStrand(s: Strand) {
    const S = config.strands
    const ax = s.ax
    const ay = s.ay
    const bx = this.x
    const by = this.y
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    const cx = (ax + bx) / 2 - (dy / len) * s.bend * len * 0.18
    const cy = (ay + by) / 2 + (dx / len) * s.bend * len * 0.18 + len * 0.1 // sags under its own weight
    if (s.life < s.snapAt) {
      const thin = Math.pow(1 - s.life / s.snapAt, 0.5)
      const { tmpX: xs, tmpY: ys, tmpW: ws } = this
      for (let k = 0; k < STRAND; k++) {
        const u = k / (STRAND - 1)
        const v = 1 - u
        xs[k] = v * v * ax + 2 * v * u * cx + u * u * bx
        ys[k] = v * v * ay + 2 * v * u * cy + u * u * by
        ws[k] = S.width * (0.25 + 0.75 * Math.pow(Math.abs(2 * u - 1), 1.5)) * (0.35 + 0.65 * thin)
      }
      this.field.ribbon(xs, ys, ws, STRAND, 1, 2)
      return
    }
    const e = 1 - (1 - clamp01((s.life - s.snapAt) / S.retract)) ** 2
    this.strandHalf(ax, ay, cx, cy, bx, by, 0, 0.5 * (1 - e))
    this.strandHalf(ax, ay, cx, cy, bx, by, 1, 0.5 + 0.5 * e)
  }

  /** One recoiling half of a snapped strand: from end `u0` toward `u1`, tapering to a point. */
  private strandHalf(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, u0: number, u1: number) {
    if (Math.abs(u1 - u0) < 0.01) return
    const { tmpX: xs, tmpY: ys, tmpW: ws } = this
    for (let k = 0; k < 5; k++) {
      const u = u0 + ((u1 - u0) * k) / 4
      const v = 1 - u
      xs[k] = v * v * ax + 2 * v * u * cx + u * u * bx
      ys[k] = v * v * ay + 2 * v * u * cy + u * u * by
      ws[k] = config.strands.width * 0.8 * Math.pow(1 - k / 4, 0.7)
    }
    this.field.ribbon(xs, ys, ws, 5, 1, 2)
  }

  /** Branching veins off the perimeter crawlers: mostly inward over the face, the odd hair outward. */
  private emitVeins(tg: Target, c: Chain, h: number) {
    const V = config.veins
    const rr = tg.rect
    const p = this.pp
    const t = this.time
    const grip = clamp01(tg.grip.x)
    const { tmpX: vx, tmpY: vy, tmpW: vw } = this
    for (let j = 2; j < c.n - 2; j += 2) {
      if (c.s[j] < 10) continue
      perimeterPoint(rr, perimeterParam(rr, c.x[j], c.y[j]), 0, p)
      const outward = (j / 2 + h) % 3 === 0
      const dir = outward ? 1 : -1
      const len = grip * mix(V.length, hash(j + h * 31)) * (outward ? 0.45 : 1) * (0.8 + 0.2 * Math.sin(t * 1.6 + j))
      if (len < 1) continue
      const dx = p.nx * dir
      const dy = p.ny * dir
      const w = Math.min(V.width, c.w[j] * 0.8)
      for (let k = 0; k < 4; k++) {
        const u = k / 3
        const wig = Math.sin(u * 2.4 + t * 1.3 + j) * 2.4 * u
        vx[k] = c.x[j] + dx * len * u - dy * wig
        vy[k] = c.y[j] + dy * len * u + dx * wig
        vw[k] = w * Math.pow(1 - u, 0.8)
      }
      this.field.ribbon(vx, vy, vw, 4, 1, 2)
    }
  }

  /** Coating seeds switch on outward from the landing point as `coat` grows, clipped to the button shape. */
  private emitCoating(tg: Target, slot: number) {
    const coat = clamp01(tg.coat.x)
    if (coat < 0.01) return
    const rr = tg.rect
    const t = this.time
    const origin = perimeterPoint(rr, tg.entry, 0, this.pp)
    const spread = coat * rr.hw * 2 * config.coating.spread
    const s = tg.seeds
    for (let k = 0; k < s.length; k += 4) {
      const ph = s[k + 3]
      const x = rr.cx + s[k] + Math.sin(t * 0.5 + ph) * 3
      const y = rr.cy + s[k + 1] + Math.cos(t * 0.43 + ph) * 2
      const w = 1 - smoothstep(spread - 40, spread, Math.hypot(x - origin.x, y - origin.y))
      if (w <= 0.01) continue
      const r = s[k + 2] * Math.sqrt(w) * (0.88 + 0.12 * Math.sin(t * 1.3 + ph)) * Math.min(1, coat * 3)
      this.field.blob(x, y, r, config.coating.amp, slot + 1)
    }
  }
}

/** Coating blob layout for one button: a ring just inside the edge plus a scatter over the face. */
function makeSeeds(rr: RoundRect, seed: number): Float32Array {
  const C = config.coating
  const r = rng(seed)
  const P = perimeterLength(rr)
  const edge = Math.max(8, Math.min(24, Math.round(P / C.edgeSpacing)))
  const inner = Math.max(3, Math.min(10, Math.round((rr.hw * rr.hh) / 450)))
  const out = new Float32Array((edge + inner) * 4)
  const p = { x: 0, y: 0, nx: 0, ny: 0 }
  let o = 0
  for (let k = 0; k < edge; k++) {
    perimeterPoint(rr, ((k + r() * 0.6) / edge) * P, -mix(C.inset, r()), p)
    out[o++] = p.x - rr.cx
    out[o++] = p.y - rr.cy
    out[o++] = rr.hh * (0.3 + r() * 0.25)
    out[o++] = r() * TAU
  }
  for (let k = 0; k < inner; k++) {
    out[o++] = (r() * 2 - 1) * Math.max(rr.hw - rr.hh * 0.6, 0)
    out[o++] = (r() * 2 - 1) * rr.hh * 0.5
    out[o++] = rr.hh * (0.26 + r() * 0.26)
    out[o++] = r() * TAU
  }
  return out
}
