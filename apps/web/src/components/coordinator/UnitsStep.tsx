import type { Row } from "collate-core"
import { useMemo, useState } from "react"
import type { Wallet } from "../../lib/wallet"
import { PARTY_FIELDS, type ElectionInput } from "../../model/schema"
import { CardTitle, Icon } from "../ui"
import {
  CHUNK_SIZE,
  checkUnits,
  CSV_HEADER,
  draftId,
  emptyUnit,
  endOfDay,
  partyShort,
  sampleUnits,
  UNIT_COLUMNS,
  unitsFromCsv,
  type Draft,
  type UnitColumn,
  type UnitDraft,
} from "./plan"
import { shortAddress, StatusLine, TxLink, type Setup, type Status } from "./shared"
import type { BatchLog, SetupWriter } from "./useSetupWriter"

type Props = {
  wallet: Wallet
  id: string
  setup: Setup
  /** Lives in the workspace, so a run in progress survives moving between steps. */
  writer: SetupWriter
  /** Present while the election itself is still a draft. */
  draft: Draft | undefined
  setDraft: (update: (d: Draft) => Draft) => void
  draftProblems: string[]
  onCreated: (status: Status) => void
  onBack: () => void
}

const HEADINGS: Record<UnitColumn, string> = { unitCode: "Unit code", ward: "Ward", lga: "LGA", state: "State", registered: "Registered voters", name: "Name" }
const PLACEHOLDERS: Record<UnitColumn, string> = { unitCode: "SS-RIV-01-001", ward: "Riverside Ward 01", lga: "Riverside", state: "Sample State", registered: "800", name: "optional" }

export function UnitsStep({ wallet, id, setup, writer, draft, setDraft, draftProblems, onCreated, onBack }: Props) {
  const existingCodes = useMemo(() => new Set(setup.units.map((u) => String(u.attrs.unit_code))), [setup.units])
  // A draft keeps its rows in the draft, so they survive moving between steps; adding to an
  // existing election keeps them here.
  const [extra, setExtra] = useState<UnitDraft[]>(() => [emptyUnit()])
  const rows = draft ? draft.units : extra
  const setRows = (update: (rows: UnitDraft[]) => UnitDraft[]) => (draft ? setDraft((d) => ({ ...d, units: update(d.units) })) : setExtra(update))
  const check = useMemo(() => checkUnits(rows, id, existingCodes), [rows, id, existingCodes])
  const { phase, canResume, mustCheck } = writer.state
  const busy = phase === "sending"
  const [tried, setTried] = useState(false)
  const isNewElection = Boolean(draft) && !setup.election

  const blocked = check.messages.length > 0 || check.units.length === 0 || (isNewElection && draftProblems.length > 0)
  const done = (status: Status) => {
    if (draft) return onCreated(status)
    setExtra([emptyUnit()])
    setTried(false)
  }

  function create() {
    setTried(true)
    if (blocked || busy) return
    const existing = { election: Boolean(setup.election), unitCodes: existingCodes }
    if (!draft) return writer.start({ election: false, units: check.units }, undefined, existing, done)
    // Freeze the id first: a resume must target the same election even if the name changes.
    setDraft((d) => ({ ...d, customId: draftId(d), frozen: true }))
    const election: ElectionInput = {
      election: id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      parties: draft.parties.map((name, i) => ({ field: PARTY_FIELDS[i]!, name: name.trim(), short: partyShort(name) })),
      opensAt: Math.floor(Date.now() / 1000),
      closesAt: endOfDay(draft.closes),
      quorum: draft.quorum,
    }
    writer.start({ election: !setup.election, units: check.units }, election, existing, done)
  }

  const count = check.units.length
  const label = isNewElection ? `Create election and ${count} ${count === 1 ? "unit" : "units"}` : `Add ${count} ${count === 1 ? "unit" : "units"}`

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <CardTitle icon="map" tone={setup.units.length ? "good" : undefined}>
            2. Polling units
          </CardTitle>
          <p>
            {isNewElection
              ? "List the units observers will report on. The election and these units are created together."
              : "Units are readonly on Arkiv: once created they can't be edited or removed. You can add more at any time."}
          </p>
        </div>
      </div>

      {setup.units.length > 0 && <ExistingUnits units={setup.units} />}

      {!isNewElection && setup.units.length > 0 && <h3 className="subhead">Add units</h3>}
      <UnitsEditor rows={rows} setRows={setRows} problems={check.problems} tried={tried} taken={existingCodes} disabled={busy} />
      {check.messages.length > 0 && (tried || check.messages.some((m) => !m.endsWith("required"))) && (
        <ul className="notice notice-error coord-problems" aria-live="polite">
          {check.messages.slice(0, 6).map((m) => (
            <li key={m}>{m}</li>
          ))}
          {check.messages.length > 6 && <li>and {check.messages.length - 6} more</li>}
        </ul>
      )}

      <div className="coord-create">
        {isNewElection && draftProblems.length > 0 && tried && (
          <div className="notice notice-warn">
            <p>Step 1 is not complete:</p>
            <ul className="coord-problems">
              {draftProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <button type="button" className="btn btn-small" onClick={onBack}>
              Go to step 1
            </button>
          </div>
        )}
        <p className="small">
          {isNewElection ? (
            <>
              Creates the election <span className="mono">{id}</span> and {count} {count === 1 ? "unit" : "units"}, signed by{" "}
              <span className="mono">{shortAddress(wallet.address)}</span>. Collate tries one transaction so everything lands together; if
              the chain refuses one that large, it re-checks Arkiv and sends the rest in batches of {CHUNK_SIZE}, each confirmed in your
              wallet.
            </>
          ) : (
            <>
              Readonly, so check each code and figure before you sign. More than {CHUNK_SIZE} units may go in several batches, each
              confirmed in your wallet.
            </>
          )}
        </p>
        <div className="row coord-actions">
          {canResume ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => writer.resume(done)}>
              {mustCheck ? "I've checked the transaction: continue" : "Continue"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy || (tried && blocked)} onClick={create}>
              {label}
            </button>
          )}
          {isNewElection && (
            <button type="button" className="btn" onClick={onBack} disabled={busy}>
              ← Election details
            </button>
          )}
        </div>
        <Progress log={writer.state.log} />
        <StatusLine status={writer.state.status} />
      </div>
    </section>
  )
}

