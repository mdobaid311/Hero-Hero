/**
 * Symbiote — every tunable for the creature, its hunting behaviour and its look.
 * Distances are CSS px, times are seconds, springs are [omega (rad/s), zeta (damping ratio)].
 */
export const config = {
  /** Fixed physics sub-step; frames are split into steps no longer than this. */
  step: 1 / 120,

  interaction: {
    attractRadius: 170, // distance from a button's edge where the creature notices it
    attachRadius: 30, // distance from the edge where tendrils latch on
    releaseSlack: 22, // hysteresis so a pointer hovering on the boundary doesn't flicker
    switchMargin: 30, // another button must be this much closer to steal the creature
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
    lobes: 7,
    lobeOmega: [12, 24],
    lobeZeta: 0.4,
    pulse: 0.05,
  },

  /** Body speed (px/s) thresholds: below `moving` it rests, above `fast` it stretches out. */
  motion: { moving: [12, 140], fast: [420, 1600] },

  tendrils: {
    points: 14,
    length: [56, 112],
    width: [5, 7.5],
    curl: [0.3, 0.55],
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
  },

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
    glow: 0.05, // ambient light the creature carries on the background
    glowSigma: 260,
  },

  quality: {
    high: { dprCap: 2, fieldScale: 1, tendrils: 6, filaments: 6, subdivisions: 3 },
    low: { dprCap: 1.25, fieldScale: 0.65, tendrils: 4, filaments: 3, subdivisions: 2 },
  },
}

export type Quality = (typeof config.quality)[keyof typeof config.quality]
