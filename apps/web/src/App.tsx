import { collateCss } from "@collate/core/ui"
import { ThemeToggle } from "./components/ThemeToggle"
import { Icon } from "./components/ui"
import { href, useRoute } from "./lib/router"
import { Coordinate } from "./pages/Coordinate"
import { Explore } from "./pages/Explore"
import { Observe } from "./pages/Observe"
import { Results } from "./pages/Results"

const PAGES = [
  { path: "/", label: "Results" },
  { path: "/observe", label: "Observer" },
  { path: "/coordinate", label: "Coordinator" },
  { path: "/explore", label: "collate-core" },
]

export function App() {
  const route = useRoute()
  const page =
    route.path === "/observe" ? <Observe /> :
    route.path === "/coordinate" ? <Coordinate /> :
    route.path === "/explore" ? <Explore params={route.params} /> :
    <Results />

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
                <span className="brand-tag">Results nobody can quietly edit or switch off</span>
              </span>
            </a>
            <div className="topbar-right">
              <nav className="nav" aria-label="Pages">
                {PAGES.map((p) => (
                  <a key={p.path} href={href(p.path)} aria-current={route.path === p.path ? "page" : undefined}>
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
            Every number on this page is read straight from Arkiv's public RPC on the Tiramisu testnet (chain 7738577). There is
            no Collate server: anyone can serve this page, fork it, or query the same entities directly.
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
