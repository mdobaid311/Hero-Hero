import type { ReactNode } from 'react'
import BrandReveal from './heroes/brand-reveal/BrandReveal'

// Add a hero: append an entry here. Route is /hero/<slug>.
export const heroes: { slug: string; title: string; desc: string; render: () => ReactNode }[] = [
  {
    slug: 'brand-reveal',
    title: 'Cinematic Brand Reveal',
    desc: 'Scroll-driven geometric car mosaic that assembles around a shining logo.',
    render: () => <BrandReveal />,
  },
]
