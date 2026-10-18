/**
 * The Studio form's state and its two-way mapping to a collate-core panel config. The panel config
 * stays the contract: the form is one way to write it, the JSON editor is another, and anything the
 * form cannot show (nested and/or groups) is kept verbatim rather than dropped.
 */
import { createdByAny, eq, or, renderWhere, v, type Panel, type PanelState, type SelfRegistration, type TypedValue, type Where, type WhereValue } from "@collate/core"

/** `quorum` lands in core's Panel type in a parallel change; until then it rides along untyped. */
export type StudioPanel = Panel & { quorum?: number }

export type Op = "eq" | "gt" | "gte" | "lt" | "lte" | "startsWith"
export type ValueType = "str" | "u64" | "i32" | "bool" | "addr" | "key"

export const OPS: { op: Op; label: string; title: string }[] = [
  { op: "eq", label: "=", title: "equals" },
  { op: "gt", label: ">", title: "greater than" },
  { op: "gte", label: "≥", title: "at least" },
  { op: "lt", label: "<", title: "less than" },
  { op: "lte", label: "≤", title: "at most" },
  { op: "startsWith", label: "starts with", title: "text starts with" },
]
export const TYPES: ValueType[] = ["str", "u64", "i32", "bool", "addr", "key"]

export type Filter = { id: number; field: string; op: Op; value: string; type: ValueType }

export type Draft = {
  title: string
  /** "field is one of …": an OR of equalities on one attribute, e.g. type is unit_result or correction. */
  oneOf: { field: string; values: string[] }
  filters: Filter[]
  /** Only entities created by these wallets ($creator). */
  creators: string[]
  /** Predicates the form cannot show, kept as they are. */
  extra: Where[]
  /** `selfRegistration` is passed through untouched: set from JSON, not from the form. */
  trust: { roots: string[]; listFilters: Filter[]; listExtra: Where[]; addressField: string; labelField: string; selfRegistration?: SelfRegistration }
  includeIgnored: boolean
  groupBy: string
  sum: string[]
  view: "bar" | "table"
  live: boolean
  supersedeField: string
  disputeKey: string
  compareFields: string[]
  quorum: number | undefined
  /** Passed through untouched: set from JSON, not from the form. */
  labels?: Record<string, string>
  payload?: boolean
}

let nextId = 1
export const newFilter = (patch: Partial<Filter> = {}): Filter => ({ id: nextId++, field: "", op: "eq", value: "", type: "str", ...patch })

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/

// ---------- Panel → Draft ----------

function fromValue(value: WhereValue): { value: string; type: ValueType } {
  if (typeof value === "string") return { value, type: "str" }
  if (typeof value === "number") return { value: String(value), type: Number.isInteger(value) && value >= 0 ? "u64" : "i32" }
  if (typeof value === "boolean") return { value: String(value), type: "bool" }
  return { value: String(value.value), type: value.type }
}

const isCreatorEq = (w: Where): boolean =>
  w.op === "eq" && w.field === "$creator" && typeof w.value === "object" && w.value.type === "addr"

const creatorOf = (w: Where) => String((w as { value: TypedValue }).value.value)

function parseQuery(query: Where[], withHelpers: boolean) {
  const filters: Filter[] = []
  const extra: Where[] = []
  let oneOf: Draft["oneOf"] = { field: "", values: [] }
  let creators: string[] = []
  for (const w of query) {
    if (withHelpers && !creators.length && isCreatorEq(w)) {
      creators = [creatorOf(w)]
    } else if (withHelpers && !creators.length && w.op === "or" && w.any.length > 0 && w.any.every(isCreatorEq)) {
      creators = w.any.map(creatorOf)
    } else if (
      withHelpers &&
      !oneOf.field &&
      w.op === "or" &&
      w.any.length > 0 &&
      w.any.every((c) => c.op === "eq" && typeof c.value === "string" && c.field === (w.any[0] as { field: string }).field)
    ) {
      oneOf = { field: (w.any[0] as { field: string }).field, values: w.any.map((c) => String((c as { value: string }).value)) }
    } else if (w.op === "startsWith") {
      filters.push(newFilter({ field: w.field, op: "startsWith", value: w.value, type: "str" }))
    } else if (w.op === "or" || w.op === "and") {
      extra.push(w)
    } else {
      filters.push(newFilter({ field: w.field, op: w.op, ...fromValue(w.value) }))
    }
  }
  return { filters, extra, oneOf, creators }
}

