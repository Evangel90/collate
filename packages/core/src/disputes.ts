import { later } from "./supersede"
import type { Dispute, Row } from "./types"

/**
 * Groups rows by `key`, keeps the latest row from each source, and flags groups where sources
 * disagree on any compared field. Agreeing groups contribute one row to `resolved`; disputed groups
 * contribute none, so a disagreement is shown, never silently counted.
 */
export function findDisputes(
  rows: Row[],
  key: string,
  compareFields: string[],
): { resolved: Row[]; disputes: Dispute[] } {
  const groups = new Map<string, Map<string, Row>>()
  const unkeyed: Row[] = []
  for (const row of rows) {
    const k = row.attrs[key]
    if (k === undefined) {
      unkeyed.push(row)
      continue
    }
    const bySource = groups.get(String(k)) ?? new Map<string, Row>()
    const prior = bySource.get(row.creator)
    if (!prior || later(row, prior)) bySource.set(row.creator, row)
    groups.set(String(k), bySource)
  }

  const resolved: Row[] = [...unkeyed]
  const disputes: Dispute[] = []
  for (const [k, bySource] of groups) {
    const entries = [...bySource.values()].sort((a, b) => (later(a, b) ? 1 : -1))
    const signatures = new Set(entries.map((r) => signature(r, compareFields)))
    if (signatures.size > 1) disputes.push({ key: k, entries })
    else resolved.push(entries[0]!)
  }
  disputes.sort((a, b) => a.key.localeCompare(b.key))
  return { resolved, disputes }
}

function signature(row: Row, fields: string[]): string {
  return fields.map((f) => String(row.attrs[f] ?? "")).join("|")
}
