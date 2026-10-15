import { field, num } from "./rows"
import type { AggRow, Row } from "./types"

export type AggregateOptions = {
  groupBy?: string
  sum?: string[]
  /** Sort by a summed field, `"count"` or `"group"` (default). */
  sortBy?: string
  desc?: boolean
}

/**
 * Group-by, sum, count, min and max in the browser. Arkiv has no server-side aggregation or
 * ordering, so every viewer recomputes totals from the raw entities.
 */
export function aggregate(rows: Row[], options: AggregateOptions = {}): { groups: AggRow[]; total: AggRow } {
  const fields = options.sum ?? []
  const total = emptyAgg("Total", fields)
  const byGroup = new Map<string, AggRow>()

  for (const row of rows) {
    add(total, row, fields)
    if (options.groupBy) {
      const g = String(field(row, options.groupBy) ?? "—")
      const agg = byGroup.get(g) ?? emptyAgg(g, fields)
      add(agg, row, fields)
      byGroup.set(g, agg)
    }
  }

  const groups = [...byGroup.values()]
  const sortBy = options.sortBy ?? "group"
  const dir = options.desc ? -1 : 1
  groups.sort((a, b) => {
    if (sortBy === "group") return dir * a.group.localeCompare(b.group, undefined, { numeric: true })
    const av = sortBy === "count" ? a.count : (a.sums[sortBy] ?? 0)
    const bv = sortBy === "count" ? b.count : (b.sums[sortBy] ?? 0)
    return dir * (av - bv) || a.group.localeCompare(b.group)
  })
  return { groups, total }
}

function emptyAgg(group: string, fields: string[]): AggRow {
  const zero = () => Object.fromEntries(fields.map((f) => [f, 0]))
  return { group, count: 0, sums: zero(), min: {}, max: {}, keys: [] }
}

function add(agg: AggRow, row: Row, fields: string[]) {
  agg.count += 1
  agg.keys.push(row.key)
  for (const f of fields) {
    const value = num(row, f)
    agg.sums[f] = (agg.sums[f] ?? 0) + value
    agg.min[f] = Math.min(agg.min[f] ?? value, value)
    agg.max[f] = Math.max(agg.max[f] ?? value, value)
  }
}