export function panelToDraft(panel: StudioPanel): Draft {
  const q = parseQuery(panel.query, true)
  const list = parseQuery(panel.trust?.listQuery ?? [], false)
  return {
    title: panel.title,
    oneOf: q.oneOf,
    filters: q.filters,
    creators: q.creators,
    extra: q.extra,
    trust: {
      roots: panel.trust?.rootCreators.map(String) ?? [],
      listFilters: list.filters,
      listExtra: list.extra,
      addressField: panel.trust?.addressField ?? "",
      labelField: panel.trust?.labelField ?? "",
      selfRegistration: panel.trust?.selfRegistration,
    },
    includeIgnored: panel.includeIgnored ?? false,
    groupBy: panel.groupBy ?? "",
    sum: panel.sum ?? [],
    view: panel.view,
    live: panel.live ?? false,
    supersedeField: panel.supersedeField ?? "",
    disputeKey: panel.disputeKey ?? "",
    compareFields: panel.compareFields ?? [],
    quorum: panel.quorum,
    labels: panel.labels,
    payload: panel.payload,
  }
}

// ---------- Draft → Panel ----------

/** Checks one filter's value against its type; returns a message, or undefined when it is fine. */
export function filterProblem(f: Filter): string | undefined {
  if (!f.field.trim()) return f.value.trim() ? "Pick an attribute" : undefined
  const value = f.value.trim()
  if (f.op === "startsWith") return f.type === "str" ? undefined : "starts with works on text (str) only"
  if (f.op !== "eq" && (f.type === "str" || f.type === "bool" || f.type === "addr" || f.type === "key")) return `${f.type} values only support =`
  switch (f.type) {
    case "u64":
      return /^\d+$/.test(value) ? undefined : "u64 needs a whole number ≥ 0"
    case "i32":
      return /^-?\d+$/.test(value) && Math.abs(Number(value)) < 2 ** 31 ? undefined : "i32 needs a whole number"
    case "bool":
      return value === "true" || value === "false" ? undefined : "bool is true or false"
    case "addr":
      return ADDRESS.test(value) ? undefined : "addr needs a 0x… 40-hex-digit address"
    case "key":
      return /^0x[0-9a-fA-F]{64}$/.test(value) ? undefined : "key needs a 0x… 64-hex-digit entity key"
    default:
      return undefined
  }
}

function toWhere(f: Filter): Where {
  const value = f.value.trim()
  const field = f.field.trim()
  if (f.op === "startsWith") return { op: "startsWith", field, value }
  let typed: WhereValue
  switch (f.type) {
    case "u64":
      typed = Number.isSafeInteger(Number(value)) ? Number(value) : v.u64(value)
      break
    case "i32":
      typed = v.i32(Number(value))
      break
    case "bool":
      typed = value === "true"
      break
    case "addr":
      typed = v.addr(value.toLowerCase())
      break
    case "key":
      typed = v.key(value.toLowerCase())
      break
    default:
      typed = value
  }
  return { op: f.op, field, value: typed }
}

const filled = (f: Filter) => f.field.trim() !== ""
const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean)

