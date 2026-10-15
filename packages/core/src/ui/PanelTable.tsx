import type { AggRow, Row } from "../types"
import { formatNumber } from "./format"

export type Column = { field: string; label: string }

/** Aggregated groups as a table: the accessible view of every chart, and a panel view of its own. */
export function GroupTable({
  groups,
  total,
  columns,
  groupLabel,
  onSelect,
}: {
  groups: AggRow[]
  total?: AggRow
  columns: Column[]
  groupLabel: string
  onSelect?: (group: AggRow) => void
}) {
  return (
    <div className="collate-table-wrap">
      <table className="collate-table">
        <thead>
          <tr>
            <th scope="col">{groupLabel}</th>
            <th scope="col" className="collate-num">Units</th>
            {columns.map((c) => (
              <th key={c.field} scope="col" className="collate-num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.group} className={onSelect ? "collate-clickable" : undefined} onClick={() => onSelect?.(g)}>
              <th scope="row">{g.group}</th>
              <td className="collate-num">{g.count}</td>
              {columns.map((c) => (
                <td key={c.field} className="collate-num">
                  {formatNumber(g.sums[c.field] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className={onSelect ? "collate-clickable" : undefined} onClick={() => onSelect?.(total)}>
              <th scope="row">Total</th>
              <td className="collate-num">{total.count}</td>
              {columns.map((c) => (
                <td key={c.field} className="collate-num">
                  {formatNumber(total.sums[c.field] ?? 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Raw entities as a table, one row each, newest first by block. */
export function RowTable({
  rows,
  columns,
  label,
  onSelect,
  empty = "Nothing yet.",
}: {
  rows: Row[]
  columns: Column[]
  label: (row: Row) => string
  onSelect?: (row: Row) => void
  empty?: string
}) {
  if (rows.length === 0) return <p className="collate-muted">{empty}</p>
  const sorted = [...rows].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1))
  return (
    <div className="collate-table-wrap">
      <table className="collate-table">
        <thead>
          <tr>
            <th scope="col">Entity</th>
            {columns.map((c) => (
              <th key={c.field} scope="col" className="collate-num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className={onSelect ? "collate-clickable" : undefined} onClick={() => onSelect?.(r)}>
              <th scope="row">{label(r)}</th>
              {columns.map((c) => {
                const value = r.attrs[c.field]
                return (
                  <td key={c.field} className="collate-num">
                    {typeof value === "number" ? formatNumber(value) : String(value ?? "—")}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
