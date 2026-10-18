import { later } from "./supersede.js"
import type { Consensus, Dispute, Row } from "./types.js"

/**
 * Committee consensus. Groups rows by `key` and keeps the latest row from each source. Within a
 * group, sources that report identical compared fields form a bucket. The largest bucket certifies
 * the group when it has at least `quorum` sources and is a strict majority of those who reported;
 * the other buckets are outliers. A group that is not certified is `pending` while fewer than
 * `quorum` sources have reported, and `contested` after that.
 *
 * Only certified groups reach `resolved`, with one row each, so a disagreement is shown, never
 * silently counted, and one bad source cannot veto a unit that a majority agrees on.
 */
export function findConsensus(
  rows: Row[],
  key: string,
  compareFields: string[],
  quorum = 1,
): { resolved: Row[]; consensus: Consensus[]; disputes: Dispute[] } {
  const { groups, unkeyed } = latestPerSource(rows, key)
  const resolved: Row[] = [...unkeyed]
  const consensus: Consensus[] = []
  for (const [k, bySource] of groups) {
    const entries = [...bySource.values()].sort((a, b) => (later(a, b) ? 1 : -1))
    const c = decide(k, entries, compareFields, normalQuorum(quorum))
    consensus.push(c)
    if (c.status === "certified") resolved.push(c.agreeing[c.agreeing.length - 1]!)
  }
  consensus.sort((a, b) => a.key.localeCompare(b.key))
  const disputes = consensus.filter((c) => c.status === "contested").map((c) => ({ key: c.key, entries: c.entries }))
  return { resolved, consensus, disputes }
}

/** The previous contract: quorum 1, so any group a majority agrees on counts. */
export function findDisputes(rows: Row[], key: string, compareFields: string[]): { resolved: Row[]; disputes: Dispute[] } {
  const { resolved, disputes } = findConsensus(rows, key, compareFields, 1)
  return { resolved, disputes }
}

function latestPerSource(rows: Row[], key: string) {
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
  return { groups, unkeyed }
}

/** `entries` is one row per source, oldest first. */
function decide(key: string, entries: Row[], compareFields: string[], quorum: number): Consensus {
  const buckets = new Map<string, Row[]>()
  for (const row of entries) {
    const sig = signature(row, compareFields)
    buckets.set(sig, [...(buckets.get(sig) ?? []), row])
  }
  // Largest bucket; on a tie, the first to form, which is never certified anyway (no majority).
  const top = [...buckets.values()].reduce((a, b) => (b.length > a.length ? b : a))
  const sources = entries.length
  const base = { key, quorum, sources, entries }
  if (top.length >= quorum && top.length * 2 > sources) {
    return { ...base, status: "certified", agreeing: top, outliers: entries.filter((r) => !top.includes(r)) }
  }
  return { ...base, status: sources < quorum ? "pending" : "contested", agreeing: [], outliers: [] }
}

/** A whole number, 1 or more; anything else falls back to 1. */
function normalQuorum(q: number): number {
  return Number.isFinite(q) && q >= 1 ? Math.floor(q) : 1
}

function signature(row: Row, fields: string[]): string {
  return fields.map((f) => String(row.attrs[f] ?? "")).join("|")
}
