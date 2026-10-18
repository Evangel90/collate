import type { AttrValue } from "../types"
import { formatAttr, humanizeKey } from "./format"

export type AttrListProps = {
  attrs: Record<string, AttrValue>
  /** Human labels for attribute names, e.g. `{ votes_a: "Unity Party" }`. */
  labels?: Record<string, string>
  /** Attributes not to list, e.g. the one already shown as the row's title. */
  hide?: string[]
  /** Attributes to list first, in this order; the rest follow, text before numbers. */
  order?: string[]
}

/**
 * An entity's attributes as a labelled grid: text attributes (where, who) first, then numbers.
 * Values are formatted for reading; the raw value stays in the tooltip.
 */
export function AttrList({ attrs, labels = {}, hide = [], order = [] }: AttrListProps) {
  const entries = Object.entries(attrs).filter(([k]) => !hide.includes(k))
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length)
  const rest = entries.filter(([k]) => !order.includes(k))
  const ordered = [
    ...entries.filter(([k]) => order.includes(k)).sort(([a], [b]) => rank(a) - rank(b)),
    ...rest.filter(([, v]) => typeof v !== "number"),
    ...rest.filter(([, v]) => typeof v === "number"),
  ]
  return (
    <dl className="collate-attrs">
      {ordered.map(([k, v]) => (
        <div key={k} className="collate-attr">
          <dt>{labels[k] ?? humanizeKey(k)}</dt>
          <dd title={`${k} = ${String(v)}`}>{formatAttr(k, v)}</dd>
        </div>
      ))}
    </dl>
  )
}
