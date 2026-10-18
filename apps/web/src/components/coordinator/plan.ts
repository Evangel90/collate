/**
 * Pure helpers behind the coordinator console: election ids, the polling-unit editor and its CSV,
 * observer lists, and the chunk-and-resume plan for creating an election's setup. Nothing here
 * reads or writes Arkiv, so all of it is unit-tested in plan.test.ts.
 */
import { EntityMutationError } from "@arkiv-network/sdk"
import type { Row } from "collate-core"
import { isAddress } from "viem"
import type { UnitInput } from "../../model/schema"

/** Creates per transaction once a single batch has been refused (friction #11; seed.ts uses the same). */
export const CHUNK_SIZE = 15

/* ---------- Election ids ---------- */

/** Lowercase letters, digits and single hyphens, 3 to 64 characters. */
export const ELECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugify(name: string, max = 40): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "")
}

/** Four base-36 characters: enough that two coordinators naming an election alike rarely collide. */
export function randomSuffix(length = 4): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("")
}

/** `"Ward 3 by-election"` → `"ward-3-by-election-k2x9"`. */
export function electionIdFor(name: string, suffix: string): string {
  return `${slugify(name) || "election"}-${suffix}`
}

export function checkElectionId(id: string, taken: ReadonlySet<string>): string | undefined {
  if (id.length < 3 || id.length > 64) return "Use 3 to 64 characters."
  if (!ELECTION_ID.test(id)) return "Use lowercase letters, digits and single hyphens only."
  if (taken.has(id)) return "You already have an election with this id. Open it from your list instead."
  return undefined
}

/** Short party label for tables: initials of a multi-word name, else the first three letters. */
export function partyShort(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase()
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 4)
    .toUpperCase()
}

/* ---------- Polling units: editor rows, CSV, validation ---------- */

export const UNIT_COLUMNS = ["unitCode", "ward", "lga", "state", "registered", "name"] as const
export type UnitColumn = (typeof UNIT_COLUMNS)[number]
export const CSV_HEADER = "unit_code,ward,lga,state,registered,name"

/** One editor row, every cell as typed. `id` keeps React keys stable while rows move. */
export type UnitDraft = { id: number } & Record<UnitColumn, string>

let nextId = 1
export function emptyUnit(from?: Partial<UnitDraft>): UnitDraft {
  return { id: nextId++, unitCode: "", ward: from?.ward ?? "", lga: from?.lga ?? "", state: from?.state ?? "", registered: "", name: "" }
}

const isBlank = (d: UnitDraft) => UNIT_COLUMNS.every((c) => d[c].trim() === "")

/** CSV rows: commas, CRLF, quoted fields with "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true
      cell = ""
    } else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += ch
  }
  if (cell !== "" || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""))
}

/**
 * Editor rows from CSV with the header `unit_code,ward,lga,state,registered,name`. Extra cells on a
 * line are joined back into the name, so an unquoted "Unit 001, Town Hall" still reads as one name.
 */
export function unitsFromCsv(text: string): { units: UnitDraft[] } | { error: string } {
  const [header, ...lines] = parseCsv(text.replace(/^﻿/, ""))
  if (!header || header.map((h) => h.toLowerCase()).join(",") !== CSV_HEADER) return { error: `The first line must be: ${CSV_HEADER}` }
  if (lines.length === 0) return { error: "The CSV has a header but no units." }
  const units = lines.map(([unitCode = "", ward = "", lga = "", state = "", registered = "", ...name]) => ({
    ...emptyUnit(),
    unitCode,
    ward,
    lga,
    state,
    registered,
    name: name.join(", "),
  }))
  return { units }
}

export type UnitProblems = Map<number, Partial<Record<UnitColumn, string>>>
export type UnitCheck = {
  /** Valid units, in table order; complete only when `problems` is empty. */
  units: UnitInput[]
  problems: UnitProblems
  /** One line per problem, "Row 3, unit code: …", in table order. */
  messages: string[]
}

const LABEL: Record<UnitColumn, string> = { unitCode: "unit code", ward: "ward", lga: "LGA", state: "state", registered: "registered voters", name: "name" }

/**
 * Checks the editor rows. Fully blank rows are ignored; every other cell except the name is
 * required; codes must be unique in the table and not already registered for this election.
 */
