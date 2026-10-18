import { describeError, encodePanel, type Panel, type Row } from "collate-core"
import { useEffect, useState } from "react"
import { setupQuery } from "../model/panels"
import type { Party } from "../model/schema"
import { collate } from "./collate"
import { href } from "./router"

export const DEFAULT_PARTIES: Party[] = [
  { field: "votes_a", name: "Party A", short: "A" },
  { field: "votes_b", name: "Party B", short: "B" },
  { field: "votes_c", name: "Party C", short: "C" },
]

/** Readable names for Collate's attributes; other datasets fall back to collate-core's humanizeKey. */
export const ATTR_LABELS: Record<string, string> = {
  election: "Election",
  unit_code: "Unit",
  state: "State",
  lga: "LGA",
  ward: "Ward",
  registered: "Registered voters",
  accredited: "Accredited voters",
  rejected: "Rejected ballots",
  submitted_at: "Submitted",
  opens_at: "Opens",
  closes_at: "Closes",
  corrects: "Corrects entity",
  observer: "Observer wallet",
}

/** Where first, then the figures, then when: the order a person reads a polling-unit result in. */
export const ATTR_ORDER = ["state", "lga", "ward", "votes_a", "votes_b", "votes_c", "rejected", "accredited", "registered", "corrects", "submitted_at"]

export type ElectionInfo = {
  row: Row | undefined
  name: string
  parties: Party[]
  /** Agreeing observers the coordinator recommends per unit, from the election payload, if set. */
  quorum?: number
  units: Row[]
  loading: boolean
  error?: string
}

/** The creators a setup read covers: the chosen coordinator plus any others on the page, sorted. */
const scopeOf = (coordinator: string, also: readonly string[]) => [...new Set([coordinator, ...also].map((c) => c.toLowerCase()))].sort()

/**
 * Q1, Q2 and Q3 in one query: the election and its polling units as `coordinator` registered them,
 * read together with every coordinator in `also` and their accreditations. Tiramisu prices every
 * query the same (100 units) whatever it returns, so one broad read is cheaper than several narrow
 * ones; switching coordinator, and the results panel's trust list, are answered from it by
 * collate-core's session cache.
 */
export function useElection(election: string, coordinator: string, also: readonly string[] = []): ElectionInfo {
  const [info, setInfo] = useState<ElectionInfo>({ row: undefined, name: election, parties: DEFAULT_PARTIES, units: [], loading: true })
  const [attempt, setAttempt] = useState(0)
  const scope = scopeOf(coordinator, also).join(",")

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    setInfo((prev) => ({ ...prev, loading: true, error: undefined }))
    const mine = coordinator.toLowerCase()
    collate
      .fetchAll({ where: setupQuery(election), creators: scope.split(","), payload: true })
      .then(({ rows }) => {
        if (cancelled) return
        const own = rows.filter((r) => r.creator === mine)
        const row = own.find((r) => r.attrs.type === "election")
        const units = own.filter((r) => r.attrs.type === "unit")
        const payload = (row?.payload ?? {}) as { name?: string; parties?: Party[]; quorum?: unknown }
        setInfo({
          row,
          name: payload.name ?? election,
          parties: Array.isArray(payload.parties) && payload.parties.length ? payload.parties : DEFAULT_PARTIES,
          quorum: Number.isInteger(payload.quorum) && (payload.quorum as number) >= 1 ? (payload.quorum as number) : undefined,
          units,
          loading: false,
        })
      })
      .catch((error) => {
        if (cancelled) return
        const { message, retryAfterSeconds } = describeError(error)
        setInfo((prev) => ({ ...prev, loading: false, error: message }))
        // A spent read budget says when it resets: try once more then.
        if (retryAfterSeconds) retry = setTimeout(() => setAttempt((n) => n + 1), retryAfterSeconds * 1000)
      })
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [election, coordinator, scope, attempt])

  return info
}

/** Link to Studio with this panel loaded. */
export function exploreHref(panel: Panel): string {
  return href("/studio", { panel: encodePanel(panel) })
}

export function figures(row: Row, parties: Party[]): string {
  const votes = parties.map((p) => `${p.short} ${Number(row.attrs[p.field] ?? 0).toLocaleString("en")}`).join(" · ")
  return `${votes} · rejected ${row.attrs.rejected ?? 0}`
}

export function timeAgo(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
