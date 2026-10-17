import { ExpirationTime } from "@arkiv-network/sdk"
import { computePanel, renderWhere, type AggRow, type Consensus, type PanelState, type Row } from "@collate/core"
import { BarChart, GroupTable, Provenance, RowTable, formatNumber, usePanel } from "@collate/core/ui"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { isAddress } from "viem"
import { useRateLimited } from "../components/Budget"
import { CardTitle, Icon, Skeleton } from "../components/ui"
import { collate, deployment, nameOf, prefs, type Coordinator } from "../lib/collate"
import { exploreHref, figures, timeAgo, useElection } from "../lib/data"
import { href } from "../lib/router"
import { errorMessage, useWallet } from "../lib/wallet"
import type { Party } from "../model/schema"
import { latestPanel, resultsPanel, suspiciousPanel } from "../model/panels"

type GroupBy = "state" | "lga" | "ward"
type Proof = { title: string; rows: Row[] }

const EXTEND_DAYS = 30
const BLOCKS_PER_DAY = 43_200n // 2-second blocks

/**
 * Optional `election` and `coordinator` URL params let anyone watch their own election, e.g.
 * `#/results?election=my-vote&coordinator=0x…`. Without them the page shows the demo, as before.
 */
function fromParams(params: URLSearchParams | undefined): { election: string; coordinators: Coordinator[]; urlId?: string } {
  const election = params?.get("election")?.trim() || deployment.election
  const wanted = params?.get("coordinator")?.trim().toLowerCase()
  if (!wanted || !isAddress(wanted)) return { election, coordinators: deployment.coordinators }
  const known = deployment.coordinators.find((c) => c.address.toLowerCase() === wanted)
  if (known) return { election, coordinators: deployment.coordinators, urlId: known.id }
  const custom: Coordinator = { id: "custom", name: "Custom", address: wanted, observers: [] }
  return { election, coordinators: [...deployment.coordinators, custom], urlId: custom.id }
}