function Progress({ log }: { log: BatchLog[] }) {
  if (log.length === 0) return null
  const chunks = log.filter((l) => !l.label.startsWith("One batch")).length
  let n = 0
  return (
    <ol className="coord-batches" aria-label="Transactions">
      {log.map((l, i) => {
        const single = l.label.startsWith("One batch")
        if (!single) n++
        return (
          <li key={i} className={`coord-batch is-${l.state}`}>
            <span className="coord-batch-state">{STATE_LABEL[l.state]}</span>
            <span className="coord-batch-what">
              <b>{single ? "One transaction" : `Batch ${n} of ${chunks}`}</b> <span className="muted">{single ? l.label.replace("One batch: ", "") : l.label}</span>
              {l.note && <span className="coord-batch-note">{l.note}</span>}
            </span>
            <TxLink hash={l.txHash} />
          </li>
        )
      })}
    </ol>
  )
}

const STATE_LABEL: Record<BatchLog["state"], string> = { waiting: "Waiting", signing: "Confirm in wallet", done: "Done", failed: "Not applied", unknown: "Outcome unknown" }

function ExistingUnits({ units }: { units: Row[] }) {
  return (
    <details className="coord-existing" open={units.length <= 12}>
      <summary>
        {units.length} {units.length === 1 ? "unit" : "units"} on Arkiv
      </summary>
      <div className="coord-table-wrap coord-table-scroll">
        <table className="coord-table">
          <thead>
            <tr>
              <th>Unit code</th>
              <th>Ward</th>
              <th>LGA</th>
              <th>State</th>
              <th className="num">Registered</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.key}>
                <td className="mono">{String(u.attrs.unit_code)}</td>
                <td>{String(u.attrs.ward)}</td>
                <td>{String(u.attrs.lga)}</td>
                <td>{String(u.attrs.state)}</td>
                <td className="num">{Number(u.attrs.registered ?? 0).toLocaleString("en")}</td>
                <td>{String((u.payload as { name?: unknown } | undefined)?.name ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

type EditorProps = {
  rows: UnitDraft[]
  setRows: (update: (rows: UnitDraft[]) => UnitDraft[]) => void
  problems: ReturnType<typeof checkUnits>["problems"]
  tried: boolean
  taken: ReadonlySet<string>
  disabled: boolean
}

function UnitsEditor({ rows, setRows, problems, tried, taken, disabled }: EditorProps) {
  const [csvOpen, setCsvOpen] = useState(false)
  const filled = rows.filter((r) => UNIT_COLUMNS.some((c) => r[c].trim()))
  const edit = (id: number, column: UnitColumn, value: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [column]: value } : r)))
  const remove = (id: number) => setRows((rs) => (rs.length === 1 ? [emptyUnit()] : rs.filter((r) => r.id !== id)))
  // New rows copy the place from the last row: units are usually entered ward by ward.
  const add = () => setRows((rs) => [...rs, emptyUnit(rs[rs.length - 1])])
  const replaceOrAppend = (incoming: UnitDraft[]) => setRows((rs) => (rs.every((r) => UNIT_COLUMNS.every((c) => !r[c].trim())) ? incoming : [...rs, ...incoming]))

  return (
    <div className="coord-editor">
      <div className="toolbar">
        <button type="button" className="btn btn-small" onClick={add} disabled={disabled}>
          <Icon name="plus" size={14} /> Add row
        </button>
        <button type="button" className="btn btn-small" aria-expanded={csvOpen} onClick={() => setCsvOpen((o) => !o)} disabled={disabled}>
          <Icon name="upload" size={14} /> Paste or upload CSV
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={() => replaceOrAppend(sampleUnits(6, new Set([...taken, ...rows.map((r) => r.unitCode.trim())])))}
        >
          Fill with sample units
        </button>
        <span className="muted">
          {filled.length} {filled.length === 1 ? "row" : "rows"}
        </span>
      </div>
      {csvOpen && (
        <CsvImport
          onUse={(units, mode) => {
            setRows((rs) => (mode === "replace" ? units : [...rs.filter((r) => UNIT_COLUMNS.some((c) => r[c].trim())), ...units]))
            setCsvOpen(false)
          }}
        />
      )}
      <div className="coord-table-wrap">
        <table className="coord-table coord-units">
          <thead>
            <tr>
              <th className="num">#</th>
              {UNIT_COLUMNS.map((c) => (
                <th key={c} className={c === "registered" ? "num" : undefined}>
                  {HEADINGS[c]}
                </th>
              ))}
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="num muted">{i + 1}</td>
                {UNIT_COLUMNS.map((c) => {
                  const problem = problems.get(r.id)?.[c]
                  const shown = problem && (tried || problem !== "required") ? problem : undefined
                  return (
                    <td key={c} className={`col-${c}`}>
                      <input
                        className={`coord-in${c === "unitCode" ? " mono" : ""}${shown ? " is-invalid" : ""}`}
                        value={r[c]}
                        onChange={(e) => edit(r.id, c, e.target.value)}
                        placeholder={i === 0 ? PLACEHOLDERS[c] : undefined}
                        aria-label={`Row ${i + 1}, ${HEADINGS[c]}`}
                        aria-invalid={shown ? true : undefined}
                        title={shown}
                        inputMode={c === "registered" ? "numeric" : undefined}
                        disabled={disabled}
                      />
                      {shown && <small className="coord-cell-problem">{shown}</small>}
                    </td>
                  )
                })}
                <td>
                  <button type="button" className="coord-icon-btn" aria-label={`Remove row ${i + 1}`} title="Remove row" onClick={() => remove(r.id)} disabled={disabled}>
                    <Icon name="trash" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Synthetic data only: no real polling-unit names or codes. Blank rows are ignored.</p>
    </div>
  )
}

