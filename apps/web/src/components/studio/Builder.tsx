import { useEffect, useId, useState, type ReactNode } from "react"
import { CardTitle } from "../ui"
import { draftToPanel, type Draft, type FieldInfo, type StudioPanel } from "./model"
import { ChipInput, FieldList, FilterRows, Toggle } from "./widgets"

type Props = {
  draft: Draft
  onChange: (draft: Draft) => void
  fields: FieldInfo[]
  /** True when the form differs from what is on screen. */
  dirty: boolean
  error?: string
  onRun: () => void
  onApplyJson: (panel: StudioPanel) => void
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="studio-section">
      <legend>{title}</legend>
      {hint && <p className="studio-hint">{hint}</p>}
      {children}
    </fieldset>
  )
}

/** The form-based panel builder. It edits a draft; nothing is queried until Run. */
export function Builder({ draft, onChange, fields, dirty, error, onRun, onApplyJson }: Props) {
  const id = useId()
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const setTrust = (patch: Partial<Draft["trust"]>) => onChange({ ...draft, trust: { ...draft.trust, ...patch } })
  const names = fields.map((f) => f.name)
  const numeric = fields.filter((f) => f.numeric).map((f) => f.name)
  const oneOfValues = fields.find((f) => f.name === draft.oneOf.field)?.values ?? []
  const trusted = draft.trust.roots.length > 0
  const consensus = draft.disputeKey.trim() !== ""

  return (
    <section className="card studio-builder" aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <div>
          <CardTitle icon="edit" id={`${id}-h`}>Build a panel</CardTitle>
          <p>{fields.length ? `${fields.length} attributes seen in the last result are offered as suggestions.` : "Run once and the attributes Arkiv returns are offered as suggestions."}</p>
        </div>
      </div>

      <form
        className="studio-form"
        onSubmit={(e) => {
          e.preventDefault()
          onRun()
        }}
      >
        <label className="field">
          <span>Title</span>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="What this panel shows" />
        </label>

        <Section title="Which entities" hint="Every filter must hold. Values are typed: a number stored as u64 only matches a u64 filter.">
          <div className="studio-oneof">
            <input
              className="studio-in mono"
              aria-label="Attribute for one-of"
              placeholder="attribute"
              list={`${id}-all`}
              value={draft.oneOf.field}
              onChange={(e) => set({ oneOf: { ...draft.oneOf, field: e.target.value } })}
            />
            <span className="studio-oneof-label">is one of</span>
            <ChipInput
              label="One-of values"
              values={draft.oneOf.values}
              onChange={(values) => set({ oneOf: { field: draft.oneOf.field || "type", values } })}
              placeholder="values (any of them matches)"
              suggestions={draft.oneOf.field ? oneOfValues : []}
              mono
            />
          </div>
          <FilterRows filters={draft.filters} onChange={(filters) => set({ filters })} fields={fields} />
          {draft.extra.length > 0 && (
            <p className="studio-hint">
              Plus {draft.extra.length} nested {draft.extra.length === 1 ? "group" : "groups"} from the JSON, kept as written.{" "}
              <button type="button" className="link-btn small" onClick={() => set({ extra: [] })}>
                Remove
              </button>
            </p>
          )}
        </Section>

        <Section title="Created by" hint="Optional. Only entities whose $creator is one of these wallets. The chain sets $creator; nobody can change it.">
          <ChipInput label="Creator wallets" values={draft.creators} onChange={(creators) => set({ creators })} placeholder="0x… (any number)" mono />
        </Section>

        <details className="studio-details" open={trusted || undefined}>
          <summary>Only count wallets vouched for by…</summary>
          <div className="studio-details-body">
            <p className="studio-hint">
              Trust a list instead of fixed wallets: entities created by these root wallets name the wallets you trust, and only
              those wallets' entities are counted. Collate uses this for accreditations.
            </p>
            <div className="field">
              <span>Root wallets</span>
              <ChipInput label="Root wallets" values={draft.trust.roots} onChange={(roots) => setTrust({ roots })} placeholder="0x… whose lists you trust" mono />
            </div>
            <div className="field">
              <span>List entities</span>
              <FilterRows filters={draft.trust.listFilters} onChange={(listFilters) => setTrust({ listFilters })} fields={fields} addLabel="Add list filter" />
            </div>
            <div className="field-row">
              <label className="field">
                <span>Attribute holding the wallet</span>
                <input className="mono" value={draft.trust.addressField} onChange={(e) => setTrust({ addressField: e.target.value })} placeholder="observer" />
              </label>
              <label className="field">
                <span>Label attribute (optional)</span>
                <input className="mono" value={draft.trust.labelField} onChange={(e) => setTrust({ labelField: e.target.value })} placeholder="name" />
              </label>
            </div>
            <Toggle
              checked={draft.includeIgnored}
              disabled={!trusted}
              onChange={(includeIgnored) => set({ includeIgnored })}
              label="List ignored writes too"
              hint="Also fetch matching entities from other wallets and show them as not counted."
            />
          </div>
        </details>

        <Section title="Summarise">
          <div className="field-row">
            <label className="field">
              <span>Group by</span>
              <input className="mono" list={`${id}-group`} value={draft.groupBy} onChange={(e) => set({ groupBy: e.target.value })} placeholder="none: one row per entity" />
              <FieldList id={`${id}-group`} fields={fields} system />
            </label>
            <div className="field">
              <span>View</span>
              <div className="seg" role="group" aria-label="View">
                <button type="button" aria-pressed={draft.view === "bar"} onClick={() => set({ view: "bar" })}>
                  Bar chart
                </button>
                <button type="button" aria-pressed={draft.view === "table"} onClick={() => set({ view: "table" })}>
                  Table
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <span>Sum these numbers</span>
            <ChipInput label="Fields to sum" values={draft.sum} onChange={(sum) => set({ sum })} placeholder="votes_a, units… (empty: count entities)" suggestions={numeric} listId={`${id}-num`} mono />
            <FieldList id={`${id}-num`} fields={fields} numericOnly />
          </div>
        </Section>

        <details className="studio-details" open={consensus || undefined}>
          <summary>Consensus and corrections</summary>
          <div className="studio-details-body">
            <p className="studio-hint">
              Group entities by a key; when sources disagree on the compared fields, the group is shown as disputed and left out of
              totals instead of being silently counted.
            </p>
            <div className="field-row">
              <label className="field">
                <span>Dispute key</span>
                <input className="mono" list={`${id}-all`} value={draft.disputeKey} onChange={(e) => set({ disputeKey: e.target.value })} placeholder="unit_code" />
              </label>
              <label className="field">
                <span>Quorum</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  inputMode="numeric"
                  disabled={!consensus}
                  value={draft.quorum ?? ""}
                  onChange={(e) => set({ quorum: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined })}
                  placeholder="1"
                />
                <small>Agreeing sources needed before a group counts.</small>
              </label>
            </div>
            <div className="field">
              <span>Compare fields</span>
              <ChipInput label="Fields to compare" values={draft.compareFields} onChange={(compareFields) => set({ compareFields })} placeholder="default: the summed fields" suggestions={consensus ? names.filter((n) => n !== draft.disputeKey) : []} mono />
            </div>
            <label className="field">
              <span>Correction attribute</span>
              <input className="mono" list={`${id}-all`} value={draft.supersedeField} onChange={(e) => set({ supersedeField: e.target.value })} placeholder="corrects" />
              <small>Names the entity key a newer entity replaces. Only the same creator can replace its own entity.</small>
            </label>
          </div>
        </details>

        <Toggle
          checked={draft.live}
          onChange={(live) => set({ live })}
          label="Live updates"
          hint={
            trusted
              ? "New entities from trusted wallets arrive over a WebSocket and are re-checked on the node."
              : "Without a trust list, every new entity on the network is re-checked: one query per batch, every 5 seconds."
          }
        />

        <FieldList id={`${id}-all`} fields={fields} />

        <div className="studio-run">
          <button type="submit" className="btn btn-primary">
            Run
          </button>
          <span className="muted" aria-live="polite">{dirty ? "Changes not run yet" : "Showing this config"}</span>
        </div>
        {error && <p className="notice notice-error">{error}</p>}
      </form>

      <JsonEditor draft={draft} onApply={onApplyJson} />
    </section>
  )
}

