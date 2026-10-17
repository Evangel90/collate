import { describeError, eq } from "@collate/core"
import { useEffect, useState, type ReactNode } from "react"
import { CardTitle, Icon } from "../components/ui"
import { collate, deployment } from "../lib/collate"
import { href } from "../lib/router"

const FAUCET = "https://hub.arkiv.network/faucet"
const HUB_ECOSYSTEM = "https://hub.arkiv.network/ecosystem"
const CORE_ON_GITHUB = "https://github.com/Evangel90/collate/tree/main/packages/core"

/**
 * Scrolls to a section on this page. Plain `#id` links would not work: the hash holds the route.
 */
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

/** The front door: what Collate is, how its consensus works, how to run it, and the engine underneath. */
export function Landing() {
  return (
    <div className="landing">
      <Hero />
      <Consensus />
      <RunYourOwn />
      <Engine />
      <WhyArkiv />
    </div>
  )
}

function Hero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-h">
      <div className="landing-hero-copy">
        <div className="eyebrow">
          <span className="pill">Built on Arkiv</span>
          <span className="pill">Tiramisu testnet</span>
          <span className="pill">Synthetic data</span>
        </div>
        <h1 id="landing-h">
          Election results nobody can <span className="grad">quietly edit or switch off.</span>
        </h1>
        <p className="landing-lede">
          When an official results portal stalls, the public loses sight of the count exactly when trust matters most.
        </p>
        <p>
          With Collate, a committee of observers, each accredited by an observer group you choose, posts polling-unit results to
          Arkiv. Nobody can edit them afterwards, and a unit counts only when enough of the committee agree. Your browser reads the
          results and recomputes every total itself, with no Collate server in the path.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={href("/results")}>
            <Icon name="chart" size={16} />
            View the demo election
          </a>
          <button type="button" className="btn btn-lg" onClick={() => jump("run")}>
            <Icon name="upload" size={16} />
            Run your own committee
          </button>
          <a className="btn btn-lg" href={href("/studio")}>
            <Icon name="database" size={16} />
            Open Studio
          </a>
        </div>
        <p className="muted">Viewing needs no wallet and no login.</p>
      </div>

      <aside className="card hero-aside" aria-labelledby="gap-h">
        <div>
          <p className="kicker">Nigeria, February 2023</p>
          <h2 id="gap-h" className="hero-stat">
            Under 30%
          </h2>
          <p className="small">
            of polling-unit results were on the official IReV portal by 6 pm the day after the presidential vote.
          </p>
        </div>
        <div className="meters">
          <Meter label="By 6 pm the day after the vote" value={30} display="< 30%" />
          <Meter label="By 9:30 pm on 28 February" value={45.19} display="45.19%" />
          <p className="muted">79,927 of 176,846 polling-unit results were up by then.</p>
        </div>
        <LiveStat />
      </aside>
    </section>
  )
}