function CsvImport({ onUse }: { onUse: (units: UnitDraft[], mode: "replace" | "append") => void }) {
  const [text, setText] = useState("")
  const parsed = text.trim() ? unitsFromCsv(text) : undefined
  return (
    <div className="coord-csv">
      <label className="field">
        <span>CSV</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${CSV_HEADER}\nSS-RIV-01-001,Riverside Ward 01,Riverside,Sample State,800,"Unit 001, Community Hall"`} spellCheck={false} />
        <small>
          First line: <span className="mono">{CSV_HEADER}</span>. Quote a field that contains a comma.
        </small>
      </label>
      <div className="row">
        <label className="btn btn-small coord-file">
          Upload a .csv file
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) setText(await file.text())
              e.target.value = ""
            }}
          />
        </label>
        <button type="button" className="btn btn-small" disabled={!parsed || "error" in parsed} onClick={() => parsed && "units" in parsed && onUse(parsed.units, "replace")}>
          Replace the table
        </button>
        <button type="button" className="btn btn-small" disabled={!parsed || "error" in parsed} onClick={() => parsed && "units" in parsed && onUse(parsed.units, "append")}>
          Add to the table
        </button>
        {parsed && ("error" in parsed ? <span className="small coord-error-text">{parsed.error}</span> : <span className="muted">{parsed.units.length} rows read</span>)}
      </div>
    </div>
  )
}
