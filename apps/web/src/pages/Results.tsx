import { ExpirationTime } from "@arkiv-network/sdk"
import { renderWhere, type AggRow, type PanelState, type Row } from "@collate/core"
import { BarChart, GroupTable, Provenance, RowTable, formatNumber, usePanel } from "@collate/core/ui"
import { useEffect, useMemo, useState } from "react"
import { CardTitle, Icon, Skeleton } from "../components/ui"
import { collate, deployment, nameOf, prefs } from "../lib/collate"
import { exploreHref, figures, timeAgo, useElection } from "../lib/data"
import { errorMessage, useWallet } from "../lib/wallet"
import type { Party } from "../model/schema"
import { latestPanel, resultsPanel, suspiciousPanel } from "../model/panels"

type GroupBy = "state" | "lga" | "ward"
type Proof = { title: string; rows: Row[] }

const EXTEND_DAYS = 30
const BLOCKS_PER_DAY = 43_200n // 2-second blocks

export function Results() {
  const election = deployment.election
  const [coordinatorId, setCoordinatorId] = useState(() => prefs.get("coordinator") ?? deployment.coordinators[0]!.id)
  const coordinator = deployment.coordinators.find((c) => c.id === coordinatorId) ?? deployment.coordinators[0]!
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (prefs.get("groupBy") as GroupBy) ?? "state")
  const [view, setView] = useState<"chart" | "table">("chart")
  const [proof, setProof] = useState<Proof | undefined>()

  const info = useElection(election, coordinator.address)
  const panel = useMemo(() => resultsPanel(election, coordinator.address, groupBy), [election, coordinator.address, groupBy])
  const { state } = usePanel(collate, panel)
  const parties = info.parties

  const chooseCoordinator = (id: string) => {
    setCoordinatorId(id)
    prefs.set("coordinator", id)
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
            {deployment.coordinators.map((c) => (
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
              {state.ignored.length} result{state.ignored.length === 1 ? "" : "s"} from unaccredited wallets ignored
            </span>
          ) : null}
        </div>
      </section>

      {state?.status === "error" && <p className="notice notice-error">Could not read from Arkiv: {state.error}</p>}
      {info.error && <p className="notice notice-error">Could not load the election: {info.error}</p>}

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
            columns={[...parties.map((p) => ({ field: p.field, label: p.short })), { field: "rejected", label: "Rejected" }]}
            onSelect={(g) => proofFor(`${g.group}: who posted these numbers`, g.keys)}
          />
        )}
        <PanelFoot state={state} panel={panel} note="Disputed units are left out of totals and listed below." />
      </section>

      <div className="grid cols-2">
        <Disputes state={state} parties={parties} onProof={(title, rows) => setProof({ title, rows })} />
        <Latest version={state?.rows.length ?? 0} election={election} coordinator={coordinator.address} parties={parties} onProof={(title, rows) => setProof({ title, rows })} />
        <Missing units={info.units} state={state} />
        <Corrections state={state} parties={parties} onProof={(title, rows) => setProof({ title, rows })} />
        <Suspicious version={state?.rows.length ?? 0} election={election} coordinator={coordinator.address} onProof={(title, rows) => setProof({ title, rows })} />
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
  const reported = new Set([...(state?.resolved ?? []), ...(state?.disputes.flatMap((d) => d.entries) ?? [])].map((r) => String(r.attrs.unit_code)))
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
          {reported.size}
          <span className="muted"> / {units || "—"}</span>
        </span>
        <span className="share" aria-hidden="true"><span style={{ width: `${units ? (reported.size / units) * 100 : 0}%` }} /></span>
        <span className="tile-sub">
          <span>{state?.disputes.length ?? 0} disputed</span>
          <span>{units ? `${Math.round((reported.size / units) * 100)}%` : ""}</span>
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
        <a href={exploreHref(panel)}>Open in collate-core ↗</a>
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