/** Builds the panel config, or throws with a message the form can show. */
export function draftToPanel(d: Draft): StudioPanel {
  for (const f of [...d.filters, ...d.trust.listFilters].filter(filled)) {
    const problem = filterProblem(f)
    if (problem) throw new Error(`${f.field}: ${problem}`)
  }
  const query: Where[] = []
  const values = clean(d.oneOf.values)
  if (d.oneOf.field.trim() && values.length) {
    const field = d.oneOf.field.trim()
    query.push(values.length === 1 ? eq(field, values[0]!) : or(...values.map((x) => eq(field, x))))
  }
  query.push(...d.filters.filter(filled).map(toWhere))
  const creators = clean(d.creators)
  for (const c of creators) if (!ADDRESS.test(c)) throw new Error(`Creator ${c} is not a 0x… address`)
  if (creators.length) query.push(createdByAny(creators.map((c) => c.toLowerCase())))
  query.push(...d.extra)
  if (query.length === 0) throw new Error("Add at least one filter. Arkiv queries need a predicate, e.g. type = something.")

  // Built up in a fixed key order (view is set below), so equal configs serialise identically.
  const panel = { title: d.title.trim() || "Untitled panel", query } as StudioPanel

  const roots = clean(d.trust.roots)
  if (roots.length) {
    for (const r of roots) if (!ADDRESS.test(r)) throw new Error(`Trusted root ${r} is not a 0x… address`)
    const listQuery = [...d.trust.listFilters.filter(filled).map(toWhere), ...d.trust.listExtra]
    if (!listQuery.length) throw new Error("Trust: add a filter for the list entities, e.g. type = accreditation")
    if (!d.trust.addressField.trim()) throw new Error("Trust: name the attribute that holds each vouched-for wallet")
    panel.trust = {
      rootCreators: roots.map((r) => r.toLowerCase() as `0x${string}`),
      listQuery,
      addressField: d.trust.addressField.trim(),
      ...(d.trust.labelField.trim() ? { labelField: d.trust.labelField.trim() } : {}),
      ...(d.trust.selfRegistration ? { selfRegistration: d.trust.selfRegistration } : {}),
    }
  }
  if (d.supersedeField.trim()) panel.supersedeField = d.supersedeField.trim()
  if (d.disputeKey.trim()) {
    panel.disputeKey = d.disputeKey.trim()
    const compare = clean(d.compareFields)
    if (compare.length) panel.compareFields = compare
    if (d.quorum !== undefined && d.quorum > 1) panel.quorum = d.quorum
  }
  if (d.groupBy.trim()) panel.groupBy = d.groupBy.trim()
  const sum = clean(d.sum)
  if (sum.length) panel.sum = sum
  panel.view = d.view
  if (d.live) panel.live = true
  if (d.includeIgnored && panel.trust) panel.includeIgnored = true
  if (d.payload) panel.payload = true
  if (d.labels && Object.keys(d.labels).length) panel.labels = d.labels
  renderWhere(panel.query) // throws on anything the SDK would refuse, before any request
  return panel
}

/** Puts a config into the form's canonical shape, so equal configs compare equal as JSON. */
export const normalize = (panel: StudioPanel): StudioPanel => draftToPanel(panelToDraft(panel))

// ---------- Suggestions from returned rows ----------

export type FieldInfo = { name: string; numeric: boolean; values: string[] }

/** Attribute names (and a few distinct values) seen in the last result, for the form's suggestions. */
export function fieldsFrom(state: PanelState | undefined): FieldInfo[] {
  if (!state) return []
  const seen = new Map<string, { numeric: boolean; values: Set<string> }>()
  for (const row of [...state.rows, ...state.ignored]) {
    for (const [name, value] of Object.entries(row.attrs)) {
      const info = seen.get(name) ?? { numeric: true, values: new Set<string>() }
      if (typeof value !== "number") info.numeric = false
      if (info.values.size < 40) info.values.add(String(value))
      seen.set(name, info)
    }
  }
  return [...seen]
    .map(([name, info]) => ({ name, numeric: info.numeric, values: [...info.values].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A filter type guessed from what the attribute held in the last result. */
export function guessType(field: string, fields: FieldInfo[]): ValueType {
  if (field === "$creator" || field === "$owner") return "addr"
  if (field === "$key") return "key"
  const info = fields.find((f) => f.name === field)
  if (!info) return "str"
  if (info.numeric) return "u64"
  if (info.values.every((x) => x === "true" || x === "false")) return "bool"
  return "str"
}
