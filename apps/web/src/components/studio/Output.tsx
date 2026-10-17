import { renderWhere, type PanelHandle, type PanelState, type Row } from "@collate/core"
import { BarChart, GroupTable, RowTable, formatNumber, shortAddress } from "@collate/core/ui"
import { useState } from "react"
import { nameOf } from "../../lib/collate"
import { CardTitle, Skeleton } from "../ui"
import type { StudioPanel } from "./model"
import { CopyButton } from "./widgets"

type Props = {
  panel: StudioPanel
  state: PanelState | undefined
  handle: PanelHandle | undefined
  shareLink: string
  onProof: (title: string, rows: Row[]) => void
}

function LiveBadge({ panel, state }: { panel: StudioPanel; state: PanelState | undefined }) {
  if (!panel.live) return <span className="pill pill-off">Snapshot{state?.block ? ` · block ${state.block.toLocaleString("en")}` : ""}</span>
  if (!state || state.live === "off" || state.live === "connecting") return <span className="pill pill-off">Connecting</span>
  if (state.live === "error") return <span className="pill pill-off" title={state.error}>Live paused</span>
  return (
    <span className="pill pill-live" title="New entities arrive over a WebSocket subscription to Arkiv entity events">
      Live{state.block ? ` · block ${state.block.toLocaleString("en")}` : ""}
    </span>
  )
}