function Disputes({ state, parties, onProof }: { state: PanelState | undefined; parties: Party[]; onProof: ProofHandler }) {
  const disputes = state?.disputes ?? []
  const fields = [...parties.map((p) => p.field), "rejected", "accredited"]
  return (
    <section className="card" aria-labelledby="disputes-h">
      <div className="card-head">
        <CardTitle icon="alert" id="disputes-h" tone="critical">Disputed units</CardTitle>
        {state?.status === "ready" && (
          <span className={disputes.length ? "pill pill-critical" : "pill pill-good"}>{disputes.length ? `${disputes.length} flagged` : "None"}</span>
        )}
      </div>
      <p className="muted">Two trusted observers posted different figures for the same unit. Both stay visible; neither is counted until resolved.</p>
      {state?.status !== "ready" && <Skeleton lines={2} />}
      {disputes.map((d) => (
        <div key={d.key} className="dispute">
          <div className="dispute-head">
            <strong>{d.key}</strong>
            <button type="button" className="link-btn" onClick={() => onProof(`${d.key}: disputed`, d.entries)}>
              Proof ↗
            </button>
          </div>
          <div className="versions">
            {d.entries.map((r) => (
              <div key={r.key} className="version">
                <span className="muted">{nameOf(r.creator) ?? r.creator.slice(0, 10)}</span>
                {fields.map((f) => {
                  const differs = new Set(d.entries.map((e) => e.attrs[f])).size > 1
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
    </section>
  )
}

/**
 * Secondary panels run their own range queries but no live subscription of their own: they refresh
 * when the main panel's trusted rows change, which keeps an idle page at zero queries.
 */
function useFollow(handle: { refresh: () => Promise<void> } | undefined, version: number) {
  const [first] = useState(version)
  useEffect(() => {
    if (handle && version !== first) void handle.refresh()
  }, [handle, version, first])
}

function Latest({ version, election, coordinator, parties, onProof }: { version: number; election: string; coordinator: string; parties: Party[]; onProof: ProofHandler }) {
  const [hours, setHours] = useState(1)
  // Rounded to the minute so the panel config, and with it the live subscription, stays stable.
  const since = useMemo(() => Math.floor(Date.now() / 60_000) * 60 - hours * 3600, [hours])
  const panel = useMemo(() => latestPanel(election, coordinator, since), [election, coordinator, since])
  const { state, handle } = usePanel(collate, panel)
  useFollow(handle, version)
  const rows = [...(state?.current ?? [])].sort((a, b) => Number(b.attrs.submitted_at ?? 0) - Number(a.attrs.submitted_at ?? 0))
  return (
    <section className="card" aria-labelledby="latest-h">
      <div className="card-head">
        <CardTitle icon="clock" id="latest-h">Latest submissions</CardTitle>
        <div className="seg" role="group" aria-label="Window">
          {[1, 6, 24].map((h) => (
            <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}>
              {h} h
            </button>
          ))}
        </div>
      </div>
      {state?.status === "loading" ? (
        <Skeleton lines={3} />
      ) : rows.length === 0 ? (
        <p className="muted">Nothing submitted in the last {hours} h.</p>
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
      <PanelFoot state={state} panel={panel} note={`Range query on submitted_at · ${rows.length} in window`} />
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

function Suspicious({ version, election, coordinator, onProof }: { version: number; election: string; coordinator: string; onProof: ProofHandler }) {
  const [threshold, setThreshold] = useState(8)
  const panel = useMemo(() => suspiciousPanel(election, coordinator, threshold), [election, coordinator, threshold])
  const { state, handle } = usePanel(collate, panel)
  useFollow(handle, version)
  return (
    <section className="card" aria-labelledby="suspicious-h">
      <div className="card-head">
        <CardTitle icon="flame" id="suspicious-h">High rejected ballots</CardTitle>
        <label className="toolbar">
          <span className="toolbar-label">More than</span>
          <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="btn btn-small">
            {[5, 8, 10].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state?.status === "loading" ? (
        <Skeleton lines={3} />
      ) : (
        <RowTable
          rows={state?.current ?? []}
          columns={[{ field: "rejected", label: "Rejected" }, { field: "accredited", label: "Accredited" }]}
          label={(r) => String(r.attrs.unit_code)}
          onSelect={(r) => onProof(String(r.attrs.unit_code), [r])}
          empty={`No units with more than ${threshold} rejected ballots.`}
        />
      )}
      <PanelFoot state={state} panel={panel} note={`Range query: rejected > ${threshold}`} />
    </section>
  )
}

function Ignored({ state, parties, onProof }: { state: PanelState | undefined; parties: Party[]; onProof: ProofHandler }) {
  const ignored = state?.ignored ?? []
  return (
    <section className="card" aria-labelledby="ignored-h">
      <div className="card-head">
        <CardTitle icon="ban" id="ignored-h">Ignored writes</CardTitle>
        {state?.status === "ready" && <span className="pill">{ignored.length}</span>}
      </div>
      <p className="muted">Anyone can write to Arkiv. Results from wallets this group has not accredited are shown here and never counted.</p>
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
            is stored), computed totals and disputes (every viewer recomputes them), keys, and your preferences (kept in this browser).
          </li>
        </ul>
      </div>
    </section>
  )
}
