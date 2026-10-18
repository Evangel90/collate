import type { PanelHandle, PanelState, Row } from "collate-core"
import type { Ref } from "react"
import { Icon } from "../ui"
import type { StudioPanel } from "./model"
import { Disputes, LiveBadge, PanelResult, PanelStats, queryText, safeRender } from "./Output"
import { CopyButton } from "./widgets"

type Props = {
  panel: StudioPanel
  state: PanelState | undefined
  handle: PanelHandle | undefined
  shareLink: string
  onProof: (title: string, rows: Row[]) => void
  /** Back to the Studio layout with the builder. */
  onMinimise: () => void
  /** The heading, so focus can move to it when this view opens. */
  headingRef?: Ref<HTMLHeadingElement>
}

/**
 * One panel, large: what a share link opens. It renders the same panel state as the builder view
 * (no second query), and Minimise returns to the builder with this config filled in.
 */
export function Focus({ panel, state, handle, shareLink, onProof, onMinimise, headingRef }: Props) {
  const query = safeRender(panel)
  return (
    <section className="studio-focus" aria-labelledby="studio-focus-h" aria-busy={state?.status === "loading"}>
      <header className="studio-focus-head">
        <div className="studio-focus-titles">
          <p className="studio-focus-kicker">Collate Studio panel</p>
          <h1 id="studio-focus-h" ref={headingRef} tabIndex={-1}>
            {panel.title}
          </h1>
        </div>
        <div className="studio-focus-actions">
          <CopyButton text={shareLink} label="Copy link" />
          <button type="button" className="btn btn-small" onClick={onMinimise} title="Back to the builder (Esc)">
            <Icon name="minimise" size={15} />
            Edit panel
          </button>
        </div>
      </header>

      <div className="studio-focus-meta">
        <LiveBadge panel={panel} state={state} />
        <button type="button" className="link-btn small" onClick={() => void handle?.refresh()} disabled={!handle || state?.status === "loading"}>
          Refresh
        </button>
      </div>

      {state?.status === "error" && <p className="notice notice-error">Could not read from Arkiv: {state.error}</p>}

      <PanelStats panel={panel} state={state} onProof={onProof} />

      <div className="card studio-focus-body">
        <PanelResult panel={panel} state={state} onProof={onProof} fit skeletonLines={6} />
        {state?.status === "ready" && state.rows.length > 0 && panel.groupBy && (
          <p className="muted studio-focus-hint">Select a {panel.view === "bar" ? "bar" : "row"} to see the entities behind it and the wallets that wrote them.</p>
        )}
      </div>

      <Disputes panel={panel} state={state} onProof={onProof} />

      <details className="studio-focus-prov">
        <summary>
          <span>{panel.live ? "Read live from Arkiv" : "Read from Arkiv"}</span>
          <span aria-hidden="true">·</span>
          <span className="studio-focus-prov-label">query</span>
          <code className="studio-focus-prov-q">{query}</code>
        </summary>
        <pre className="code">{queryText(panel)}</pre>
        <p className="muted">
          The whole config is in the link. Anyone who opens it reads the same entities from Arkiv's public RPC; nothing is stored by us.
        </p>
      </details>
    </section>
  )
}
