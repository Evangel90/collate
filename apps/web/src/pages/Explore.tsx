import { decodePanel, encodePanel, eq, renderWhere, type Panel } from "@collate/core"
import { BarChart, GroupTable, Provenance, RowTable, usePanel } from "@collate/core/ui"
import { useEffect, useMemo, useState } from "react"
import { collate, deployment, nameOf } from "../lib/collate"
import { CardTitle, Skeleton } from "../components/ui"
import { href } from "../lib/router"
import { resultsPanel, unitsPanel } from "../model/panels"
import type { Row } from "@collate/core"

const [groupA, groupB] = deployment.coordinators

const PRESETS: { label: string; panel: Panel }[] = [
  { label: "Collate results, Group A", panel: resultsPanel(deployment.election, groupA!.address, "state") },
  { label: "Collate results, Group B by ward", panel: resultsPanel(deployment.election, groupB!.address, "ward") },
  { label: "Polling units, Group A", panel: unitsPanel(deployment.election, groupA!.address) },
  {
    label: "All accreditations, any creator",
    panel: { title: "Accreditations by creator", query: [eq("type", "accreditation"), eq("election", deployment.election)], groupBy: "$creator", view: "table" },
  },
]

/**
 * The general collate-core page: any panel config, from a link or typed in, rendered live from
 * Arkiv. Nothing here is election-specific.
 */
export function Explore({ params }: { params: URLSearchParams }) {
  const fromUrl = params.get("panel")
  const initial = useMemo(() => {
    if (!fromUrl) return { panel: PRESETS[0]!.panel }
    try {
      return { panel: decodePanel(fromUrl) }
    } catch (e) {
      return { panel: PRESETS[0]!.panel, error: `That link's panel could not be read: ${(e as Error).message}` }
    }
  }, [fromUrl])
  const [panel, setPanel] = useState<Panel>(initial.panel)
  const [text, setText] = useState(() => JSON.stringify(initial.panel, null, 2))
  const [error, setError] = useState(initial.error)

  useEffect(() => {
    setPanel(initial.panel)
    setText(JSON.stringify(initial.panel, null, 2))
    setError(initial.error)
  }, [initial])

  /** Validates a config, renders it, and puts it in the URL so the page can be shared. */
  function show(candidate: Panel) {
    try {
      const next = decodePanel(encodePanel(candidate))
      renderWhere(next.query) // throws on an invalid predicate before any request
      setPanel(next)
      setText(JSON.stringify(next, null, 2))
      setError(undefined)
      window.location.hash = href("/explore", { panel: encodePanel(next) }).slice(1)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function run() {
    try {
      show(JSON.parse(text) as Panel)
    } catch (e) {
      setError(`The config is not valid JSON: ${(e as Error).message}`)
    }
  }

  // Which preset, if any, the current panel is: keeps the dropdown showing the choice.
  const presetIndex = PRESETS.findIndex((p) => JSON.stringify(p.panel) === JSON.stringify(panel))

  return (
    <div className="grid">
      <section className="hero">
        <h1>collate-core</h1>
        <p>
          A small TypeScript engine that turns any Arkiv query into live, trust-filtered tables and charts in the browser, with no
          indexer and no backend. Collate is its first user; the config below is the whole contract. Edit it, run it, share the link.
        </p>
      </section>

      <div className="grid cols-2">
        <section className="card">
          <div className="card-head">
            <CardTitle icon="edit">Panel config</CardTitle>
            <select
              className="btn btn-small"
              value={presetIndex >= 0 ? String(presetIndex) : ""}
              onChange={(e) => {
                const preset = PRESETS[Number(e.target.value)]
                if (preset) show(preset.panel)
              }}
              aria-label="Load an example"
            >
              <option value="" disabled>
                {presetIndex >= 0 ? "Load an example…" : "Custom config"}
              </option>
              {PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <label className="field">
            <span className="sr-only">Panel JSON</span>
            <textarea rows={22} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </label>
          {error && <p className="notice notice-error">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={run}>
              Run
            </button>
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(window.location.href)}>
              Copy share link
            </button>
          </div>
          <details>
            <summary>Config reference</summary>
            <pre className="code">{`query          Where[]: every predicate must hold
               { op: "eq"|"gt"|"gte"|"lt"|"lte", field, value }
               { op: "or", any: Where[] }   { op: "and", all: Where[] }
               numbers encode as u64; use {type:"i32",value} etc. to override
trust          { rootCreators, listQuery, addressField }:
               keep entities created by wallets named in
               addressField of list entities the roots created
supersedeField attribute naming an entity this one replaces
disputeKey     flag groups where trusted sources disagree
groupBy, sum   client-side aggregation
live           patch in new entities over WebSocket`}</pre>
          </details>
        </section>
        <PanelView panel={panel} />
      </div>
    </div>
  )
}

function PanelView({ panel }: { panel: Panel }) {
  const { state } = usePanel(collate, panel)
  const [proof, setProof] = useState<Row[] | undefined>()
  const sum = panel.sum ?? []
  const label = (f: string) => panel.labels?.[f] ?? f
  const byKey = (keys: string[]) => {
    const set = new Set(keys)
    setProof((state?.current ?? []).filter((r) => set.has(r.key)))
  }

  return (
    <section className="card">
      <div className="card-head">
        <CardTitle icon="chart">{panel.title}</CardTitle>
        <span className={state?.live === "live" ? "pill pill-live" : "pill pill-off"}>{state?.live === "live" ? "Live" : state?.status ?? "…"}</span>
      </div>
      <pre className="code">{renderWhere(panel.query)}</pre>
      {state?.status === "error" && <p className="notice notice-error">{state.error}</p>}
      {state?.status === "loading" && <Skeleton lines={4} height={18} />}
      {state?.status === "ready" && (
        <>
          <p className="muted">
            {state.rows.length} entities{state.trust ? ` from ${state.trust.members.size} trusted wallets` : ""}
            {state.ignored.length ? ` · ${state.ignored.length} from untrusted wallets ignored` : ""}
            {state.disputes.length ? ` · ${state.disputes.length} disputed` : ""}
            {state.superseded.length ? ` · ${state.superseded.length} superseded` : ""} · block {String(state.block)}
          </p>
          {panel.groupBy && sum.length > 0 && panel.view === "bar" ? (
            <BarChart title={panel.title} groups={state.groups} series={sum.slice(0, 3).map((f) => ({ field: f, label: label(f) }))} onSelect={(g) => byKey(g.keys)} />
          ) : null}
          {panel.groupBy ? (
            <GroupTable groups={state.groups} total={state.total} groupLabel={panel.groupBy} columns={sum.map((f) => ({ field: f, label: label(f) }))} onSelect={(g) => byKey(g.keys)} />
          ) : (
            <RowTable rows={state.current} columns={sum.map((f) => ({ field: f, label: label(f) }))} label={(r) => String(r.attrs.unit_code ?? r.attrs.type ?? r.key.slice(0, 10))} onSelect={(r) => setProof([r])} />
          )}
          {panel.view === "bar" && sum.length > 3 && <p className="muted">The chart shows the first three summed fields; the table shows all.</p>}
        </>
      )}
      {proof && (
        <Provenance
          title={`${proof.length} entities`}
          rows={proof}
          explorer={collate.explorer}
          nameOf={nameOf}
          currentBlock={state?.block}
          describe={(r) => Object.entries(r.attrs).filter(([k]) => k !== "type").map(([k, v]) => `${k}=${v}`).join(" ")}
          onClose={() => setProof(undefined)}
        />
      )}
    </section>
  )
}