function Meter({ label, value, display }: { label: string; value: number; display: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <b>{display}</b>
      </div>
      <div className="meter-track" role="img" aria-label={`${label}: ${display} of polling-unit results published`}>
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

type Stat =
  | { status: "loading" }
  | { status: "ready"; results: number; wallets: number; block: bigint }
  | { status: "error"; message: string }

/**
 * One paginated read (plus the head block): every unit result for the demo election, from any
 * wallet, without payloads. Kept small because Tiramisu meters anonymous queries.
 */
function useDemoStat(): Stat {
  const [stat, setStat] = useState<Stat>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    collate
      .fetchAll({ where: [eq("type", "unit_result"), eq("election", deployment.election)] })
      .then(({ rows, block }) => {
        if (cancelled) return
        setStat({ status: "ready", results: rows.length, wallets: new Set(rows.map((r) => r.creator.toLowerCase())).size, block })
      })
      .catch((error) => {
        if (cancelled) return
        const { message, retryAfterSeconds } = describeError(error)
        setStat({ status: "error", message })
        // A 429 says when the read budget resets; try again then.
        if (retryAfterSeconds) retry = setTimeout(() => setAttempt((n) => n + 1), retryAfterSeconds * 1000)
      })
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [attempt])

  return stat
}

function LiveStat() {
  const stat = useDemoStat()
  return (
    <div className="live-stat">
      <div className="live-stat-head">
        <span className={`pill ${stat.status === "ready" ? "pill-live" : "pill-off"}`}>{stat.status === "ready" ? "Read from Arkiv" : "Arkiv"}</span>
        {stat.status === "ready" && <span className="muted mono">block {stat.block.toLocaleString("en")}</span>}
      </div>
      {stat.status === "loading" ? (
        <p className="muted">Counting the demo election's results on Arkiv…</p>
      ) : stat.status === "error" ? (
        <p className="muted">{stat.message}</p>
      ) : (
        <p className="live-stat-body">
          <b>{stat.results.toLocaleString("en")}</b>
          <span>
            unit results posted for <span className="mono">{deployment.election}</span> by {stat.wallets} wallets. The results page
            decides which of them count.
          </span>
        </p>
      )}
    </div>
  )
}

/* ---------- How consensus works ---------- */

type Report = { wallet: string; figures: [number, number, number]; mark: "agree" | "outlier" | "split" }
type Case = { status: "certified" | "contested" | "pending"; unit: string; tally: string; agree: number; of: number; reports: Report[]; waiting?: number; note: string }

// Illustrative figures for parties A, B and C; wallets are demo observers. Quorum is 2 throughout.
const CASES: Case[] = [
  {
    status: "certified",
    unit: "PU-014",
    tally: "2 of 3 agree",
    agree: 2,
    of: 3,
    reports: [
      { wallet: "0x4381…23cD", figures: [412, 288, 97], mark: "agree" },
      { wallet: "0x7Acb…B17d", figures: [412, 288, 97], mark: "agree" },
      { wallet: "0xC8cD…29cc", figures: [512, 288, 97], mark: "outlier" },
    ],
    note: "A strict majority of the members who reported agree, and at least the quorum of 2. The unit counts once; the third wallet is listed as an outlier.",
  },
  {
    status: "contested",
    unit: "PU-027",
    tally: "1 vs 1",
    agree: 1,
    of: 2,
    reports: [
      { wallet: "0x46B9…89cC", figures: [233, 301, 54], mark: "split" },
      { wallet: "0x4C18…E26f", figures: [233, 351, 54], mark: "split" },
    ],
    note: "The members disagree and no version has a majority. Both versions are shown side by side and the unit stays out of the totals.",
  },
  {
    status: "pending",
    unit: "PU-033",
    tally: "1 of 2 needed",
    agree: 1,
    of: 2,
    reports: [{ wallet: "0x7442…8574", figures: [180, 164, 40], mark: "agree" }],
    waiting: 1,
    note: "Nobody disagrees yet, but one report is below the quorum. The unit waits for another member before it counts.",
  },
]

const STATUS_LABEL = { certified: "Certified", contested: "Contested", pending: "Pending" } as const

function Consensus() {
  return (
    <section id="how" className="landing-section" aria-labelledby="how-h">
      <SectionHead kicker="k-of-n consensus" id="how-h" title="How consensus works">
        A unit's result counts only when a <b>strict majority</b> of the committee members who reported agree, and at least{" "}
        <b>N</b> of them agree. The coordinator sets N, the quorum, when creating the election. The examples below use N = 2.
      </SectionHead>

      <div className="consensus-grid">
        {CASES.map((c) => (
          <article key={c.unit} className={`card consensus-card consensus-${c.status}`} aria-label={`${STATUS_LABEL[c.status]}: ${c.unit}`}>
            <div className="consensus-head">
              <span className="mono consensus-unit">{c.unit}</span>
              <span className={`status-pill status-${c.status}`}>
                <StatusMark status={c.status} />
                {STATUS_LABEL[c.status]}
              </span>
            </div>
            <div className="agree-meter" aria-label={c.tally}>
              <span className="agree-dots" aria-hidden="true">
                {Array.from({ length: Math.max(c.of, 2) }, (_, i) => (
                  <i key={i} className={i < c.agree ? "on" : ""} />
                ))}
              </span>
              <span>{c.tally}</span>
            </div>
            <ul className="reports">
              {c.reports.map((r) => (
                <li key={r.wallet} className={`report report-${r.mark}`}>
                  <ReportMark mark={r.mark} />
                  <span className="mono report-wallet">{r.wallet}</span>
                  <Figures figures={r.figures} against={c.reports[0]!.figures} highlight={r.mark !== "agree"} />
                  {r.mark === "outlier" && <span className="report-tag">outlier</span>}
                </li>
              ))}
              {Array.from({ length: c.waiting ?? 0 }, (_, i) => (
                <li key={`wait-${i}`} className="report report-waiting">
                  <span className="report-mark" aria-hidden="true">
                    <Icon name="clock" size={14} />
                  </span>
                  <span className="report-wallet">Waiting for another member</span>
                </li>
              ))}
            </ul>
            <p className="small consensus-note">{c.note}</p>
          </article>
        ))}
      </div>

      <div className="fact-row">
        <Fact icon="eye" title="Outliers are named">
          A member who disagrees with a certified result is listed by wallet, so anyone can ask why.
        </Fact>
        <Fact icon="edit" title="Corrections stay public">
          A correction names the result it replaces. The original and the correction both stay on the record.
        </Fact>
        <Fact icon="clock" title="Anyone keeps results alive">
          Results allow permissionless extension: any viewer can extend their lifetime on Arkiv.
        </Fact>
      </div>
    </section>
  )
}

function Figures({ figures, against, highlight }: { figures: Report["figures"]; against: Report["figures"]; highlight: boolean }) {
  return (
    <span className="report-figures">
      {(["A", "B", "C"] as const).map((party, i) => (
        <span key={party} className={highlight && figures[i] !== against[i] ? "diff" : undefined}>
          {party} {figures[i]}
        </span>
      ))}
    </span>
  )
}

function StatusMark({ status }: { status: Case["status"] }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "certified" ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : status === "contested" ? <path d="M7 7l10 10 M17 7L7 17" /> : <path d="M12 7v5l3 2" />}
    </svg>
  )
}

