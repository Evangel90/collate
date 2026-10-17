import { decodePanel, encodePanel, type Row } from "@collate/core"
import { BarChart, GroupTable, RowTable, usePanel } from "@collate/core/ui"
import { collate } from "../../lib/collate"
import { CardTitle, Skeleton } from "../ui"
import type { StudioPanel } from "./model"
import { CopyButton } from "./widgets"

/** At most this many panels on one dashboard: each is its own live query against a metered public RPC. */
export const MAX_PINNED = 6

/** Several panels in one URL parameter: encoded panels joined by "." (not in the base64url alphabet). */
export function encodeDashboard(panels: StudioPanel[]): string {
  return panels.map((p) => encodePanel(p)).join(".")
}

export function decodeDashboard(encoded: string | null): StudioPanel[] {
  if (!encoded) return []
  const panels: StudioPanel[] = []
  for (const part of encoded.split(".").slice(0, MAX_PINNED)) {
    try {
      panels.push(decodePanel(part) as StudioPanel)
    } catch {
      /* one unreadable panel does not take the dashboard down */
    }
  }
  return panels
}

type Props = {
  panels: StudioPanel[]
  link: string
  onEdit: (panel: StudioPanel) => void
  onRemove: (index: number) => void
  onProof: (title: string, rows: Row[]) => void
}

/** Pinned panels side by side, each live on its own, all in one share link. */
export function Dashboard({ panels, link, onEdit, onRemove, onProof }: Props) {
  return (
    <section className="card" aria-labelledby="studio-dash-h">
      <div className="card-head">
        <div>
          <CardTitle icon="chart" id="studio-dash-h">Dashboard</CardTitle>
          <p>
            {panels.length} pinned {panels.length === 1 ? "panel" : "panels"}, each read live from Arkiv. The link holds all of them;
            up to {MAX_PINNED}.
          </p>
        </div>
        <CopyButton text={link} label="Copy dashboard link" />
      </div>
      <div className="studio-dash">
        {panels.map((p, i) => (
          <MiniPanel key={`${i}-${encodePanel(p)}`} panel={p} onEdit={() => onEdit(p)} onRemove={() => onRemove(i)} onProof={onProof} />
        ))}
      </div>
    </section>
  )
}

function MiniPanel({ panel, onEdit, onRemove, onProof }: { panel: StudioPanel; onEdit: () => void; onRemove: () => void; onProof: Props["onProof"] }) {
  const { state } = usePanel(collate, panel)
  const sum = panel.sum ?? []
  const label = (f: string) => panel.labels?.[f] ?? f
  const series = sum.length ? sum.slice(0, 3).map((f) => ({ field: f, label: label(f) })) : [{ field: "$count", label: "Entities" }]
  const groups = sum.length ? state?.groups ?? [] : (state?.groups ?? []).map((g) => ({ ...g, sums: { $count: g.count } }))
  const columns = sum.map((f) => ({ field: f, label: label(f) }))
  const byKeys = (keys: string[]) => {
    const set = new Set(keys)
    return (state?.current ?? []).filter((r) => set.has(r.key))
  }
  const live = panel.live && state?.live === "live"

  return (
    <article className="studio-mini">
      <header className="studio-mini-head">
        <h3>{panel.title}</h3>
        <span className={live ? "pill pill-live" : "pill pill-off"}>
          {live ? "Live" : "Snapshot"}
          {state?.block ? ` · ${state.block.toLocaleString("en")}` : ""}
        </span>
      </header>
      {state?.status === "error" && <p className="notice notice-error">{state.error}</p>}
      {!state || state.status === "loading" ? (
        <Skeleton lines={3} height={18} />
      ) : state.status === "ready" ? (
        panel.groupBy && panel.view === "bar" ? (
          <BarChart
            title={panel.title}
            groups={groups}
            series={series}
            labelWidth={Math.min(260, Math.max(116, 16 + 8.2 * Math.max(0, ...groups.map((g) => g.group.length))))}
            onSelect={(g) => onProof(`${g.group}: the entities behind this bar`, byKeys(g.keys))}
          />
        ) : panel.groupBy ? (
          <GroupTable groups={state.groups} total={state.total} groupLabel={panel.groupBy} countLabel="Entities" columns={columns} onSelect={(g) => onProof(g.group, byKeys(g.keys))} />
        ) : (
          <RowTable rows={state.current} columns={columns} label={(r) => String(r.attrs.type ?? r.key.slice(0, 10))} onSelect={(r) => onProof("Entity", [r])} />
        )
      ) : null}
      <footer className="studio-mini-foot">
        <span className="muted">
          {state?.status === "ready"
            ? `${state.rows.length} entities${state.ignored.length ? ` · ${state.ignored.length} ignored` : ""}${state.disputes.length ? ` · ${state.disputes.length} disputed` : ""}`
            : "Reading from Arkiv…"}
        </span>
        <span className="row">
          <button type="button" className="link-btn small" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="link-btn small" onClick={onRemove}>
            Remove
          </button>
        </span>
      </footer>
    </article>
  )
}