export function checkUnits(drafts: UnitDraft[], election: string, existing: ReadonlySet<string> = new Set()): UnitCheck {
  const problems: UnitProblems = new Map()
  const messages: string[] = []
  const units: UnitInput[] = []
  const firstRow = new Map<string, number>()
  const flag = (d: UnitDraft, row: number, column: UnitColumn, text: string) => {
    problems.set(d.id, { ...problems.get(d.id), [column]: text })
    messages.push(`Row ${row}, ${LABEL[column]}: ${text}`)
  }
  drafts.forEach((d, i) => {
    if (isBlank(d)) return
    const row = i + 1
    const code = d.unitCode.trim()
    for (const column of ["unitCode", "ward", "lga", "state"] as const) if (!d[column].trim()) flag(d, row, column, "required")
    if (code && code.length > 64) flag(d, row, "unitCode", "64 characters at most")
    else if (code && existing.has(code)) flag(d, row, "unitCode", "already registered for this election")
    else if (code && firstRow.has(code)) flag(d, row, "unitCode", `same code as row ${firstRow.get(code)}`)
    if (code && !firstRow.has(code)) firstRow.set(code, row)
    const registered = d.registered.trim()
    const n = Number(registered)
    if (!registered) flag(d, row, "registered", "required")
    else if (!/^\d+$/.test(registered) || !Number.isSafeInteger(n)) flag(d, row, "registered", "a whole number, 0 or more")
    if (!problems.has(d.id)) {
      units.push({ election, unitCode: code, ward: d.ward.trim(), lga: d.lga.trim(), state: d.state.trim(), registered: n, name: d.name.trim() || code })
    }
  })
  return { units, problems, messages }
}

const SAMPLE_PLACES = [
  { state: "Sample State", lga: "Riverside", short: "RIV" },
  { state: "Sample State", lga: "Hillview", short: "HIL" },
]
const SAMPLE_SITES = ["Community Hall", "Primary School", "Market Square", "Civic Centre", "Health Post", "Town Hall"]

/**
 * Synthetic units, clearly fictional (Sample State, Riverside and Hillview LGAs), numbered past any
 * code in `taken` so a second fill does not clash.
 */
export function sampleUnits(count = 6, taken: ReadonlySet<string> = new Set()): UnitDraft[] {
  const out: UnitDraft[] = []
  for (let n = 1; out.length < count && n < 1000; n++) {
    const place = SAMPLE_PLACES[(n - 1) % SAMPLE_PLACES.length]!
    const ward = String(Math.ceil(n / 4)).padStart(2, "0")
    const num = String(n).padStart(3, "0")
    const unitCode = `SS-${place.short}-${ward}-${num}`
    if (taken.has(unitCode)) continue
    out.push({
      ...emptyUnit(),
      unitCode,
      ward: `${place.lga} Ward ${ward}`,
      lga: place.lga,
      state: place.state,
      registered: String(500 + ((n * 137) % 400)),
      name: `Unit ${num}, ${SAMPLE_SITES[(n - 1) % SAMPLE_SITES.length]}`,
    })
  }
  return out
}

/* ---------- Observers ---------- */

export type ObserverDraft = { address: string; alias: string }
export type ObserverCheck = { observers: ObserverDraft[]; messages: string[] }

/**
 * Lines of `address, alias` (alias optional: "Observer N" is suggested from `startAt`). Addresses
 * already accredited, or repeated, are reported rather than sent twice.
 */
export function parseObservers(text: string, accredited: ReadonlySet<string>, startAt = 1): ObserverCheck {
  const observers: ObserverDraft[] = []
  const messages: string[] = []
  const seen = new Set<string>()
  let next = startAt
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const [rawAddress = "", ...rest] = line.split(/[,;\t]/)
    const address = rawAddress.trim()
    const alias = rest.join(",").trim() || `Observer ${String(next).padStart(2, "0")}`
    const problem = checkObserver(address, alias, accredited) ?? (seen.has(address.toLowerCase()) ? "listed twice" : undefined)
    if (problem) return void messages.push(`Line ${i + 1}: ${problem}`)
    seen.add(address.toLowerCase())
    observers.push({ address, alias })
    next++
  })
  return { observers, messages }
}

export function checkObserver(address: string, alias: string, accredited: ReadonlySet<string>): string | undefined {
  if (!isAddress(address)) return `"${address.slice(0, 14)}${address.length > 14 ? "…" : ""}" is not a wallet address (0x and 40 hex characters; check the checksum if it is mixed-case)`
  if (accredited.has(address.toLowerCase())) return "already accredited"
  if (!alias.trim()) return "add an alias"
  if (alias.trim().length > 40) return "alias is longer than 40 characters"
  return undefined
}

/* ---------- Creating an election's setup in batches ---------- */

/** What the coordinator's wallet already has on Arkiv for one election. */
export type Existing = { election: boolean; unitCodes: ReadonlySet<string> }

export function existingFrom(rows: readonly Row[]): Existing {
  return {
    election: rows.some((r) => r.attrs.type === "election"),
    unitCodes: new Set(rows.filter((r) => r.attrs.type === "unit").map((r) => String(r.attrs.unit_code))),
  }
}

