import { collateCss } from "@collate/core/ui"
import { useEffect } from "react"
import { ThemeToggle } from "./components/ThemeToggle"
import { Icon } from "./components/ui"
import { href, useRoute } from "./lib/router"
import { Coordinate } from "./pages/Coordinate"
import { Explore } from "./pages/Explore"
import { Landing } from "./pages/Landing"
import { Observe } from "./pages/Observe"
import { Results } from "./pages/Results"

// `match` lists every path that marks a nav item as current: /explore is Studio's old address.
const PAGES = [
  { path: "/results", label: "Results", match: ["/results"] },
  { path: "/observe", label: "Observer", match: ["/observe"] },
  { path: "/coordinate", label: "Coordinator", match: ["/coordinate"] },
  { path: "/studio", label: "Studio", match: ["/studio", "/explore"] },
]

export function App() {
  const route = useRoute()
  const page =
    route.path === "/results" ? <Results params={route.params} /> :
    route.path === "/observe" ? <Observe /> :
    route.path === "/coordinate" ? <Coordinate /> :
    route.path === "/studio" || route.path === "/explore" ? <Explore params={route.params} /> :
    <Landing />

  // Hash routing keeps the scroll position between pages, so start each page at the top.
  useEffect(() => window.scrollTo(0, 0), [route.path])

  return (
    <div className="collate-root">
      <style>{collateCss}</style>
      <div className="topbar-wrap">
        <div className="shell">
          <header className="topbar">
            <a className="brand" href={href("/")}>
              <span className="brand-mark">
                <Icon name="chart" size={18} />
              </span>
              <span>
                <span className="brand-name">Collate</span>
                <span className="brand-tag">Observer-agreed results, read straight from Arkiv</span>
              </span>
            </a>
            <div className="topbar-right">
              <nav className="nav" aria-label="Pages">
                {PAGES.map((p) => (
                  <a key={p.path} href={href(p.path)} aria-current={p.match.includes(route.path) ? "page" : undefined}>
                    {p.label}
                  </a>
                ))}
              </nav>
              <ThemeToggle />
            </div>
          </header>
        </div>
      </div>
      <main className="shell">
        {page}
        <footer className="site">
          <p>
            Collate and Collate Studio run on one open engine, collate-core. Every number is read straight from Arkiv's public RPC
            on the Tiramisu testnet (chain 7738577). There is no Collate server: anyone can serve this page, fork it, or query the
            same entities directly. Testnet block production is still centralised, so the claim is "readable and verifiable by
            anyone without our backend", not "impossible to stop".
          </p>
          <p>
            All data is synthetic: a fictional election, fictional parties and units, and observers identified only by wallet and
            alias. Open source under MIT ·{" "}
            <a href="https://github.com/Evangel90/collate" target="_blank" rel="noreferrer">
              github.com/Evangel90/collate
            </a>
          </p>
        </footer>
      </main>
    </div>
  )
}
