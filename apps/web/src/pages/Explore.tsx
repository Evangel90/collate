import { decodePanel, encodePanel, renderWhere, type Row } from "@collate/core"
import { Provenance, usePanel } from "@collate/core/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { Builder } from "../components/studio/Builder"
import { Dashboard, MAX_PINNED, decodeDashboard, encodeDashboard } from "../components/studio/Dashboard"
import { draftToPanel, fieldsFrom, normalize, panelToDraft, type Draft, type FieldInfo, type StudioPanel } from "../components/studio/model"
import { Output } from "../components/studio/Output"
import { PRESETS, type Preset } from "../components/studio/presets"
import { UseInApp } from "../components/studio/UseInApp"
import { CardTitle, Icon } from "../components/ui"
import { collate, nameOf } from "../lib/collate"
import { href } from "../lib/router"
import "../studio.css"

const DEFAULT = PRESETS[0]!
const ECOSYSTEM = "https://hub.arkiv.network/ecosystem"
const CORE_SOURCE = "https://github.com/Evangel90/collate/tree/main/packages/core"

/** The page answers on /studio and /explore; links keep whichever one the viewer used. */
function currentPath() {
  const path = window.location.hash.replace(/^#/, "").split("?")[0]
  return path === "/studio" ? "/studio" : "/explore"
}

/** Checks a config the way the engine will read it, so a bad one fails here and not mid-request. */
function validate(candidate: StudioPanel): StudioPanel {
  const next = decodePanel(encodePanel(candidate)) as StudioPanel
  renderWhere(next.query)
  if (next.trust) renderWhere(next.trust.listQuery)
  return next
}

const tryJson = (build: () => StudioPanel) => {
  try {
    return JSON.stringify(build())
  } catch {
    return undefined
  }
}

/**
 * Collate Studio: build a live, trust-filtered dashboard from any Arkiv query with a form, see it
 * render, then take the share link or the generated code. Nothing here is election-specific.
 */
export function Explore({ params }: { params: URLSearchParams }) {
  const fromUrl = params.get("panel")
  const initial = useMemo((): { panel: StudioPanel; error?: string } => {
    if (!fromUrl) return { panel: DEFAULT.panel }
    try {
      return { panel: validate(decodePanel(fromUrl)) }
    } catch (e) {
      return { panel: DEFAULT.panel, error: `That link's panel could not be read: ${(e as Error).message}` }
    }
  }, [fromUrl])

  const [panel, setPanel] = useState<StudioPanel>(initial.panel)
  const [draft, setDraft] = useState<Draft>(() => panelToDraft(initial.panel))
  const [error, setError] = useState(initial.error)
  const [proof, setProof] = useState<{ title: string; rows: Row[] }>()
  const [fields, setFields] = useState<FieldInfo[]>([])
  const dashParam = params.get("dash")
  const [pinned, setPinned] = useState<StudioPanel[]>(() => decodeDashboard(dashParam))
  // A dashboard link without a panel opens on the dashboard.
  const [dashFirst] = useState(() => Boolean(dashParam) && !fromUrl)
  // The query this page last wrote into the URL, so its own navigation does not reset the form.
  const search = params.toString()
  const pushed = useRef(search)

  useEffect(() => {
    if (search === pushed.current) return
    pushed.current = search
    setPanel(initial.panel)
    setDraft(panelToDraft(initial.panel))
    setError(initial.error)
    setPinned(decodeDashboard(dashParam))
  }, [search, initial, dashParam])

  /** Writes the panel on screen and the pinned panels into the URL (a new history entry). */
  function writeUrl(current: StudioPanel, dash: StudioPanel[]) {
    const query: Record<string, string> = { panel: encodePanel(current) }
    if (dash.length) query.dash = encodeDashboard(dash)
    pushed.current = new URLSearchParams(query).toString()
    window.location.hash = href(currentPath(), query).slice(1)
  }

  const { state, handle } = usePanel(collate, panel)

  // Suggestions come from the last result that returned anything.
  useEffect(() => {
    if (state?.status !== "ready") return
    const seen = fieldsFrom(state)
    if (seen.length) setFields(seen)
  }, [state])

  /** Renders a config and puts it in the URL so the page can be shared or bookmarked. */
  function show(candidate: StudioPanel, resetForm: boolean) {
    try {
      const next = validate(candidate)
      setPanel(next)
      if (resetForm) setDraft(panelToDraft(next))
      setError(undefined)
      writeUrl(next, pinned)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function runForm() {
    try {
      show(draftToPanel(draft), false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const runningJson = useMemo(() => tryJson(() => normalize(panel)) ?? JSON.stringify(panel), [panel])
  const dirty = tryJson(() => draftToPanel(draft)) !== runningJson
  const active = PRESETS.find((p) => JSON.stringify(p.panel) === runningJson)
  const base = `${window.location.origin}${window.location.pathname}`
  const shareLink = `${base}${href(currentPath(), { panel: encodePanel(panel) })}`
  const dashLink = pinned.length ? `${base}${href(currentPath(), { dash: encodeDashboard(pinned) })}` : ""
  const isPinned = pinned.some((p) => JSON.stringify(p) === JSON.stringify(panel))

  function setDash(next: StudioPanel[]) {
    setPinned(next)
    writeUrl(panel, next)
  }

  const dashboard = pinned.length > 0 && (
    <Dashboard
      panels={pinned}
      link={dashLink}
      onEdit={(p) => {
        show(p, true)
        document.getElementById("studio-build")?.scrollIntoView({ behavior: "smooth", block: "start" })
      }}
      onRemove={(i) => setDash(pinned.filter((_, j) => j !== i))}
      onProof={(title, rows) => setProof({ title, rows })}
    />
  )

  return (
    <div className="grid studio">
      <section className="hero">
        <div className="eyebrow">
          <span className="pill">Tiramisu testnet</span>
          <span className="pill">No backend</span>
          <span className="pill">collate-core, MIT</span>
        </div>
        <h1>
          <span className="grad">Studio</span>
        </h1>
        <p>Live, trust-filtered dashboards from any Arkiv query, with no backend.</p>
        <p className="studio-lede">
          Arkiv's{" "}
          <a href={ECOSYSTEM} target="_blank" rel="noreferrer">
            ecosystem page
          </a>{" "}
          lists a "Query-to-Dashboard Studio" under <em>Nobody built this yet</em>: every project writes entities in, nobody ships the
          read side. This is that read side. Pick any entities, decide whose wallets count, group and sum, then share the link or copy
          the code. The engine,{" "}
          <a href={CORE_SOURCE} target="_blank" rel="noreferrer">
            collate-core
          </a>
          , is MIT licensed: use it in your project without asking.
        </p>
      </section>

      {dashFirst && dashboard}

      <Presets active={active} onPick={(p) => show(p.panel, true)} />

      {active?.source === "other" && active.about && (
        <p className="notice studio-other">
          <Icon name="eye" size={16} />
          <span>
            <b>Another team's public data, read without asking them.</b> {active.about} Collate has no connection to the project;
            the numbers are whatever their wallets wrote.
          </span>
        </p>
      )}

      <div className="studio-layout" id="studio-build">
        <Builder
          draft={draft}
          onChange={setDraft}
          fields={fields}
          dirty={dirty}
          error={error}
          onRun={runForm}
          onApplyJson={(p) => show(p, true)}
        />
        <Output
          panel={panel}
          state={state}
          handle={handle}
          shareLink={shareLink}
          onProof={(title, rows) => setProof({ title, rows })}
          pin={{ state: isPinned ? "pinned" : pinned.length >= MAX_PINNED ? "full" : "can", onPin: () => setDash([...pinned, panel]) }}
        />
      </div>

      {!dashFirst && dashboard}

      <UseInApp panel={panel} />

      {proof && (
        <Provenance
          title={proof.title}
          rows={proof.rows}
          explorer={collate.explorer}
          nameOf={(a) => nameOf(a) ?? state?.trust?.members.get(a)?.label}
          currentBlock={state?.block}
          describe={(r) =>
            Object.entries(r.attrs)
              .filter(([k]) => k !== "type")
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")
          }
          onClose={() => setProof(undefined)}
        />
      )}
    </div>
  )
}

function Presets({ active, onPick }: { active: Preset | undefined; onPick: (p: Preset) => void }) {
  const groups: { source: Preset["source"]; title: string }[] = [
    { source: "other", title: "Other teams' public data" },
    { source: "collate", title: "Collate's election demo" },
  ]
  return (
    <section className="card" aria-labelledby="studio-presets-h">
      <div className="card-head">
        <div>
          <CardTitle icon="database" id="studio-presets-h">Start from an example</CardTitle>
          <p>The same engine over entities from three different projects. Pick one, then change anything.</p>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.source} className="studio-preset-group">
          <h3 className="studio-subhead">{g.title}</h3>
          <div className="studio-presets">
            {PRESETS.filter((p) => p.source === g.source).map((p) => (
              <button key={p.id} type="button" className="studio-preset" aria-pressed={active?.id === p.id} onClick={() => onPick(p)}>
                <b>{p.label}</b>
                <span>{p.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