export function Results({ params }: { params?: URLSearchParams } = {}) {
  const query = params?.toString() ?? ""
  const { election, coordinators, urlId } = useMemo(() => fromParams(new URLSearchParams(query)), [query])
  const [coordinatorId, setCoordinatorId] = useState(() => urlId ?? prefs.get("coordinator") ?? coordinators[0]!.id)
  // A new link while the page is open selects its coordinator too.
  useEffect(() => {
    if (urlId) setCoordinatorId(urlId)
  }, [urlId])
  const coordinator = coordinators.find((c) => c.id === coordinatorId) ?? coordinators[0]!
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (prefs.get("groupBy") as GroupBy) ?? "state")
  const [view, setView] = useState<"chart" | "table">("chart")
  const [proof, setProof] = useState<Proof | undefined>()

  // Reads every coordinator's setup at once (before the panel, so its trust list is answered from it).
  const info = useElection(election, coordinator.address, useMemo(() => coordinators.map((c) => c.address), [coordinators]))
  const limited = useRateLimited()
  // The viewer's bar for consensus; until they pick one, the coordinator's recommendation, else 1.
  const [quorumChoice, setQuorumChoice] = useState<number | undefined>()
  const quorum = quorumChoice ?? info.quorum ?? 1
  // What is read from Arkiv depends only on the election and the coordinator. Grouping and quorum
  // are applied in the browser to the rows already read, so changing them costs no queries.
  const fetched = useMemo(() => resultsPanel(election, coordinator.address, "state"), [election, coordinator.address])
  const { state: raw } = usePanel(collate, fetched)
  // `panel` is what the page shows and links to.
  const panel = useMemo(() => resultsPanel(election, coordinator.address, groupBy, quorum), [election, coordinator.address, groupBy, quorum])
  const state = useMemo(() => raw && { ...raw, ...computePanel(panel, raw.rows) }, [raw, panel])
  const parties = info.parties

  const chooseCoordinator = (id: string) => {
    setCoordinatorId(id)
    if (id !== "custom") prefs.set("coordinator", id) // a linked coordinator is not a lasting preference
  }
  const chooseGroup = (g: GroupBy) => {
    setGroupBy(g)
    prefs.set("groupBy", g)
  }
  const proofFor = (title: string, keys: string[]) => {
    const set = new Set(keys)
    setProof({ title, rows: (state?.current ?? []).filter((r) => set.has(r.key)) })
  }

  return (
    <div className="grid">
      <section className="hero">
        <div className="eyebrow">
          <LivePill state={state} />
          <span className="pill">Synthetic data</span>
          <span className="pill">Tiramisu testnet</span>
        </div>
        <Title name={info.name} />
        <p>
          Polling-unit results posted by accredited observers as Arkiv entities. Choose whose observers you trust; every total is
          recomputed in your browser from the raw results, and every number links to who posted it.
        </p>
        <div className="steps" aria-label="How Collate works">
          <div className="step">
            <span className="icon-chip"><Icon name="upload" size={16} /></span>
            <span><b>Observers post</b>Each unit's result is signed by an accredited wallet and stored on Arkiv.</span>
          </div>
          <div className="step">
            <span className="icon-chip"><Icon name="lock" size={16} /></span>
            <span><b>Nobody can edit</b>Results are readonly. Fixes are new corrections; originals stay public.</span>
          </div>
          <div className="step">
            <span className="icon-chip"><Icon name="eye" size={16} /></span>
            <span><b>You verify</b>Your browser reads Arkiv directly and recomputes every total. No Collate server.</span>
          </div>
        </div>
      </section>

      <section className="card trust-bar" aria-labelledby="trust-h">
        <div className="card-head">
          <div>
            <CardTitle icon="shield" id="trust-h">Whose observers do you trust?</CardTitle>
            <p>Trust comes from the coordinator wallet that created each accreditation ($creator), never from a field anyone can write.</p>
          </div>
          <div className="seg" role="group" aria-label="Coordinator">
            {coordinators.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === coordinator.id} onClick={() => chooseCoordinator(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="card-foot">
          <span>
            {state?.trust ? `${state.trust.members.size} accredited observers` : "Resolving accreditations…"} · coordinator{" "}
            <a href={collate.explorer.address(coordinator.address)} target="_blank" rel="noreferrer" className="mono">
              {coordinator.address.slice(0, 10)}…
            </a>
          </span>
          {state?.ignored.length ? (
            <span className="pill pill-critical">
              {state.ignored.length} result{state.ignored.length === 1 ? "" : "s"} from wallets outside this group not counted
            </span>
          ) : null}
        </div>
        <QuorumControl quorum={quorum} recommended={info.quorum} onChange={setQuorumChoice} />
      </section>

      {/* A spent read budget is explained once, by the page-wide notice. */}
      {state?.status === "error" && !limited && <p className="notice notice-error">Could not read from Arkiv: {state.error}</p>}
      {info.error && !limited && <p className="notice notice-error">Could not load the election: {info.error}</p>}
      {!info.loading && !info.error && !info.row && (
        <p className="notice notice-warn">
          No election “{election}” created by {coordinator.name} ({coordinator.address.slice(0, 10)}…) was found on Arkiv. Check the link, or
          create it in the <a href={href("/coordinate")}>coordinator console</a>.
        </p>
      )}

      <Tiles state={state} parties={parties} units={info.units.length} onProof={proofFor} />

      <section className="card" aria-labelledby="totals-h">
        <div className="card-head">
          <CardTitle icon="chart" id="totals-h">Votes by {groupBy === "lga" ? "LGA" : groupBy}</CardTitle>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Group by">
              {(["state", "lga", "ward"] as const).map((g) => (
                <button key={g} type="button" aria-pressed={groupBy === g} onClick={() => chooseGroup(g)}>
                  {g === "lga" ? "LGA" : g[0]!.toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                Chart
              </button>
              <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
                Table
              </button>
            </div>
          </div>
        </div>
        {!state || state.status === "loading" ? (
          <Skeleton lines={4} height={22} />
        ) : state.groups.length === 0 ? (
          <p className="muted">No trusted results yet.</p>
        ) : view === "chart" ? (
          <BarChart
            title={`Votes by ${groupBy}`}
            groups={state.groups}
            series={parties.map((p) => ({ field: p.field, label: p.name }))}
            onSelect={(g: AggRow) => proofFor(`${g.group}: who posted these numbers`, g.keys)}
          />
        ) : (
          <GroupTable
            groups={state.groups}
            total={state.total}
            groupLabel={groupBy === "lga" ? "LGA" : groupBy}
            countLabel="Units"
            columns={[...parties.map((p) => ({ field: p.field, label: p.short })), { field: "rejected", label: "Rejected" }]}
            onSelect={(g) => proofFor(`${g.group}: who posted these numbers`, g.keys)}
          />
        )}
        <PanelFoot state={state} panel={panel} note="Only certified units count. Contested and pending units are left out and listed below." />
      </section>

      <div className="grid cols-2">
        <ConsensusCard state={state} parties={parties} quorum={quorum} onProof={(title, rows) => setProof({ title, rows })} />
        <Latest state={state} election={election} coordinator={coordinator.address} opensAt={Number(info.row?.attrs.opens_at ?? 0)} parties={parties} onProof={(title, rows) => setProof({ title, rows })} />
        <Missing units={info.units} state={state} />
        <Corrections state={state} parties={parties} onProof={(title, rows) => setProof({ title, rows })} />
        <Suspicious main={state} election={election} coordinator={coordinator.address} onProof={(title, rows) => setProof({ title, rows })} />
        <Ignored state={state} parties={parties} onProof={(title, rows) => setProof({ title, rows })} />
      </div>

      <OffArkiv />

      {proof && (
        <ProofDialog proof={proof} parties={parties} block={state?.block} onClose={() => setProof(undefined)} />
      )}
    </div>
  )
}

/** The election name, with a trailing year picked out in the accent gradient. */
function Title({ name }: { name: string }) {
  const m = name.match(/^(.*) (\d{4})$/)
  return <h1>{m ? <>{m[1]} <span className="grad">{m[2]}</span></> : name}</h1>
}

function LivePill({ state }: { state: PanelState | undefined }) {
  if (!state || state.live === "off") return <span className="pill pill-off">Connecting to Arkiv</span>
  if (state.live === "error") return <span className="pill pill-off">Live updates paused · refresh to retry</span>
  return (
    <span className="pill pill-live" title="New results arrive over a WebSocket subscription to Arkiv entity events">
      Live from Arkiv{state.block ? ` · block ${state.block.toLocaleString("en")}` : ""}
    </span>
  )
}

function Tiles({ state, parties, units, onProof }: { state: PanelState | undefined; parties: Party[]; units: number; onProof: (title: string, keys: string[]) => void }) {
  const total = state?.total
  const valid = parties.reduce((s, p) => s + (total?.sums[p.field] ?? 0), 0)
  const groups = state?.consensus ?? []
  const reported = groups.length
  const count = (status: Consensus["status"]) => groups.filter((c) => c.status === status).length
  const [certified, contested, pending] = [count("certified"), count("contested"), count("pending")]
  return (
    <section className="tiles" aria-label="Headline totals">
      {parties.map((p, i) => {
        const votes = total?.sums[p.field] ?? 0
        const share = valid ? (votes / valid) * 100 : 0
        const leading = valid > 0 && parties.every((q) => (total?.sums[q.field] ?? 0) <= votes)
        return (
          <button
            key={p.field}
            type="button"
            className="tile"
            style={{ ["--tile-color" as string]: `var(--collate-series-${i + 1})` }}
            onClick={() => total && onProof(`${p.name}: every counted result`, total.keys)}
          >
            <span className="tile-label">
              <span className="collate-swatch" style={{ background: `var(--collate-series-${i + 1})` }} />
              {p.name}
              {leading && <span className="lead">Leading</span>}
            </span>
            <span className="tile-value">{state?.status === "ready" ? formatNumber(votes) : "—"}</span>
            <span className="share" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
            <span className="tile-sub">
              <span>{valid ? `${share.toFixed(1)}% of valid votes` : "Waiting for results"}</span>
            </span>
          </button>
        )
      })}
      <div className="tile" style={{ ["--tile-color" as string]: "var(--ink-2)" }}>
        <span className="tile-label">Units reported</span>
        <span className="tile-value">
          {reported}
          <span className="muted"> / {units || "—"}</span>
        </span>
        <span className="share" aria-hidden="true"><span style={{ width: `${units ? (reported / units) * 100 : 0}%` }} /></span>
        <span className="tile-sub">
          <span>
            {certified} certified{contested ? ` · ${contested} contested` : ""}
            {pending ? ` · ${pending} pending` : ""}
          </span>
          <span>{units ? `${Math.round((reported / units) * 100)}%` : ""}</span>
        </span>
      </div>
    </section>
  )
}

function PanelFoot({ state, panel, note }: { state: PanelState | undefined; panel: Parameters<typeof exploreHref>[0]; note?: string }) {
  return (
    <div className="stack">
      <div className="card-foot">
        {note && <span>{note}</span>}
        <a href={exploreHref(panel)}>Open in Studio ↗</a>
        {state?.updatedAt ? <span>Updated {new Date(state.updatedAt).toLocaleTimeString()}</span> : null}
      </div>
      <details>
        <summary>The Arkiv query behind this panel</summary>
        <pre className="code">{renderWhere(panel.query)}
{panel.trust ? `\nTrusted creators: wallets named in "${panel.trust.addressField}" of entities matching\n${renderWhere(panel.trust.listQuery)}\ncreated by ${panel.trust.rootCreators.join(", ")}` : ""}</pre>
      </details>
    </div>
  )
}

type ProofHandler = (title: string, rows: Row[]) => void

const who = (r: Row) => nameOf(r.creator) ?? r.creator.slice(0, 10)

/**
 * Viewers already choose whom to trust; this lets them also raise the bar for how many of those
 * observers must agree before a unit counts.
 */
function QuorumControl({ quorum, recommended, onChange }: { quorum: number; recommended?: number; onChange: (q: number) => void }) {
  const options = [...new Set([1, 2, 3, ...(recommended ? [recommended] : [])])].sort((a, b) => a - b)
  return (
    <div className="card-foot">
      <span className="toolbar">
        <span className="toolbar-label">Require at least</span>
        <span className="seg" role="group" aria-label="Agreeing observers required per unit">
          {options.map((q) => (
            <button key={q} type="button" aria-pressed={q === quorum} onClick={() => onChange(q)}>
              {q}
            </button>
          ))}
        </span>
        <span className="toolbar-label">agreeing observer{quorum === 1 ? "" : "s"} per unit</span>
      </span>
      <span>
        They must also outnumber everyone else who reported the unit.
        {recommended ? ` This coordinator recommends ${recommended}.` : ""}
      </span>
    </div>
  )
}

/** "Certified 2/3": agreeing of those who reported. "Pending 1/2": reported of those required. */
function StatusBadge({ c }: { c: Consensus }) {
  if (c.status === "certified") {
    return <span className="pill pill-good" title={`${c.agreeing.length} of ${c.sources} observers agree`}>Certified {c.agreeing.length}/{c.sources}</span>
  }
  if (c.status === "pending") {
    return <span className="pill pill-warn" title={`${c.sources} of ${c.quorum} required observers have reported`}>Pending {c.sources}/{c.quorum}</span>
  }
  return <span className="pill pill-critical">Contested</span>
}

function ConsensusCard({ state, parties, quorum, onProof }: { state: PanelState | undefined; parties: Party[]; quorum: number; onProof: ProofHandler }) {
  const groups = state?.consensus ?? []
  const certified = groups.filter((c) => c.status === "certified")
  const contested = groups.filter((c) => c.status === "contested")
  const pending = groups.filter((c) => c.status === "pending")
  // Units with a single observer are the bulk and say nothing about agreement; list the rest.
  const confirmed = certified.filter((c) => c.sources > 1)
  const fields = [...parties.map((p) => p.field), "rejected", "accredited"]
  const ready = state?.status === "ready"
  return (
    <section className="card" aria-labelledby="consensus-h">
      <div className="card-head">
        <CardTitle icon="alert" id="consensus-h" tone={contested.length ? "critical" : "good"}>Unit consensus</CardTitle>
        {ready && (
          <span className="row">
            <span className="pill pill-good">{certified.length} certified</span>
            <span className={contested.length ? "pill pill-critical" : "pill"}>{contested.length} contested</span>
            {pending.length ? <span className="pill pill-warn">{pending.length} pending</span> : null}
          </span>
        )}
      </div>
      <p className="muted">
        A unit counts once {quorum === 1 ? "its trusted observers agree" : `${quorum} or more trusted observers agree`} and they outnumber
        everyone else who reported it; anyone who posted different figures is listed as an outlier. Contested and pending units stay
        visible but are not counted.
      </p>
      {!ready && <Skeleton lines={2} />}
      {contested.map((c) => (
        <div key={c.key} className="dispute">
          <div className="dispute-head">
            <span className="row">
              <strong>{c.key}</strong>
              <StatusBadge c={c} />
            </span>
            <button type="button" className="link-btn" onClick={() => onProof(`${c.key}: contested`, c.entries)}>
              Proof ↗
            </button>
          </div>
          <div className="versions">
            {c.entries.map((r) => (
              <div key={r.key} className="version">
                <span className="muted">{who(r)}</span>
                {fields.map((f) => {
                  const differs = new Set(c.entries.map((e) => e.attrs[f])).size > 1
                  const label = parties.find((p) => p.field === f)?.short ?? f
                  return (
                    <span key={f}>
                      {label}: <b className={differs ? "diff" : undefined}>{formatNumber(Number(r.attrs[f] ?? 0))}</b>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      {confirmed.length > 0 && (
        <div className="stack">
          <h3 className="subhead">Certified by more than one observer</h3>
          <ul className="feed">
            {confirmed.map((c) => {
              const counted = c.agreeing[c.agreeing.length - 1]!
              return (
                <li key={c.key}>
                  <span className="row">
                    <button type="button" className="link-btn" onClick={() => onProof(`${c.key}: certified ${c.agreeing.length}/${c.sources}`, c.entries)}>
                      {c.key}
                    </button>
                    <StatusBadge c={c} />
                  </span>
                  <span className="meta">{c.agreeing.map(who).join(", ")}</span>
                  {c.outliers.map((r) => (
                    <span key={r.key} className="meta" style={{ flexBasis: "100%" }}>
                      Outlier:{" "}
                      <button type="button" className="link-btn" onClick={() => onProof(`${c.key}: ${who(r)} against the certified count`, [counted, r])}>
                        {who(r)}
                      </button>{" "}
                      posted {figures(r, parties)}
                    </span>
                  ))}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {pending.length > 0 && (
        <div className="stack">
          <h3 className="subhead">Pending: fewer than {quorum} observers so far</h3>
          <div className="unit-chips">
            {pending.slice(0, 30).map((c) => (
              <button key={c.key} type="button" title={`Pending ${c.sources}/${c.quorum}`} onClick={() => onProof(`${c.key}: pending ${c.sources}/${c.quorum}`, c.entries)}>
                {c.key} · {c.sources}/{c.quorum}
              </button>
            ))}
            {pending.length > 30 ? <span>+{pending.length - 30} more</span> : null}
          </div>
        </div>
      )}
      {ready && groups.length > 0 && contested.length + confirmed.length + pending.length === 0 && (
        <p className="muted">Every reported unit has a single observer so far, so there is nothing to compare.</p>
      )}
    </section>
  )
}

type Window = { id: string; label: string; seconds?: number }
const WINDOWS: Window[] = [
  { id: "1h", label: "1 h", seconds: 3600 },
  { id: "24h", label: "24 h", seconds: 86_400 },
  { id: "7d", label: "7 d", seconds: 7 * 86_400 },
  { id: "all", label: "Since polls opened" },
]

/** The narrowest window that still shows the newest submission, so the card is never empty by default. */
function autoWindow(newest: number, now: number): Window {
  return WINDOWS.find((w) => w.seconds !== undefined && now - newest <= w.seconds) ?? WINDOWS[WINDOWS.length - 1]!
}

const submitted = (r: Row) => Number(r.attrs.submitted_at ?? 0)

/**
 * The Q6 range (`submitted_at > since`) applied in the browser to the trusted rows the results
 * panel already holds, so every window, and every live update, costs no extra query. The exact
 * Arkiv query is shown below the card, and "Open in Studio" runs it on Arkiv.
 */
function Latest({ state, election, coordinator, opensAt, parties, onProof }: { state: PanelState | undefined; election: string; coordinator: string; opensAt: number; parties: Party[]; onProof: ProofHandler }) {
  const [choice, setChoice] = useState<string | undefined>()
  const trusted = state?.rows ?? []
  // Rounded to the minute so the query shown below stays stable while the page is open.
  const now = Math.floor(Date.now() / 60_000) * 60
  const newest = trusted.reduce((m, r) => Math.max(m, submitted(r)), 0)
  const span = WINDOWS.find((w) => w.id === choice) ?? autoWindow(newest, now)
  const since = span.seconds === undefined ? opensAt : now - span.seconds
  const panel = useMemo(() => latestPanel(election, coordinator, since), [election, coordinator, since])
  const rows = trusted.filter((r) => submitted(r) > since).sort((a, b) => submitted(b) - submitted(a))
  return (
    <section className="card" aria-labelledby="latest-h">
      <div className="card-head">
        <CardTitle icon="clock" id="latest-h">Latest submissions</CardTitle>
        <div className="seg" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" aria-pressed={span.id === w.id} onClick={() => setChoice(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {!state || state.status === "loading" ? (
        <Skeleton lines={3} />
      ) : rows.length === 0 ? (
        <p className="muted">{span.seconds === undefined ? "Nothing submitted yet." : `Nothing submitted in the last ${span.label}.`}</p>
      ) : (
        <ul className="feed">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key}>
              <button type="button" className="link-btn" onClick={() => onProof(`${r.attrs.unit_code}`, [r])}>
                {String(r.attrs.unit_code)}
                {r.attrs.type === "correction" ? " (correction)" : ""}
              </button>
              <span className="meta">
                {nameOf(r.creator) ?? r.creator.slice(0, 10)} · {timeAgo(Number(r.attrs.submitted_at ?? 0))}
              </span>
              <span className="meta" style={{ flexBasis: "100%" }}>{figures(r, parties)}</span>
            </li>
          ))}
        </ul>
      )}
      <PanelFoot
        state={state}
        panel={panel}
        note={`Range query on submitted_at, applied here to the rows already read (no extra query) · ${rows.length} in window`}
      />
    </section>
  )
}

function Missing({ units, state }: { units: Row[]; state: PanelState | undefined }) {
  const reported = new Set([...(state?.current ?? [])].map((r) => String(r.attrs.unit_code)))
  const missing = units.filter((u) => !reported.has(String(u.attrs.unit_code)))
  return (
    <section className="card" aria-labelledby="missing-h">
      <div className="card-head">
        <CardTitle icon="map" id="missing-h">Units with no result yet</CardTitle>
        <span className="pill">{units.length ? `${missing.length} of ${units.length}` : "—"}</span>
      </div>
      {missing.length === 0 ? (
        units.length ? <p className="muted">Every registered unit has a trusted result.</p> : <Skeleton lines={2} />
      ) : (
        <div className="unit-chips">
          {missing.slice(0, 30).map((u) => (
            <span key={u.key}>{String(u.attrs.unit_code)}</span>
          ))}
          {missing.length > 30 ? <span>+{missing.length - 30} more</span> : null}
        </div>
      )}
    </section>
  )
}

function Corrections({ state, parties, onProof }: { state: PanelState | undefined; parties: Party[]; onProof: ProofHandler }) {
  const links = state?.superseded ?? []
  return (
    <section className="card" aria-labelledby="corrections-h">
      <div className="card-head">
        <CardTitle icon="edit" id="corrections-h">Corrections</CardTitle>
        {state?.status === "ready" && <span className="pill">{links.length}</span>}
      </div>
      <p className="muted">Posted results can never be edited. A correction is a new entity by the same observer that names the original; both stay public.</p>
      {state?.status !== "ready" ? (
        <Skeleton lines={2} />
      ) : links.length === 0 ? (
        <p className="muted">No corrections.</p>
      ) : (
        <ul className="feed">
          {links.map(({ original, by }) => (
            <li key={original.key}>
              <button type="button" className="link-btn" onClick={() => onProof(`${original.attrs.unit_code}: original and correction`, [original, by])}>
                {String(original.attrs.unit_code)}
              </button>
              <span className="meta">{nameOf(by.creator) ?? by.creator.slice(0, 10)}</span>
              <span className="meta" style={{ flexBasis: "100%" }}>
                <s>{figures(original, parties)}</s>
                <br />
                {figures(by, parties)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const THRESHOLDS = [5, 8, 10]
const LOWEST = THRESHOLDS[0]!
const rejected = (r: Row) => Number(r.attrs.rejected ?? 0)

/** True once `ref` comes near the viewport, so a card's own query runs only if someone looks. */
function useSeen(ref: RefObject<HTMLElement>): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, seen])
  return seen
}

/**
 * Q7 stays a genuine range query on Arkiv (`rejected > 5` on a typed u64), run once when the card
 * scrolls into view; higher thresholds narrow it in the browser. It reads results from any wallet
 * and applies the trust list locally, so both observer groups share the one read. Results posted
 * after its snapshot arrive through the main panel's live updates, so it never queries again.
 */
function Suspicious({ main, election, coordinator, onProof }: { main: PanelState | undefined; election: string; coordinator: string; onProof: ProofHandler }) {
  const [threshold, setThreshold] = useState(8)
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref)
  const limited = useRateLimited()
  const fetched = useMemo(() => ({ ...suspiciousPanel(election, coordinator, LOWEST), includeIgnored: true }), [election, coordinator])
  const { state } = usePanel(collate, seen ? fetched : undefined)
  const panel = useMemo(() => suspiciousPanel(election, coordinator, threshold), [election, coordinator, threshold])
  const rows = useMemo(() => {
    if (state?.status !== "ready") return []
    const known = new Set(state.rows.map((r) => r.key))
    const later = (main?.rows ?? []).filter((r) => r.createdAt > (state.block ?? 0n) && rejected(r) > LOWEST && !known.has(r.key))
    // The main panel sees corrections outside this range too, so it knows what has been replaced.
    const replaced = new Set((main?.superseded ?? []).map((l) => l.original.key))
    return computePanel(panel, [...state.rows, ...later]).current.filter((r) => rejected(r) > threshold && !replaced.has(r.key))
  }, [state, main?.rows, main?.superseded, panel, threshold])
  return (
    <section className="card" aria-labelledby="suspicious-h" ref={ref}>
      <div className="card-head">
        <CardTitle icon="flame" id="suspicious-h">High rejected ballots</CardTitle>
        <label className="toolbar">
          <span className="toolbar-label">More than</span>
          <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="btn btn-small">
            {THRESHOLDS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state?.status === "error" ? (
        <p className="muted">{limited ? "Waiting for Arkiv's read budget to reset." : `Could not run the range query: ${state.error}`}</p>
      ) : state?.status !== "ready" ? (
        <Skeleton lines={3} />
      ) : (
        <RowTable
          rows={rows}
          columns={[{ field: "rejected", label: "Rejected" }, { field: "accredited", label: "Accredited" }]}
          label={(r) => String(r.attrs.unit_code)}
          onSelect={(r) => onProof(String(r.attrs.unit_code), [r])}
          empty={`No units with more than ${threshold} rejected ballots.`}
        />
      )}
      <PanelFoot
        state={state}
        panel={panel}
        note={`Range query on Arkiv: rejected > ${LOWEST}${threshold === LOWEST ? "" : `, narrowed to > ${threshold} in the browser`}`}
      />
    </section>
  )
}

function Ignored({ state, parties, onProof }: { state: PanelState | undefined; parties: Party[]; onProof: ProofHandler }) {
  const [all, setAll] = useState(false)
  // Strangers first (wallets no group accredited), then other groups' observers.
  const known = new Set(deployment.observers.map((o) => o.address))
  const sorted = [...(state?.ignored ?? [])].sort((a, b) => Number(known.has(a.creator)) - Number(known.has(b.creator)))
  const strangers = sorted.filter((r) => !known.has(r.creator)).length
  const ignored = all ? sorted : sorted.slice(0, Math.max(3, strangers))
  return (
    <section className="card" aria-labelledby="ignored-h">
      <div className="card-head">
        <CardTitle icon="ban" id="ignored-h">Not counted for this group</CardTitle>
        {state?.status === "ready" && <span className="pill">{sorted.length}</span>}
      </div>
      <p className="muted">Anyone can write to Arkiv. Results from wallets this group did not accredit, whether another group's observers or a stranger, are listed here and never counted in this view.</p>
      {state?.status !== "ready" ? (
        <Skeleton lines={2} />
      ) : ignored.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="feed">
          {ignored.map((r) => (
            <li key={r.key}>
              <button type="button" className="link-btn" onClick={() => onProof(`${r.attrs.unit_code}: not counted`, [r])}>
                {String(r.attrs.unit_code)}
              </button>
              <span className="meta">{nameOf(r.creator) ?? r.creator.slice(0, 10)}</span>
              <span className="meta" style={{ flexBasis: "100%" }}>{figures(r, parties)}</span>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > ignored.length || all ? (
        <button type="button" className="link-btn" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${sorted.length}, including other groups' observers`}
        </button>
      ) : null}
    </section>
  )
}

function ProofDialog({ proof, parties, block, onClose }: { proof: Proof; parties: Party[]; block: bigint | undefined; onClose: () => void }) {
  const { wallet, connect, error } = useWallet()
  const [status, setStatus] = useState<Record<string, string>>({})

  async function extend(row: Row) {
    if (!wallet) return connect()
    setStatus((s) => ({ ...s, [row.key]: "Confirm in your wallet…" }))
    try {
      const res = await wallet.client.extendEntity({
        entityKey: row.key,
        expires: ExpirationTime.atBlock(row.expiresAt + BLOCKS_PER_DAY * BigInt(EXTEND_DAYS)),
      })
      setStatus((s) => ({ ...s, [row.key]: `Extended to block ${res.expiresAt}` }))
    } catch (e) {
      setStatus((s) => ({ ...s, [row.key]: errorMessage(e) }))
    }
  }

  return (
    <Provenance
      title={proof.title}
      rows={proof.rows}
      explorer={collate.explorer}
      nameOf={nameOf}
      currentBlock={block}
      describe={(r) => figures(r, parties)}
      onClose={onClose}
      actions={(r) =>
        r.flags.permissionlessExtension ? (
          <span className="row">
            <button type="button" className="btn btn-small" onClick={() => void extend(r)} title="Anyone may keep this result alive: it was created with permissionless extension">
              Extend {EXTEND_DAYS} days
            </button>
            {(status[r.key] ?? error) && <span className="muted">{status[r.key] ?? error}</span>}
          </span>
        ) : null
      }
    />
  )
}

function OffArkiv() {
  return (
    <section className="card" aria-labelledby="off-h">
      <CardTitle icon="database" id="off-h">What is on Arkiv, and what is deliberately not</CardTitle>
      <div className="grid cols-2">
        <ul className="list-plain">
          <li>
            <b>On Arkiv:</b> the election, polling units, accreditations, unit results and corrections, each attributed to the wallet
            that created it.
          </li>
          <li>Results are readonly: nobody, including Collate, can edit one. Anyone can extend their lifetime.</li>
        </ul>
        <ul className="list-plain">
          <li>
            <b>Off Arkiv:</b> names, phones or IDs of voters and observers (none exist here), result-sheet photos (only a SHA-256 hash
            is stored), computed totals and consensus (every viewer recomputes them), keys, and your preferences (kept in this browser).
          </li>
        </ul>
      </div>
    </section>
  )
}
