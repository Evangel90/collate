import { decodePanel, encodePanel, renderWhere, type Row } from "@collate/core"
import { AttrList, Provenance, usePanel } from "@collate/core/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { Builder } from "../components/studio/Builder"
import { Dashboard, MAX_PINNED, decodeDashboard, encodeDashboard } from "../components/studio/Dashboard"
import { Focus } from "../components/studio/Focus"
import { draftToPanel, fieldsFrom, normalize, panelToDraft, type Draft, type FieldInfo, type StudioPanel } from "../components/studio/model"
import { Output } from "../components/studio/Output"
import { PRESETS, type Preset } from "../components/studio/presets"
import { UseInApp } from "../components/studio/UseInApp"
import { CardTitle, Icon } from "../components/ui"
import { collate, nameOf } from "../lib/collate"
import { ATTR_LABELS, ATTR_ORDER } from "../lib/data"
import { href } from "../lib/router"
import "../studio.css"

const DEFAULT = PRESETS[0]!
/** Already in the dialog's heading (unit code or type), or the same on every row (election). */
const PROOF_HIDE = ["type", "unit_code", "election"]
const ECOSYSTEM = "https://hub.arkiv.network/ecosystem"
const CORE_SOURCE = "https://github.com/Evangel90/collate/tree/main/packages/core"

/** The page also answers on /explore for old links, but every link it writes uses /studio. */
function currentPath() {
  return "/studio"
}

/**
 * Which layout is on screen: "edit" is the builder, "focus" one panel large, "dash" the dashboard
 * large. The URL can name it with `view=`; without one, a panel link opens in focus and a
 * dashboard-only link opens the dashboard large, so copied share links open enlarged.
 */
type View = "edit" | "focus" | "dash"

/** The view a link opens when it does not name one. */
const defaultView = (hasPanel: boolean, hasDash: boolean): View => (hasPanel ? "focus" : hasDash ? "dash" : "edit")

