import type { Row } from "collate-core"
import { expiresIn } from "collate-core/ui"
import { useState } from "react"
import { collate } from "../../lib/collate"
import { PARTY_FIELDS } from "../../model/schema"
import { CardTitle } from "../ui"
import { electionIdFor, partyShort, type Draft } from "./plan"
import { formatDate, type ElectionMeta } from "./shared"

type Props = {
  election: Row | undefined
  meta: ElectionMeta
  id: string
  block?: bigint
  /** The new election's form, while it is not on Arkiv yet. */
  draft: Draft | undefined
  setDraft: (update: (d: Draft) => Draft) => void
  problems: string[]
  onNext: () => void
}

export function ElectionStep({ election, meta, id, block, draft, setDraft, problems, onNext }: Props) {
  if (!draft) return <Summary election={election} meta={meta} id={id} block={block} onNext={onNext} />
  return <Form draft={draft} setDraft={setDraft} id={id} problems={problems} onNext={onNext} />
}

function Form({ draft, setDraft, id, problems, onNext }: { draft: Draft; setDraft: Props["setDraft"]; id: string; problems: string[]; onNext: () => void }) {
  const [tried, setTried] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const generated = electionIdFor(draft.name, draft.suffix)

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <CardTitle icon="edit">1. Election details</CardTitle>
          <p>Nothing is sent yet. The election is created together with its polling units in the next step.</p>
        </div>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (problems.length === 0) onNext()
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Ward 3 by-election (synthetic)" maxLength={120} required />
          <small>Public. Shown at the top of the results page.</small>
        </label>
        <label className="field">
          <span>Description</span>
          <textarea className="coord-prose" rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={500} />
          <small>Public. Say plainly that the data is synthetic.</small>
        </label>

        <div className="field-row">
          <div className="field">
            <span>Counting opens</span>
            <p className="coord-static">When you create the election</p>
          </div>
          <label className="field">
            <span>Counting closes</span>
            <input type="date" value={draft.closes} onChange={(e) => set("closes", e.target.value)} required />
            <small>At the end of that day. Accreditations lapse 7 days later unless you extend them.</small>
          </label>
        </div>

        <label className="field coord-quorum">
          <span>Quorum</span>
          <span className="coord-quorum-row">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={9}
              step={1}
              value={Number.isFinite(draft.quorum) ? draft.quorum : ""}
              onChange={(e) => set("quorum", e.target.value === "" ? NaN : Math.floor(Number(e.target.value)))}
            />
            <span className="small">
              Count a unit when at least <b>{Number.isInteger(draft.quorum) ? draft.quorum : "N"}</b>{" "}
              {draft.quorum === 1 ? "observer reports" : "observers report"} the same figures and they are a majority of those who
              reported.
            </span>
          </span>
          <small>1 to 9. A recommendation stored with the election: viewers start from it and can change it.</small>
        </label>

        <fieldset className="coord-fieldset">
          <legend>Parties</legend>
          <p className="muted">
            Every Collate election has exactly three party slots. Observers enter one figure per slot, so name all three; use
            fictional names for test elections.
          </p>
          <div className="field-row">
            {PARTY_FIELDS.map((field, i) => (
              <label key={field} className="field">
                <span>Slot {"ABC"[i]}</span>
                <input
                  value={draft.parties[i]}
                  onChange={(e) => setDraft((d) => ({ ...d, parties: d.parties.map((p, j) => (j === i ? e.target.value : p)) as Draft["parties"] }))}
                  maxLength={40}
                  required
                />
                <small>Short label: {partyShort(draft.parties[i] ?? "")}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <details className="coord-advanced">
          <summary>Advanced: election id</summary>
          <label className="field">
            <span>Election id</span>
            <input
              className="mono"
              value={id}
              onChange={(e) => set("customId", e.target.value.trim().toLowerCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
            />
            <small>
              Made from the name plus a random suffix, so two elections never share one. It goes into every entity's{" "}
              <span className="mono">election</span> attribute and into the links you share.
            </small>
          </label>
          {draft.customId !== undefined && draft.customId !== generated && (
            <button type="button" className="link-btn" onClick={() => set("customId", undefined)}>
              Use the generated id ({generated})
            </button>
          )}
        </details>

        {tried && problems.length > 0 && (
          <ul className="notice notice-error coord-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="row coord-actions">
          <button type="submit" className="btn btn-primary">
            Next: polling units →
          </button>
        </div>
      </form>
    </section>
  )
}

function Summary({ election, meta, id, block, onNext }: { election: Row | undefined; meta: ElectionMeta; id: string; block?: bigint; onNext: () => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <CardTitle icon="database" tone="good">
            1. Election
          </CardTitle>
          <p>Readonly on Arkiv: these details can't be edited. To change them, create a new election.</p>
        </div>
        {election && (
          <a className="btn btn-small" href={collate.explorer.entity(election.key)} target="_blank" rel="noreferrer">
            Entity on the explorer ↗
          </a>
        )}
      </div>
      <dl className="coord-facts">
        <div>
          <dt>Name</dt>
          <dd>{meta.name}</dd>
        </div>
        <div>
          <dt>Election id</dt>
          <dd className="mono">{id}</dd>
        </div>
        {meta.description && (
          <div className="coord-wide">
            <dt>Description</dt>
            <dd>{meta.description}</dd>
          </div>
        )}
        <div>
          <dt>Counting window</dt>
          <dd>
            {formatDate(meta.opensAt)} to {formatDate(meta.closesAt)}
          </dd>
        </div>
        <div>
          <dt>Quorum</dt>
          <dd>
            {meta.quorum} agreeing {meta.quorum === 1 ? "observer" : "observers"}, and a majority of those who reported
          </dd>
        </div>
        <div className="coord-wide">
          <dt>Parties (three slots)</dt>
          <dd className="row">
            {meta.parties.map((p) => (
              <span key={p.field} className="pill">
                {p.name} · {p.short}
              </span>
            ))}
          </dd>
        </div>
        {election && (
          <div>
            <dt>Entity expires in</dt>
            <dd>{expiresIn(election.expiresAt, block)}</dd>
          </div>
        )}
      </dl>
      <div className="row coord-actions">
        <button type="button" className="btn btn-primary" onClick={onNext}>
          Next: polling units →
        </button>
      </div>
    </section>
  )
}