/** The creates still needed: the election if it is missing, and every unit whose code is missing. */
export type SetupPlan = { election: boolean; units: UnitInput[] }

export function remaining(intended: SetupPlan, existing: Existing): SetupPlan {
  return {
    election: intended.election && !existing.election,
    units: intended.units.filter((u) => !existing.unitCodes.has(u.unitCode)),
  }
}

export const planSize = (plan: SetupPlan) => (plan.election ? 1 : 0) + plan.units.length

/**
 * Splits a plan into atomic batches of at most `size` creates. The election rides in the first
 * batch, so any batch that lands implies the election exists, and a resume only ever adds units.
 */
export function toBatches(plan: SetupPlan, size = CHUNK_SIZE): SetupPlan[] {
  const out: SetupPlan[] = []
  let units = plan.units
  let election = plan.election
  while (election || units.length) {
    const take = size - (election ? 1 : 0)
    out.push({ election, units: units.slice(0, take) })
    units = units.slice(take)
    election = false
  }
  return out
}

/** After `done` landed, the existing state as if re-read; avoids a query between batches. */
export function withLanded(existing: Existing, done: SetupPlan): Existing {
  return { election: existing.election || done.election, unitCodes: new Set([...existing.unitCodes, ...done.units.map((u) => u.unitCode)]) }
}

/**
 * What a failed write means for what to do next:
 * - `rejected`: the wallet declined; nothing was sent.
 * - `refused`: the chain or wallet refused it before it was mined, or it reverted; nothing applied.
 *   Re-read before sending anything else anyway.
 * - `applied`: the SDK says the transaction succeeded but could not match its events. Do not resend.
 * - `unknown`: a transaction was sent and its outcome is not known. Never resend it: check the
 *   explorer, then re-read and continue from what exists.
 */
export type WriteOutcome = { kind: "rejected" | "refused" | "applied" | "unknown"; txHash?: string }

export function classifyWriteError(error: unknown): WriteOutcome {
  for (let e = error as { code?: number; cause?: unknown } | undefined, depth = 0; e && depth < 12; e = e.cause as typeof e, depth++) {
    if (e.code === 4001) return { kind: "rejected" }
  }
  // The SDK raises this after a successful transaction, sometimes without a hash: never resend.
  if (error instanceof EntityMutationError && /succeeded/.test(error.message) && /do not retry/.test(error.message)) {
    return { kind: "applied", txHash: error.txHash }
  }
  if (error instanceof EntityMutationError && error.txHash) {
    const txHash = error.txHash
    if (/reverted/.test(error.message)) return { kind: "refused", txHash }
    return { kind: "unknown", txHash }
  }
  return { kind: "refused" }
}

/* ---------- The new-election form ---------- */

export type Draft = {
  name: string
  description: string
  /** `YYYY-MM-DD`; counting closes at the end of that day, local time. */
  closes: string
  quorum: number
  parties: [string, string, string]
  /** Random part of the generated id, fixed for the life of the draft. */
  suffix: string
  /** Set when the coordinator edits the id, and frozen at the first create so a resume reuses it. */
  customId?: string
  /** True once a create was sent: the id no longer changes and the draft is matched against Arkiv. */
  frozen?: boolean
  units: UnitDraft[]
}

export const draftId = (d: Draft) => d.customId ?? electionIdFor(d.name, d.suffix)

/** Unix seconds at 23:59:59 local time on `date`, or NaN. */
export function endOfDay(date: string): number {
  return Math.floor(new Date(`${date}T23:59:59`).getTime() / 1000)
}

/** Problems with the election fields, as "Field: problem", in form order. */
export function checkDraft(d: Draft, taken: ReadonlySet<string>, now = Date.now() / 1000): string[] {
  const out: string[] = []
  if (!d.name.trim()) out.push("Name: required")
  else if (d.name.trim().length > 120) out.push("Name: 120 characters at most")
  if (d.description.length > 500) out.push("Description: 500 characters at most")
  const closes = endOfDay(d.closes)
  if (!Number.isFinite(closes)) out.push("Counting closes: pick a date")
  else if (closes <= now) out.push("Counting closes: pick a date after today")
  if (!Number.isInteger(d.quorum) || d.quorum < 1 || d.quorum > 9) out.push("Quorum: a whole number from 1 to 9")
  const names = d.parties.map((p) => p.trim())
  if (names.some((p) => !p)) out.push("Parties: name all three slots")
  else if (new Set(names.map((p) => p.toLowerCase())).size < 3) out.push("Parties: use three different names")
  else if (names.some((p) => p.length > 40)) out.push("Parties: 40 characters at most per name")
  const idProblem = checkElectionId(draftId(d), taken)
  if (idProblem) out.push(`Election id: ${idProblem}`)
  return out
}