function ReportMark({ mark }: { mark: Report["mark"] }) {
  return (
    <span className="report-mark" role="img" aria-label={mark === "agree" ? "Agrees" : mark === "outlier" ? "Outlier" : "Disagrees"}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {mark === "agree" ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10 M17 7L7 17" />}
      </svg>
    </span>
  )
}

/* ---------- Run your own committee ---------- */

const STEPS: { title: string; body: ReactNode; link: { label: string; to: string; external?: boolean } }[] = [
  {
    title: "Connect a wallet",
    body: (
      <>
        MetaMask, Rabby or any browser wallet. Collate asks it to add or switch to Arkiv Tiramisu (chain 7738577). Writes need test
        ETH, free from the <a href={FAUCET} target="_blank" rel="noreferrer">Arkiv faucet</a>.
      </>
    ),
    link: { label: "Get test ETH", to: FAUCET, external: true },
  },
  {
    title: "Create an election and set its quorum",
    body: "On the Coordinator page, name the election, list its polling units and choose N, how many members must agree. The election and its units land in one batch.",
    link: { label: "Coordinator", to: "/coordinate" },
  },
  {
    title: "Accredit observer wallets",
    body: "Add each committee member's wallet. To try it alone, accredit a second wallet of your own. Revoking an accreditation deletes it, and that wallet's results stop counting.",
    link: { label: "Coordinator", to: "/coordinate" },
  },
  {
    title: "Post a result",
    body: "From an accredited wallet, enter a unit's figures. The result is stored readonly; a mistake is fixed with a correction that names the original.",
    link: { label: "Observer", to: "/observe" },
  },
  {
    title: "Watch it on Results",
    body: "Each unit moves from pending to certified, or contested, as reports arrive. Totals update live over WebSocket, with no refresh.",
    link: { label: "Results", to: "/results" },
  },
]

function RunYourOwn() {
  return (
    <section id="run" className="landing-section" aria-labelledby="run-h">
      <SectionHead kicker="Five steps on the testnet" id="run-h" title="Run your own committee">
        Everything below happens in this app, signed by your wallet. Collate never holds a key.
      </SectionHead>
      <ol className="run-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="run-step">
            <span className="run-num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="run-body">
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
            <a
              className="btn btn-small run-link"
              href={s.link.external ? s.link.to : href(s.link.to)}
              {...(s.link.external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {s.link.label} {s.link.external ? "↗" : "→"}
            </a>
          </li>
        ))}
      </ol>
      <p className="notice">
        Each wallet that writes (coordinator and observers) needs a little test ETH on Tiramisu. Fund it at{" "}
        <a href={FAUCET} target="_blank" rel="noreferrer">
          hub.arkiv.network/faucet
        </a>
        . Viewing results costs nothing and needs no wallet.
      </p>
    </section>
  )
}