/** The power-user view: the same config as JSON, editable. */
function JsonEditor({ draft, onApply }: { draft: Draft; onApply: (panel: StudioPanel) => void }) {
  const fromDraft = () => {
    try {
      return JSON.stringify(draftToPanel(draft), null, 2)
    } catch {
      return ""
    }
  }
  const [text, setText] = useState(fromDraft)
  const [touched, setTouched] = useState(false)
  const [problem, setProblem] = useState<string>()
  // Follows the form until the JSON is edited by hand.
  useEffect(() => {
    if (!touched) setText(fromDraft())
  }, [draft, touched])

  return (
    <details className="studio-details">
      <summary>Edit as JSON</summary>
      <div className="studio-details-body">
        <label className="field">
          <span className="sr-only">Panel config as JSON</span>
          <textarea
            rows={16}
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setTouched(true)
            }}
          />
        </label>
        {problem && <p className="notice notice-error">{problem}</p>}
        <div className="row">
          <button
            type="button"
            className="btn btn-small"
            disabled={!touched}
            onClick={() => {
              try {
                onApply(JSON.parse(text) as StudioPanel)
                setTouched(false)
                setProblem(undefined)
              } catch (e) {
                setProblem(`Not valid JSON: ${(e as Error).message}`)
              }
            }}
          >
            Apply and run
          </button>
          {touched && (
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                setTouched(false)
                setProblem(undefined)
              }}
            >
              Discard JSON edits
            </button>
          )}
        </div>
        <pre className="code studio-ref">{`query          every predicate must hold
               { op: "eq"|"gt"|"gte"|"lt"|"lte", field, value }
               { op: "startsWith", field, value }
               { op: "or", any: [...] }  { op: "and", all: [...] }
               numbers are u64; { type: "i32", value } etc. to override
trust          { rootCreators, listQuery, addressField, labelField? }
supersedeField attribute naming an entity this one replaces
disputeKey     flag groups whose sources disagree on compareFields
quorum         agreeing sources needed before a group counts
groupBy, sum   aggregation in the browser
live           patch in new entities over WebSocket
labels         { field: "Human label" }`}</pre>
      </div>
    </details>
  )
}
