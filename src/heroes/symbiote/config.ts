/**
 * Symbiote — every tunable for the creature, its hunting behaviour and its look.
 * Distances are CSS px, times are seconds, springs are [omega (rad/s), zeta (damping ratio)].
 */
export const config = {
  /** Fixed physics sub-step; frames are split into steps no longer than this. */
  step: 1 / 120,

  interaction: {
    attractRadius: 240, // distance from a button's edge where the creature starts snatching at it
    attachRadius: 60, // catch radius: inside this, the lunges connect and it latches on
    releaseSlack: 28, // hysteresis so a pointer hovering on the boundary doesn't flicker
    switchMargin: 34, // another button must be this much closer to steal the creature
    maxTargets: 4, // shader clip slots
  },

  springs: {
    reachOut: [9, 0.72],
    reachIn: [13, 0.5], // under-damped: tendrils snap back past the body and settle
    gripOn: [6.5, 0.85],
    gripOff: [11, 0.55],
    coatOn: [2.6, 1], // the coating spreads slower than the tendrils crawl
    coatOff: [6, 0.9],
  },

  body: {
    radius: 33,
    follow: [16, 0.7], // spring from the body to the pointer
    lobes: 8,
    lobeOmega: [11, 24],
    lobeZeta: 0.4,
    pulse: 0.05,
    lean: 16, // how far the mass shifts toward a button it is hunting
  },

  /** Body speed (px/s) thresholds: below `moving` it rests, above `fast` it stretches out. */
  motion: { moving: [12, 140], fast: [420, 1600] },

  tendrils: {
    points: 14,
    length: [56, 118],
    width: [4.6, 7.2],
    curl: [0.25, 0.5], // travelling wave along each tendril (radians)
    hook: [0.35, 0.9], // how hard the tips curl over
    branch: 0.3, // side-branch length as a fraction of the tendril
    twitch: 0.3, // random flicks per tendril per second
    omegaRoot: 30,
    omegaTip: 8,
    zeta: 0.3,
    stretch: 1.9, // max segment stretch before the chain is pulled taut
  },

  hunters: {
    points: 26,
    width: 6.2,
    idleLength: 30,
    spread: [-15, 15, 0], // perimeter offset of each hunter's landing point
    side: [-1, 1, 0.35], // which way each approach curve bows
    edgeOffset: 0.5, // crawlers ride this far outside the edge, straddling it
    wrap: 0.44, // fraction of the perimeter each crawler can cover
    crawlMax: 300,
    faceMax: 130,
    omegaRoot: 28,
    omegaTip: 15,
    zeta: 0.55,
    /** Snatching at a nearby button; [far, near] pairs interpolate with how close the pointer is. */
    lunge: {
      period: [1.4, 0.6], // seconds per strike
      base: [0.18, 0.5], // resting reach between strikes (fraction of the way to the edge)
      amp: [0.5, 0.47], // extra reach at the peak of a strike; base + amp stays just shy of 1
      out: [24, 0.4], // strike spring: fast, overshooting
      back: [14, 0.55], // recoil spring
    },
  },

  claws: { length: 21, width: 2.6, spread: 0.85 }, // fingers that open on a strike and snap shut

  strands: {
    count: 3, // goo strands left stretched between button and body on release
    width: 2.8,
    snap: [0.28, 0.6], // seconds until a strand snaps
    maxLength: 300, // or as soon as it is stretched this far
    retract: 0.24, // seconds for the snapped halves to recoil
  },

  drops: { max: 28, rate: 0.02, minSpeed: 320, size: [2, 5.5], life: 0.75 }, // residue flung off fast moves

  /** Ripple impulses sent to the background. */
  splash: { latch: 0.5, snap: 0.3, click: 0.4 },

  filaments: {
    points: 7,
    length: [14, 34],
    width: [1.3, 2.1],
    period: [2.4, 5.2],
  },

  veins: { length: [7, 22], width: 2.4 },

  coating: {
    amp: 0.8,
    spread: 0.55, // fraction of the button width the coating reaches at full grip
    edgeSpacing: 32, // one seed per this many px of perimeter
    inset: [3, 9],
  },

  render: {
    threshold: 0.5, // iso level of the metaball field
    heightRange: 2.4, // field scale of the height curve; larger = gentler, rounder dome
    bump: 18, // normal strength
    shadow: 0.55,
    glow: 0.025, // light the creature casts over nearby UI (the background has its own)
    glowSigma: 260,
  },

  /** The void: a black liquid pool rippled by the creature. */
  background: {
    cell: 3, // CSS px per ripple-simulation cell
    damping: 0.988, // per 60 Hz step: rings fade within ~1.5 s, like something viscous
    wake: 0.07, // trough dragged along by the moving body
    heartbeat: 0.03, // ring emitted on each beat at rest
    beatPeriod: 1.4,
    ripple: 9, // ripple normal strength
    oil: 0.9, // slow swell normal strength
    sheen: 0.38,
    veins: 0.06, // capillaries lit around the creature
  },

  quality: {
    high: { dprCap: 2, fieldScale: 1, tendrils: 7, filaments: 7, subdivisions: 3, bgScale: 0.6 },
    low: { dprCap: 1.25, fieldScale: 0.65, tendrils: 4, filaments: 3, subdivisions: 2, bgScale: 0.4 },
  },
}

export type Quality = (typeof config.quality)[keyof typeof config.quality]
