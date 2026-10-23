import type { ReactNode } from 'react'
import BrandReveal from './heroes/brand-reveal/BrandReveal'
import SymbioteHero from './heroes/symbiote/SymbioteHero'

// Add a hero: append an entry here. Route is /hero/<slug>.
export const heroes: { slug: string; title: string; desc: string; render: () => ReactNode }[] = [
  {
    slug: 'brand-reveal',
    title: 'Cinematic Brand Reveal',
    desc: 'Scroll-driven geometric car mosaic that assembles around a shining logo.',
    render: () => <BrandReveal />,
  },
  {
    slug: 'symbiote',
    title: 'Living Symbiote Cursor',
    desc: 'A glossy black organism follows the pointer and infects the buttons it reaches.',
    render: () => <SymbioteHero />,
  },
]
