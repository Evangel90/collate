import { useEffect, useId, useState, type ReactNode } from "react"
import { OPS, TYPES, filterProblem, guessType, newFilter, type FieldInfo, type Filter, type Op, type ValueType } from "./model"

/** Copies text and says so for a moment. Falls back to selecting nothing when the clipboard is blocked. */
export function CopyButton({ text, label = "Copy", className = "btn btn-small" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle")
  useEffect(() => {
    if (state === "idle") return
    const t = setTimeout(() => setState("idle"), 1600)
    return () => clearTimeout(t)
  }, [state])
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setState("done"),
          () => setState("failed"),
        ) ?? setState("failed")
      }}
    >
      <span aria-live="polite">{state === "done" ? "Copied" : state === "failed" ? "Copy blocked" : label}</span>
    </button>
  )
}

/** An on/off switch with a label and an optional hint underneath. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`studio-toggle${disabled ? " is-disabled" : ""}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="studio-switch" aria-hidden="true" />
      <span className="studio-toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

/** Shared <datalist> of attribute names, so every field input offers what the last run returned. */
export function FieldList({ id, fields, system = false, numericOnly = false }: { id: string; fields: FieldInfo[]; system?: boolean; numericOnly?: boolean }) {
  return (
    <datalist id={id}>
      {fields.filter((f) => !numericOnly || f.numeric).map((f) => (
        <option key={f.name} value={f.name} />
      ))}
      {system && ["$creator", "$owner"].map((s) => <option key={s} value={s} />)}
    </datalist>
  )
}

/**
 * A list of short strings (field names, values, addresses) as removable chips, with a text box to
 * add more and one-click suggestions.
 */
export function ChipInput({
  values,
  onChange,
  placeholder,
  suggestions = [],
  label,
  listId,
  mono,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  suggestions?: string[]
  label: string
  listId?: string
  mono?: boolean
}) {
  const [text, setText] = useState("")
  const add = (raw: string) => {
    const parts = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    const next = [...values]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setText("")
  }
  const open = suggestions.filter((s) => !values.includes(s)).slice(0, 12)
  return (
    <div className="studio-chips">
      <div className={`studio-chip-box${mono ? " mono" : ""}`}>
        {values.map((v) => (
          <span key={v} className="studio-chip">
            <span className="studio-chip-text">{v}</span>
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          value={text}
          list={listId}
          placeholder={values.length ? "" : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && text.trim()) {
              e.preventDefault()
              add(text)
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {open.length > 0 && (
        <div className="studio-suggest" aria-label={`Suggestions for ${label}`}>
          {open.map((s) => (
            <button key={s} type="button" onClick={() => onChange([...values, s])}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Rows of attribute / operator / value / type, all of which must hold (AND). */
export function FilterRows({
  filters,
  onChange,
  fields,
  addLabel = "Add filter",
}: {
  filters: Filter[]
  onChange: (filters: Filter[]) => void
  fields: FieldInfo[]
  addLabel?: string
}) {
  const id = useId()
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="studio-filters">
      {filters.map((f, i) => {
        const problem = filterProblem(f)
        const values = fields.find((x) => x.name === f.field)?.values ?? []
        return (
          <div key={f.id} className="studio-filter">
            {i > 0 && <span className="studio-and" aria-hidden="true">and</span>}
            <div className="studio-filter-row">
              <input
                className="studio-in mono"
                aria-label="Attribute"
                placeholder="attribute"
                list={`${id}-fields`}
                value={f.field}
                onChange={(e) => {
                  const field = e.target.value
                  const known = fields.some((x) => x.name === field) || field.startsWith("$")
                  set(i, known ? { field, type: guessType(field, fields) } : { field })
                }}
              />
              <select className="studio-in studio-op" aria-label="Operator" value={f.op} onChange={(e) => set(i, { op: e.target.value as Op })}>
                {OPS.map((o) => (
                  <option key={o.op} value={o.op} title={o.title}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className={`studio-in mono${problem ? " is-invalid" : ""}`}
                aria-label="Value"
                aria-invalid={problem ? true : undefined}
                placeholder="value"
                list={values.length ? `${id}-v${f.id}` : undefined}
                value={f.value}
                onChange={(e) => set(i, { value: e.target.value })}
              />
              {values.length > 0 && (
                <datalist id={`${id}-v${f.id}`}>
                  {values.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              )}
              <select className="studio-in studio-type" aria-label="Value type" value={f.type} onChange={(e) => set(i, { type: e.target.value as ValueType })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button type="button" className="studio-icon-btn" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
            {problem && <small className="studio-problem">{problem}</small>}
          </div>
        )
      })}
      <FieldList id={`${id}-fields`} fields={fields} system />
      <button type="button" className="link-btn studio-add" onClick={() => onChange([...filters, newFilter()])}>
        + {addLabel}
      </button>
    </div>
  )
}
