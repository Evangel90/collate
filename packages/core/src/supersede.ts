import type { Row, SupersedeLink } from "./types.js"

/**
 * Applies replacements: a row whose `field` names the key of an earlier row by the same creator
 * replaces that row. The original is kept in `superseded` so it stays visible. A row that names
 * someone else's entity replaces nothing and is dropped, since nobody may correct another source.
 * When one original has several replacements, the latest wins and the others are superseded by it.
 */
export function supersede(rows: Row[], field: string): { current: Row[]; superseded: SupersedeLink[] } {
  const byKey = new Map(rows.map((r) => [r.key.toLowerCase(), r]))
  const candidates = new Map<string, Row[]>() // original key -> replacements
  const dropped = new Set<string>()

  for (const row of rows) {
    const target = row.attrs[field]
    if (typeof target !== "string") continue
    const original = byKey.get(target.toLowerCase())
    if (!original) continue // original expired or out of scope: the replacement stands alone
    if (original.creator !== row.creator || original.key === row.key) {
      dropped.add(row.key)
      continue
    }
    candidates.set(original.key, [...(candidates.get(original.key) ?? []), row])
  }

  const replacedBy = new Map<string, Row>()
  for (const [originalKey, list] of candidates) {
    const winner = list.reduce((a, b) => (later(a, b) ? a : b))
    replacedBy.set(originalKey, winner)
    for (const sibling of list) if (sibling !== winner) replacedBy.set(sibling.key, winner)
  }

  const superseded: SupersedeLink[] = []
  const current: Row[] = []
  for (const row of rows) {
    if (dropped.has(row.key)) continue
    const by = replacedBy.get(row.key)
    if (by) superseded.push({ original: row, by })
    else current.push(row)
  }
  return { current, superseded }
}

/** Newer by block, then by key so the order is total and every viewer agrees. */
export function later(a: Row, b: Row): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt
  return a.key > b.key
}
