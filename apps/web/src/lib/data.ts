import { describeError, encodePanel, eq, type Panel, type Row } from "@collate/core"
import { useEffect, useState } from "react"
import type { Party } from "../model/schema"
import { collate } from "./collate"
import { href } from "./router"

export const DEFAULT_PARTIES: Party[] = [
  { field: "votes_a", name: "Party A", short: "A" },
  { field: "votes_b", name: "Party B", short: "B" },
  { field: "votes_c", name: "Party C", short: "C" },
]

export type ElectionInfo = {
  row: Row | undefined
  name: string
  parties: Party[]
  units: Row[]
  loading: boolean
  error?: string
}

/**
 * Q1 and Q2: the election and its polling units, as the chosen coordinator registered them. Unit
 * payloads (display names) are fetched only when asked for, since every byte read is metered.
 */
export function useElection(election: string, coordinator: string, unitNames = false): ElectionInfo {
  const [info, setInfo] = useState<ElectionInfo>({ row: undefined, name: election, parties: DEFAULT_PARTIES, units: [], loading: true })

  useEffect(() => {
    let cancelled = false
    setInfo((prev) => ({ ...prev, loading: true, error: undefined }))
    Promise.all([
      collate.fetchAll({ where: [eq("type", "election"), eq("election", election)], creators: [coordinator], payload: true }),
      collate.fetchAll({ where: [eq("type", "unit"), eq("election", election)], creators: [coordinator], payload: unitNames }),
    ])
      .then(([e, u]) => {
        if (cancelled) return
        const row = e.rows[0]
        const payload = (row?.payload ?? {}) as { name?: string; parties?: Party[] }
        setInfo({
          row,
          name: payload.name ?? election,
          parties: Array.isArray(payload.parties) && payload.parties.length ? payload.parties : DEFAULT_PARTIES,
          units: u.rows,
          loading: false,
        })
      })
      .catch((error) => !cancelled && setInfo((prev) => ({ ...prev, loading: false, error: describeError(error).message })))
    return () => {
      cancelled = true
    }
  }, [election, coordinator, unitNames])

  return info
}

/** Link to the general collate-core page with this panel loaded. */
export function exploreHref(panel: Panel): string {
  return href("/explore", { panel: encodePanel(panel) })
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