function viewFrom(params: URLSearchParams, unreadable: boolean): View {
  // A panel that could not be read opens the builder, where the error is shown.
  const hasPanel = params.has("panel") && !unreadable
  const hasDash = params.has("dash")
  const asked = params.get("view")
  if (asked === "focus" && hasPanel) return "focus"
  if (asked === "dash" && hasDash) return "dash"
  if (asked) return "edit"
  return defaultView(hasPanel, hasDash)
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
  const [view, setView] = useState<View>(() => viewFrom(params, Boolean(initial.error)))
  // A dashboard link does not query the builder's panel until the builder is first shown.
  const [builderSeen, setBuilderSeen] = useState(view !== "dash")
  if (view !== "dash" && !builderSeen) setBuilderSeen(true)
  // The query this page last wrote into the URL, so its own navigation does not reset the form.
  const search = params.toString()
  const pushed = useRef(search)

  // Where keyboard focus goes after a view change: the new view's heading, or back to the button
  // that opened it. Nothing moves on first load, so a share link behaves like a normal page.
  const focusHeading = useRef<HTMLHeadingElement>(null)
  const dashHeading = useRef<HTMLHeadingElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const dashExpandButton = useRef<HTMLButtonElement>(null)
  const focusNext = useRef<(() => HTMLElement | null) | undefined>(undefined)

  useEffect(() => {
    if (search === pushed.current) return
    // Back, forward or an edited address. An unchanged config keeps its live panel (usePanel
    // compares configs by JSON), so switching views this way does not query Arkiv again either.
    pushed.current = search
    setPanel(initial.panel)
    setDraft(panelToDraft(initial.panel))
    setError(initial.error)
    setPinned(decodeDashboard(dashParam))
    setView(viewFrom(params, Boolean(initial.error)))
  }, [search, initial, dashParam, params])

  /** Writes the panel on screen, the pinned panels and the view into the URL (a new history entry). */
  function writeUrl(current: StudioPanel, dash: StudioPanel[], nextView: View = view) {
    const query: Record<string, string> = { panel: encodePanel(current) }
    if (dash.length) query.dash = encodeDashboard(dash)
    // Name the view only when it is not the one the link opens anyway (focus, for a panel link).
    if (nextView !== defaultView(true, dash.length > 0)) query.view = nextView
    pushed.current = new URLSearchParams(query).toString()
    window.location.hash = href(currentPath(), query).slice(1)
  }

  const { state, handle } = usePanel(collate, builderSeen ? panel : undefined)

  // Suggestions come from the last result that returned anything.
  useEffect(() => {
    if (state?.status !== "ready") return
    const seen = fieldsFrom(state)
    if (seen.length) setFields(seen)
  }, [state])

  /** Switches layout without touching the panel: the same state and subscription stay on screen. */
  function switchView(next: View, focusTarget: () => HTMLElement | null) {
    if (next === view) return
    focusNext.current = focusTarget
    setView(next)
    writeUrl(panel, pinned, next)
  }

  useEffect(() => {
    const target = focusNext.current?.()
    focusNext.current = undefined
    if (!target) return
    if (view === "edit") {
      target.focus()
    } else {
      window.scrollTo(0, 0)
      target.focus({ preventScroll: true })
    }
  }, [view])

  /** Renders a config and puts it in the URL so the page can be shared or bookmarked. */
  function show(candidate: StudioPanel, resetForm: boolean, nextView: View = view) {
    try {
      const next = validate(candidate)
      setPanel(next)
      if (resetForm) setDraft(panelToDraft(next))
      setError(undefined)
      writeUrl(next, pinned, nextView)
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
  // Share links carry no view, so they open on the large view.
  const shareLink = `${base}${href(currentPath(), { panel: encodePanel(panel) })}`
  const dashLink = pinned.length ? `${base}${href(currentPath(), { dash: encodeDashboard(pinned) })}` : ""
  const isPinned = pinned.some((p) => JSON.stringify(p) === JSON.stringify(panel))

  function setDash(next: StudioPanel[]) {
    setPinned(next)
    // Removing the last panel from the large dashboard leaves nothing there: go back to the builder.
    const nextView = view === "dash" && next.length === 0 ? "edit" : view
    setView(nextView)
    writeUrl(panel, next, nextView)
  }

  const minimise = () => switchView("edit", () => (view === "dash" ? dashExpandButton.current : expandButton.current))

  // Esc leaves either large view, unless it is closing the provenance dialog.
  useEffect(() => {
    if (view === "edit") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return
      minimise()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const editing = view === "edit"
  const dashboard = pinned.length > 0 && (
    <Dashboard
      panels={pinned}
      link={dashLink}
      mode={view === "dash" ? "focus" : view === "focus" ? "hidden" : "normal"}
      onEdit={(p) => {
        setView("edit")
        show(p, true, "edit")
        requestAnimationFrame(() => document.getElementById("studio-build")?.scrollIntoView({ behavior: "smooth", block: "start" }))
      }}
      onRemove={(i) => setDash(pinned.filter((_, j) => j !== i))}
      onProof={(title, rows) => setProof({ title, rows })}
      onExpand={() => switchView("dash", () => dashHeading.current)}
      onExit={minimise}
      headingRef={dashHeading}
      expandRef={dashExpandButton}
    />
  )

  return (
    <div className="grid studio">
      {view === "focus" && (
        <Focus
          panel={panel}
          state={state}
          handle={handle}
          shareLink={shareLink}
          onProof={(title, rows) => setProof({ title, rows })}
          onMinimise={minimise}
          headingRef={focusHeading}
        />
      )}

      {/* The builder layout stays mounted under a large view, so nothing in it resets or re-queries. */}
      <section className="hero" hidden={!editing}>
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

      <div className="grid" hidden={!editing}>
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
      </div>

      <div className="studio-layout" id="studio-build" hidden={!editing}>
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
          onExpand={() => switchView("focus", () => focusHeading.current)}
          expandRef={expandButton}
        />
      </div>

      {!dashFirst && dashboard}

      <div className="grid" hidden={!editing}>
        <UseInApp panel={panel} />
      </div>

      {proof && (
        <Provenance
          title={proof.title}
          rows={proof.rows}
          explorer={collate.explorer}
          nameOf={(a) => nameOf(a) ?? state?.trust?.members.get(a)?.label}
          currentBlock={state?.block}
          describe={(r) => (
            <AttrList attrs={r.attrs} labels={{ ...panel.labels, ...ATTR_LABELS }} hide={PROOF_HIDE} order={ATTR_ORDER} />
          )}
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