function Stat({ label, value, tone, onClick }: { label: string; value: string | number; tone?: "critical" | "good"; onClick?: () => void }) {
  const body = (
    <>
      <span className="studio-stat-value">{typeof value === "number" ? formatNumber(value) : value}</span>
      <span className="studio-stat-label">{label}</span>
    </>
  )
  const cls = `studio-stat${tone ? ` studio-stat-${tone}` : ""}`
  return onClick ? (
    <button type="button" className={`${cls} is-clickable`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** The live result: counts, the chart or table, disputes, and the exact query and share link. */
export function Output({ panel, state, handle, shareLink, onProof }: Props) {
  const [showQuery, setShowQuery] = useState(true)
  const sum = panel.sum ?? []
  const label = (f: string) => panel.labels?.[f] ?? f
  const compare = panel.compareFields ?? sum
  const query = safeRender(panel)
  const rowsByKey = (keys: string[]) => {
    const set = new Set(keys)
    return (state?.current ?? []).filter((r) => set.has(r.key))
  }
  // With nothing to sum, chart the entity count per group.
  const series = sum.length ? sum.slice(0, 3).map((f) => ({ field: f, label: label(f) })) : [{ field: "$count", label: "Entities" }]
  const groups = sum.length ? state?.groups ?? [] : (state?.groups ?? []).map((g) => ({ ...g, sums: { $count: g.count } }))
  const columns = sum.map((f) => ({ field: f, label: label(f) }))
  // Without a group-by, show each entity with a few of its attributes.
  const rowColumns = columns.length
    ? columns
    : [...new Set((state?.current ?? []).flatMap((r) => Object.keys(r.attrs)))].filter((k) => k !== "type").slice(0, 3).map((f) => ({ field: f, label: label(f) }))
  const rowLabel = (r: Row) => String((panel.disputeKey && r.attrs[panel.disputeKey]) ?? r.attrs.type ?? r.key.slice(0, 10))

  return (
    <section className="card studio-output" aria-labelledby="studio-out-h" aria-busy={state?.status === "loading"}>
      <div className="card-head">
        <CardTitle icon="chart" id="studio-out-h">{panel.title}</CardTitle>
        <div className="row">
          <LiveBadge panel={panel} state={state} />
          <button type="button" className="btn btn-small" onClick={() => void handle?.refresh()} disabled={!handle || state?.status === "loading"}>
            Refresh
          </button>
        </div>
      </div>

      {state?.status === "error" && <p className="notice notice-error">Could not read from Arkiv: {state.error}</p>}

      <div className="studio-stats" aria-label="Counts">
        <Stat label={state?.trust ? "trusted entities" : "entities"} value={state?.status === "ready" ? state.rows.length : "…"} />
        {state?.trust && <Stat label="trusted wallets" value={state.trust.members.size} tone="good" />}
        {panel.includeIgnored && (
          <Stat
            label="ignored"
            value={state?.status === "ready" ? state.ignored.length : "…"}
            tone={state?.ignored.length ? "critical" : undefined}
            onClick={state?.ignored.length ? () => onProof(`${state.ignored.length} entities from wallets outside the trust list (not counted)`, state.ignored) : undefined}
          />
        )}
        {panel.disputeKey && <Stat label="disputed" value={state?.status === "ready" ? state.disputes.length : "…"} tone={state?.disputes.length ? "critical" : undefined} />}
        {panel.supersedeField && <Stat label="corrected" value={state?.status === "ready" ? state.superseded.length : "…"} />}
        <Stat label="block" value={state?.block !== undefined ? state.block.toLocaleString("en") : "…"} />
      </div>

      {!state || state.status === "loading" ? (
        <Skeleton lines={4} height={22} />
      ) : state.status === "ready" && state.rows.length === 0 ? (
        <p className="notice">
          No matching entities{state.trust ? " from trusted wallets" : ""} at this block. Check the attribute names and value types: Arkiv
          matches <code>u64</code> 5 and <code>str</code> "5" differently.
        </p>
      ) : state.status === "ready" ? (
        <>
          {panel.groupBy && panel.view === "bar" ? (
            <BarChart
              title={panel.title}
              groups={groups}
              series={series}
              // Other projects' group names run long (e.g. drug names): size the label column to fit.
              labelWidth={Math.min(260, Math.max(116, 16 + 8.2 * Math.max(0, ...groups.map((g) => g.group.length))))}
              onSelect={(g) => onProof(`${g.group}: the entities behind this bar`, rowsByKey(g.keys))}
            />
          ) : panel.groupBy ? (
            <GroupTable
              groups={state.groups}
              total={state.total}
              groupLabel={panel.groupBy}
              countLabel="Entities"
              columns={columns}
              onSelect={(g) => onProof(`${g.group}: the entities behind this row`, rowsByKey(g.keys))}
            />
          ) : (
            <RowTable rows={state.current} columns={rowColumns} label={rowLabel} onSelect={(r) => onProof("Entity", [r])} />
          )}
          {panel.groupBy && panel.view === "bar" && sum.length > 3 && <p className="muted">The chart shows the first three summed fields; switch to Table for all of them.</p>}
        </>
      ) : null}

      {state?.status === "ready" && state.disputes.length > 0 && (
        <div className="studio-disputes">
          <h3 className="studio-subhead">
            Disputed: sources disagree on {compare.length ? compare.join(", ") : "the compared fields"}, so these are not counted
          </h3>
          <ul>
            {state.disputes.slice(0, 8).map((d) => (
              <li key={d.key}>
                <button type="button" className="studio-dispute" onClick={() => onProof(`${panel.disputeKey} ${d.key}: disagreeing entries`, d.entries)}>
                  <span className="mono studio-dispute-key">{d.key}</span>
                  <span className="studio-dispute-entries">
                    {d.entries.map((e) => (
                      <span key={e.key}>
                        {nameOf(e.creator) ?? shortAddress(e.creator)}: {compare.map((f) => `${label(f)} ${e.attrs[f] ?? "—"}`).join(", ") || "differs"}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {state.disputes.length > 8 && <p className="muted">and {state.disputes.length - 8} more.</p>}
        </div>
      )}

      <div className="studio-code-block">
        <div className="studio-code-head">
          <button type="button" className="link-btn small" aria-expanded={showQuery} onClick={() => setShowQuery(!showQuery)}>
            Arkiv query {showQuery ? "▾" : "▸"}
          </button>
          <CopyButton text={query} label="Copy query" />
        </div>
        {showQuery && (
          <pre className="code">
            {query}
            {panel.trust ? `\n\n-- trusted wallets: ${renderListQuery(panel)}\n-- then AND ($creator = <trusted wallet> OR …)` : ""}
          </pre>
        )}
      </div>

      <div className="studio-code-block">
        <div className="studio-code-head">
          <span className="small">Share link</span>
          <CopyButton text={shareLink} label="Copy link" />
        </div>
        <input className="studio-share mono" readOnly value={shareLink} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
        <p className="muted">The whole config is in the link. Anyone who opens it reads the same entities from Arkiv; nothing is stored by us.</p>
      </div>
    </section>
  )
}

function safeRender(panel: StudioPanel) {
  try {
    return renderWhere(panel.query)
  } catch (e) {
    return `(invalid: ${(e as Error).message})`
  }
}

function renderListQuery(panel: StudioPanel) {
  const t = panel.trust!
  try {
    return `${renderWhere(t.listQuery)} AND (${t.rootCreators.map((r) => `$creator = ${r}`).join(" OR ")}) → ${t.addressField}`
  } catch {
    return "(invalid list query)"
  }
}