/* ---------- The engine ---------- */

const ENGINE_PARTS = ["Pagination past 200", "Trust by $creator", "Corrections", "Consensus", "Aggregation", "Live WebSocket updates"]

const SNIPPET = `import { createCollate, eq } from "@collate/core"

const collate = createCollate() // Tiramisu, public RPC, no keys

const panel = collate.panel({
  title: "Results by state",
  query: [eq("type", "unit_result"), eq("election", "demo-2027")],
  trust: {
    rootCreators: [coordinator],          // whom the viewer trusts
    listQuery: [eq("type", "accreditation")],
    addressField: "observer",
  },
  supersedeField: "corrects",
  disputeKey: "unit_code",
  quorum: 2,                              // agreeing observers needed per unit
  groupBy: "state",
  sum: ["votes_a", "votes_b", "votes_c"],
  view: "bar",
  live: true,
})

panel.subscribe((state) => render(state.groups))`

function Engine() {
  return (
    <section id="engine" className="landing-section" aria-labelledby="engine-h">
      <SectionHead kicker="collate-core" id="engine-h" title="The engine: the read side for Arkiv">
        Arkiv returns at most 200 entities per page and does no ordering or aggregation on the server, so every app that reads from
        it solves the same problems. collate-core solves them once, in the browser. It knows nothing about elections: Collate is
        one product built on it, Collate Studio is the other.
      </SectionHead>

      <figure className="engine-diagram">
        <figcaption className="sr-only">Arkiv entities flow into collate-core, which feeds any user interface.</figcaption>
        <div className="engine-node">
          <span className="icon-chip"><Icon name="database" size={16} /></span>
          <b>Arkiv</b>
          <span className="muted">Entities with typed attributes, a chain-set $creator, 200 per page, WebSocket events</span>
        </div>
        <span className="engine-arrow" aria-hidden="true" />
        <div className="engine-node engine-core">
          <span className="icon-chip icon-chip-good"><Icon name="shield" size={16} /></span>
          <b>collate-core</b>
          <span className="engine-chips">
            {ENGINE_PARTS.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </span>
        </div>
        <span className="engine-arrow" aria-hidden="true" />
        <div className="engine-node">
          <span className="icon-chip"><Icon name="chart" size={16} /></span>
          <b>Any UI</b>
          <span className="engine-outputs">
            <span>Collate: election results</span>
            <span>Collate Studio: dashboards</span>
            <span>Your app</span>
          </span>
        </div>
      </figure>

      <div className="engine-grid">
        <div className="card engine-code">
          <CardTitle icon="edit">A live, trust-filtered panel in one call</CardTitle>
          <pre className="code landing-code">
            <code>{SNIPPET}</code>
          </pre>
          <div className="row">
            <a className="btn btn-small" href={CORE_ON_GITHUB} target="_blank" rel="noreferrer">
              packages/core on GitHub ↗
            </a>
            <span className="muted">MIT licensed. Pure functions after the fetch, unit-tested.</span>
          </div>
        </div>

        <div className="stack engine-side">
          <div className="card gap-card">
            <p className="kicker">Listed on the Arkiv ecosystem hub as "Nobody built this yet"</p>
            <blockquote>
              <b>Query-to-Dashboard Studio:</b> Every project here writes entities in — nobody ships the read side.
            </blockquote>
            <p className="small">
              Collate Studio is that read side: start from any Arkiv query, choose whose writes to trust, and share the live dashboard
              as a link. No indexer, no backend.
            </p>
            <div className="row">
              <a className="btn btn-primary btn-small" href={href("/studio")}>
                Open Studio →
              </a>
              <a className="link-btn small" href={HUB_ECOSYSTEM} target="_blank" rel="noreferrer">
                See the hub's list ↗
              </a>
            </div>
          </div>
          <div className="card gap-card">
            <p className="kicker">Also on that list</p>
            <blockquote>
              <b>Multi-Writer Collaborative State</b>
            </blockquote>
            <p className="small">
              The consensus rule turns many writers into one agreed result. Authorship is checked by $creator, which the chain sets
              and nobody can change, so a report counts only for the wallet that really wrote it.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Why Arkiv, and what stays off it ---------- */

const WHY: { icon: string; title: string; body: string }[] = [
  { icon: "lock", title: "Readonly entities", body: "Once posted, a result cannot be edited by anyone, Collate included." },
  { icon: "shield", title: "$creator from the chain", body: "Trust comes from who created an entity, never from a field anyone can write." },
  { icon: "clock", title: "Permissionless extension", body: "Any viewer can keep results alive past their expiry." },
  { icon: "eye", title: "Public RPC, no backend", body: "This static page reads Arkiv directly. Take our site down and the data is still there." },
  { icon: "map", title: "Typed queries", body: "Range filters and OR over creators run on the node." },
  { icon: "flame", title: "Live entity events", body: "WebSocket events update totals as results land." },
]

const OFF: { what: string; why: string; where: string }[] = [
  { what: "Voter and observer identities", why: "Personal data, and naming observers exposes them to pressure", where: "Nowhere: wallets plus a synthetic alias" },
  { what: "Result-sheet photos", why: "Large, and can expose people at the unit", where: "With the observer group; only a SHA-256 hash on Arkiv" },
  { what: "Totals and consensus status", why: "A stored total is one more thing that can be wrong or forged", where: "Recomputed by every viewer" },
  { what: "Keys and secrets", why: "Dangerous", where: "The user's wallet" },
  { what: "Viewer preferences", why: "Personal, per device", where: "Browser localStorage" },
]

function WhyArkiv() {
  return (
    <section id="arkiv" className="landing-section" aria-labelledby="arkiv-h">
      <SectionHead kicker="Design" id="arkiv-h" title="Why Arkiv, and what stays off it">
        Results, accreditations and corrections live on Arkiv, each attributed to the wallet that created it. Anything personal,
        large or derived does not.
      </SectionHead>

      <div className="why-grid">
        {WHY.map((w) => (
          <Fact key={w.title} icon={w.icon} title={w.title}>
            {w.body}
          </Fact>
        ))}
      </div>

      <div className="arkiv-grid">
        <div className="card">
          <CardTitle icon="database">Kept off Arkiv</CardTitle>
          <div className="off-table" role="table" aria-label="What stays off Arkiv">
            <div className="off-row off-row-head" role="row">
              <span role="columnheader">What</span>
              <span role="columnheader">Why</span>
              <span role="columnheader">Where instead</span>
            </div>
            {OFF.map((o) => (
              <div key={o.what} className="off-row" role="row">
                <b role="cell">{o.what}</b>
                <span role="cell">{o.why}</span>
                <span role="cell" className="off-where">{o.where}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card limits-card">
          <CardTitle icon="alert" tone="critical">Honest limits</CardTitle>
          <ul className="list-plain">
            <li>
              Arkiv's testnet block production is centralised. Collate is readable and verifiable by anyone without our backend; it
              is not impossible to stop.
            </li>
            <li>
              A quorum does not protect against a corrupt coordinator, or against N members who collude. The defence is that viewers
              choose whom to trust, and every report, outlier and correction stays on the record.
            </li>
            <li>All data is synthetic: a fictional election, parties and units, and observers known only by wallet and alias.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ---------- Shared bits ---------- */

function SectionHead({ kicker, id, title, children }: { kicker: string; id: string; title: string; children: ReactNode }) {
  return (
    <header className="section-head">
      <p className="kicker">{kicker}</p>
      <h2 id={id}>{title}</h2>
      <p>{children}</p>
    </header>
  )
}

function Fact({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="step">
      <span className="icon-chip"><Icon name={icon} size={16} /></span>
      <span>
        <b>{title}</b>
        {children}
      </span>
    </div>
  )
}
