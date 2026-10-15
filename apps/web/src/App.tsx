import { collateCss } from "@collate/core/ui"
import { href, useRoute } from "./lib/router"
import { Observe } from "./pages/Observe"
import { Results } from "./pages/Results"

const PAGES = [
  { path: "/", label: "Results" },
  { path: "/observe", label: "Observer" },
]

export function App() {
  const route = useRoute()
  const page =
    route.path === "/observe" ? <Observe /> :
    <Results />

  return (
    <div className="collate-root">
      <style>{collateCss}</style>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href={href("/")}>
            <img src="./favicon.svg" width={28} height={28} alt="" />
            <span>
              Collate <small>results nobody can quietly edit or switch off</small>
            </span>
          </a>
          <nav className="nav" aria-label="Pages">
            {PAGES.map((p) => (
              <a key={p.path} href={href(p.path)} aria-current={route.path === p.path ? "page" : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
        </header>
        <main>{page}</main>
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
      </div>
    </div>
  )
}
