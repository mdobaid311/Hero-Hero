import { Link, Route, Routes, useParams } from 'react-router-dom'
import { heroes } from './heroes'
import { useLenis } from './useLenis'

function Home() {
  return (
    <main className="home">
      <h1>Hero Sections</h1>
      <div className="grid">
        {heroes.map((h) => (
          <Link key={h.slug} to={`/hero/${h.slug}`} className="tile">
            <h2>{h.title}</h2>
            <p>{h.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  )
}

function Hero() {
  const { slug } = useParams()
  const hero = heroes.find((h) => h.slug === slug)
  return (
    <>
      <Link to="/" className="back">← All heroes</Link>
      {hero ? hero.render() : <p className="back">Not found.</p>}
    </>
  )
}

export default function App() {
  useLenis()
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/hero/:slug" element={<Hero />} />
    </Routes>
  )
}
