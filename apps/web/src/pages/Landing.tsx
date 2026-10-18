import { describeError } from "@collate/core"
import { useEffect, useState, type ReactNode } from "react"
import { CardTitle, Icon } from "../components/ui"
import { collate, deployment } from "../lib/collate"
import { href } from "../lib/router"
import { resultsQuery } from "../model/panels"

const FAUCET = "https://hub.arkiv.network/faucet"
const HUB_ECOSYSTEM = "https://hub.arkiv.network/ecosystem"
const CORE_ON_GITHUB = "https://github.com/Evangel90/collate/tree/main/packages/core"

/**
 * Scrolls to a section on this page. Plain `#id` links would not work: the hash holds the route.
 */
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

/** The front door: what Collate is, who it is for, why it is different, how it works, and the engine underneath. */
export function Landing() {
  return (
    <div className="landing">
      <Hero />
      <WhatItDoes />
      <Different />
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
        </div>
        <h1 id="landing-h">
          Election results nobody can <span className="grad">quietly edit or switch off.</span>
        </h1>
        <p className="landing-lede">
          When the official portal stalls, the public loses the count exactly when trust matters most. Nigeria in 2023 is one case;
          India, or any election counted unit by unit, could be the next.
        </p>
        <p>
          Observers post each polling unit's result from their own wallet. Once posted, nobody can change it, not even us. A unit
          counts only when its observers agree, and every total is recomputed in your browser from Arkiv. There is no server to block
          or take down.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={href("/results")}>
            <Icon name="chart" size={16} />
            See the demo election
          </a>
          <button type="button" className="btn btn-lg" onClick={() => jump("run")}>
            <Icon name="users" size={16} />
            Run an observer committee
          </button>
          <a className="btn btn-lg" href={href("/studio")}>
            <Icon name="database" size={16} />
            Build a dashboard
          </a>
        </div>
        <p className="row">
          <span className="muted">Watching needs no wallet. Want to post a result?</span>
          <a className="btn btn-small" href={href("/observe")}>
            Join the Open sandbox →
          </a>
        </p>
      </div>

      <div className="hero-side">
        <aside className="card hero-aside" aria-labelledby="gap-h">
          <div>
            <p className="kicker">The problem · Nigeria, February 2023</p>
            <h2 id="gap-h" className="hero-stat">
              Under 30%
            </h2>
            <p className="small">of polling-unit results were on the official IReV portal the day after the presidential vote.</p>
          </div>
          <div className="meters">
            <Meter label="By 6 pm, the next day" value={30} display="< 30%" />
            <Meter label="By 9:30 pm, three days later" value={45.19} display="45.19%" />
            <p className="muted">79,927 of 176,846 polling-unit results were up by then.</p>
          </div>
        </aside>
        <LiveStat />
      </div>
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
 * One paginated read (plus the head block): every result and correction for the demo election,
 * from any wallet, without payloads. It is exactly the results page's own read (Q4′), so
 * collate-core's session cache lets the two share one query; corrections are left out of the count.
 */
function useDemoStat(): Stat {
  const [stat, setStat] = useState<Stat>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    collate
      .fetchAll({ where: resultsQuery(deployment.election) })
      .then(({ rows: all, block }) => {
        if (cancelled) return
        const rows = all.filter((r) => r.attrs.type === "unit_result")
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
    <section className="card live-stat" aria-labelledby="live-h">
      <div className="live-stat-head">
        <p className="kicker" id="live-h">Collate's answer · our demo election</p>
        <span className={`pill ${stat.status === "ready" ? "pill-live" : "pill-off"}`}>{stat.status === "ready" ? "Live" : "Arkiv"}</span>
      </div>
      {stat.status === "loading" ? (
        <p className="muted">Counting results on Arkiv…</p>
      ) : stat.status === "error" ? (
        <p className="muted">{stat.message}</p>
      ) : (
        <>
          <p className="live-stat-body">
            <b>{stat.results.toLocaleString("en")}</b>
            <span>results posted by {stat.wallets} test observers, each public the moment it was posted.</span>
          </p>
          <p className="muted">Counted just now from Arkiv, block {stat.block.toLocaleString("en")}.</p>
        </>
      )}
      <a className="link-btn small" href={href("/results")}>
        See the results →
      </a>
    </section>
  )
}

/* ---------- What it does ---------- */

const OFFERS: { audience: string; icon: string; title: string; body: string; links: { label: string; to: string }[] }[] = [
  {
    audience: "For the public",
    icon: "eye",
    title: "Watch and verify the count",
    body: "Pick the observers you trust and follow live totals by region. See which units are certified, contested or waiting, and trace any number to the wallet that posted it.",
    links: [{ label: "See the demo election", to: "/results" }],
  },
  {
    audience: "For observer groups",
    icon: "users",
    title: "Run a committee of observers",
    body: "Set up an election, accredit your observers' wallets and share one link. Mistakes get a public correction, never a silent edit.",
    links: [
      { label: "Coordinator console", to: "/coordinate" },
      { label: "Observer page", to: "/observe" },
    ],
  },
  {
    audience: "For builders",
    icon: "database",
    title: "Turn any Arkiv data into a live dashboard",
    body: "Studio works on any Arkiv project, not just elections: filter entities, choose whose writes to trust, chart them and share a link. Its engine, collate-core, drops into your app.",
    links: [{ label: "Open Studio", to: "/studio" }],
  },
]

function WhatItDoes() {
  return (
    <section id="what" className="landing-section" aria-labelledby="what-h">
      <SectionHead kicker="One engine, three ways in" id="what-h" title="What you can do with Collate">
        One open engine for the people watching an election, the groups observing it, and anyone building on Arkiv.
      </SectionHead>
      <div className="offer-grid">
        {OFFERS.map((o) => (
          <article key={o.title} className="card offer-card">
            <span className="icon-chip"><Icon name={o.icon} size={16} /></span>
            <p className="kicker">{o.audience}</p>
            <h3>{o.title}</h3>
            <p>{o.body}</p>
            <div className="row">
              {o.links.map((l) => (
                <a key={l.to} className="btn btn-small" href={href(l.to)}>
                  {l.label} →
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------- Why it is different ---------- */

const COMPARE: { question: string; portal: string; website: string; collate: string }[] = [
  {
    question: "Can a posted result be changed later?",
    portal: "Yes, by whoever runs it",
    website: "Yes, by its owner, without a trace",
    collate: "No. Results are readonly; a fix is a public correction beside the original.",
  },
  {
    question: "Can it be switched off?",
    portal: "One operator can delay it or take it down",
    website: "Its host can be throttled or taken down",
    collate: "No. Anyone can serve this page or query Arkiv directly.",
  },
  {
    question: "Who decides which numbers count?",
    portal: "The operator",
    website: "The group that runs it",
    collate: "You pick whose observers to trust; a unit counts when they agree.",
  },
  {
    question: "What happens when observers disagree?",
    portal: "You don't see it",
    website: "Usually settled out of view",
    collate: "The unit is marked contested and every version is shown.",
  },
  {
    question: "Can you check a number yourself?",
    portal: "Only by trusting the operator",
    website: "Only by trusting the site",
    collate: "Yes. Every number links to its wallet and its Arkiv entity.",
  },
]

function Different() {
  return (
    <section id="different" className="landing-section" aria-labelledby="different-h">
      <SectionHead kicker="Why it is different" id="different-h" title="Nobody has to be trusted with the count">
        Portals and observer sites ask you to trust whoever runs them. With Collate, no one, us included, can edit, hide or switch
        off what observers reported.
      </SectionHead>
      <div className="card compare" role="table" aria-label="Collate compared with a results portal and an observer website">
        <div className="compare-row compare-head" role="row">
          <span role="columnheader">The question</span>
          <span role="columnheader">An official results portal</span>
          <span role="columnheader">An observer group's website</span>
          <span role="columnheader">Collate</span>
        </div>
        {COMPARE.map((c) => (
          <div key={c.question} className="compare-row" role="row">
            <b role="rowheader">{c.question}</b>
            <span role="cell" data-label="Results portal">{c.portal}</span>
            <span role="cell" data-label="Observer website">{c.website}</span>
            <span role="cell" data-label="Collate" className="compare-collate">{c.collate}</span>
          </div>
        ))}
      </div>
    </section>
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
    note: "A majority agrees and meets the quorum of 2. The unit counts; the third wallet is named as an outlier.",
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
    note: "No version has a majority. Both are shown and the unit stays out of the totals.",
  },
  {
    status: "pending",
    unit: "PU-033",
    tally: "1 of 2 needed",
    agree: 1,
    of: 2,
    reports: [{ wallet: "0x7442…8574", figures: [180, 164, 40], mark: "agree" }],
    waiting: 1,
    note: "No disagreement, but one report is below the quorum. The unit waits for another.",
  },
]

const STATUS_LABEL = { certified: "Certified", contested: "Contested", pending: "Pending" } as const

function Consensus() {
  return (
    <section id="how" className="landing-section" aria-labelledby="how-h">
      <SectionHead kicker="k-of-n consensus" id="how-h" title="How consensus works">
        A unit counts only when a <b>strict majority</b> of its observers post the same figures, and at least <b>N</b> of them
        do. The coordinator suggests N; each viewer can change it. These examples use N = 2.
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
          Anyone who disagrees with a certified result is listed by wallet.
        </Fact>
        <Fact icon="edit" title="Corrections stay public">
          A correction names the result it replaces; both stay on record.
        </Fact>
        <Fact icon="clock" title="Anyone keeps results alive">
          Any viewer can extend a result's lifetime on Arkiv.
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
        Any browser wallet. Collate switches it to Arkiv Tiramisu (chain 7738577). Writes need test GLM, free from the{" "}
        <a href={FAUCET} target="_blank" rel="noreferrer">Arkiv faucet</a>.
      </>
    ),
    link: { label: "Get test GLM", to: FAUCET, external: true },
  },
  {
    title: "Create an election and set its quorum",
    body: "Name the election, list its polling units and set N, how many observers must agree.",
    link: { label: "Coordinator", to: "/coordinate" },
  },
  {
    title: "Accredit observer wallets",
    body: "Add wallets one by one or as a pasted list. Testing alone? Accredit a second wallet of your own. Revoked wallets stop counting.",
    link: { label: "Coordinator", to: "/coordinate" },
  },
  {
    title: "Post a result",
    body: "From an accredited wallet, enter a unit's figures. Results are readonly; a mistake gets a correction.",
    link: { label: "Observer", to: "/observe" },
  },
  {
    title: "Watch it on Results",
    body: "Units move from pending to certified or contested as reports arrive, live, with no refresh.",
    link: { label: "Results", to: "/results" },
  },
]

function RunYourOwn() {
  return (
    <section id="run" className="landing-section" aria-labelledby="run-h">
      <SectionHead kicker="For observer groups · five steps" id="run-h" title="Run an observer committee">
        Everything is signed by your own wallet. No keys held, no account to create.
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
        Every wallet that writes needs a little test GLM from{" "}
        <a href={FAUCET} target="_blank" rel="noreferrer">
          hub.arkiv.network/faucet
        </a>
        . Viewing is free.
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
  query: [eq("type", "unit_result"), eq("election", "collate-demo-ng")],
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
      <SectionHead kicker="For builders · collate-core" id="engine-h" title="The engine: the read side for Arkiv">
        Arkiv returns 200 entities a page and leaves totals to the reader, so every app re-solves the same problems. collate-core
        solves them once, in the browser: paging, trust by $creator, corrections, consensus, totals and live updates. It knows
        nothing about elections; Collate and Studio are both built on it.
      </SectionHead>

      <figure className="engine-diagram">
        <figcaption className="sr-only">Arkiv entities flow into collate-core, which feeds any user interface.</figcaption>
        <div className="engine-node">
          <span className="icon-chip"><Icon name="database" size={16} /></span>
          <b>Arkiv</b>
          <span className="muted">Typed entities, chain-set $creator, 200 per page, live events</span>
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
              Studio is that read side: any Arkiv query, your choice of trusted writers, a live dashboard shared as a link. No
              indexer, no backend.
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
              Consensus turns many writers into one agreed result. Authorship comes from $creator, which the chain sets, so a report
              counts only for the wallet that wrote it.
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
  { icon: "eye", title: "Public RPC, no backend", body: "This page reads Arkiv directly. Take it down and the data remains." },
  { icon: "map", title: "Typed queries", body: "Range filters and OR over creators run on the node." },
  { icon: "flame", title: "Live entity events", body: "WebSocket events update totals as results land." },
]

const OFF: { what: string; why: string; where: string }[] = [
  { what: "Voter and observer identities", why: "Personal, and naming observers exposes them to pressure", where: "Nowhere: just a wallet and alias" },
  { what: "Result-sheet photos", why: "Large, and can expose people at the unit", where: "With the observer group; only a SHA-256 hash on Arkiv" },
  { what: "Totals and consensus status", why: "A stored total is one more thing that can be wrong or forged", where: "Recomputed by every viewer" },
  { what: "Keys and secrets", why: "Dangerous", where: "The user's wallet" },
  { what: "Viewer preferences", why: "Personal, per device", where: "Browser localStorage" },
]

function WhyArkiv() {
  return (
    <section id="arkiv" className="landing-section" aria-labelledby="arkiv-h">
      <SectionHead kicker="Design" id="arkiv-h" title="Why Arkiv, and what stays off it">
        Results, accreditations and corrections live on Arkiv, tied to the wallet that wrote them. Anything personal, large or
        derived stays off.
      </SectionHead>

      <div className="why-grid">
        {WHY.map((w) => (
          <Fact key={w.title} icon={w.icon} title={w.title}>
            {w.body}
          </Fact>
        ))}
      </div>

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
