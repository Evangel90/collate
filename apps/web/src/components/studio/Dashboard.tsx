import { decodePanel, encodePanel, type Row } from "collate-core"
import { usePanel } from "collate-core/ui"
import { useState, type Ref } from "react"
import { collate } from "../../lib/collate"
import { CardTitle, Icon } from "../ui"
import type { StudioPanel } from "./model"
import { PanelResult } from "./Output"
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
  /**
   * "focus" shows the dashboard large on its own (what a dashboard link opens); "hidden" keeps it
   * mounted but out of sight, so its live panels are not torn down and queried again on return.
   */
  mode: "normal" | "focus" | "hidden"
  onEdit: (panel: StudioPanel) => void
  onRemove: (index: number) => void
  onProof: (title: string, rows: Row[]) => void
  /** Opens the dashboard large. */
  onExpand: () => void
  /** Leaves the large dashboard for the builder. */
  onExit: () => void
  headingRef?: Ref<HTMLHeadingElement>
  expandRef?: Ref<HTMLButtonElement>
}

/** Pinned panels side by side, each live on its own, all in one share link. */
export function Dashboard({ panels, link, mode, onEdit, onRemove, onProof, onExpand, onExit, headingRef, expandRef }: Props) {
  const focus = mode === "focus"
  const summary = `${panels.length} pinned ${panels.length === 1 ? "panel" : "panels"}, each read live from Arkiv.`
  return (
    <section className={focus ? "studio-focus studio-focus-dash" : "card"} aria-labelledby="studio-dash-h" hidden={mode === "hidden"}>
      {focus ? (
        <header className="studio-focus-head">
          <div className="studio-focus-titles">
            <p className="studio-focus-kicker">Collate Studio dashboard</p>
            <h1 id="studio-dash-h" ref={headingRef} tabIndex={-1}>
              Dashboard
            </h1>
            <p className="muted">{summary} Select a bar or row for the entities behind it.</p>
          </div>
          <div className="studio-focus-actions">
            <CopyButton text={link} label="Copy dashboard link" />
            <button type="button" className="btn btn-small" onClick={onExit} title="Back to the builder (Esc)">
              <Icon name="minimise" size={15} />
              Open builder
            </button>
          </div>
        </header>
      ) : (
        <div className="card-head">
          <div>
            <CardTitle icon="chart" id="studio-dash-h">Dashboard</CardTitle>
            <p>
              {summary} The link holds all of them; up to {MAX_PINNED}.
            </p>
          </div>
          <div className="row">
            <CopyButton text={link} label="Copy dashboard link" />
            <button ref={expandRef} type="button" className="btn btn-small" onClick={onExpand} title="Show the dashboard large (the dashboard link opens this view)">
              <Icon name="expand" size={15} />
              Expand
            </button>
          </div>
        </div>
      )}
      <div className={focus ? "studio-dash studio-dash-large" : "studio-dash"}>
        {panels.map((p, i) => (
          <MiniPanel key={`${i}-${encodePanel(p)}`} panel={p} large={focus} onEdit={() => onEdit(p)} onRemove={() => onRemove(i)} onProof={onProof} />
        ))}
      </div>
    </section>
  )
}

function MiniPanel({ panel, large, onEdit, onRemove, onProof }: { panel: StudioPanel; large: boolean; onEdit: () => void; onRemove: () => void; onProof: Props["onProof"] }) {
  const { state } = usePanel(collate, panel)
  // Expanding spans the whole row and draws the chart at full size, from the same live state.
  const [expanded, setExpanded] = useState(false)
  const live = panel.live && state?.live === "live"

  return (
    <article className={`studio-mini${expanded ? " is-expanded" : ""}`} aria-label={panel.title}>
      <header className="studio-mini-head">
        <h3>{panel.title}</h3>
        <span className="row">
          <span className={live ? "pill pill-live" : "pill pill-off"}>
            {live ? "Live" : "Snapshot"}
            {state?.block ? ` · ${state.block.toLocaleString("en")}` : ""}
          </span>
          <button
            type="button"
            className="studio-mini-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${panel.title}` : `Expand ${panel.title}`}
            title={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name={expanded ? "minimise" : "expand"} size={15} />
          </button>
        </span>
      </header>
      {state?.status === "error" && <p className="notice notice-error">{state.error}</p>}
      <PanelResult panel={panel} state={state} onProof={onProof} fit={large || expanded} reserve={expanded ? 380 : Infinity} skeletonLines={3} />
      <footer className="studio-mini-foot">
        <span className="muted">
          {state?.status === "ready"
            ? `${state.rows.length} entities${state.ignored.length ? ` · ${state.ignored.length} ignored` : ""}${state.disputes.length ? ` · ${state.disputes.length} contested` : ""}`
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
