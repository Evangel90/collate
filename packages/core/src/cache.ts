import type { Row, TypedValue, Where, WhereValue } from "./types"

/**
 * One read, in a form that can be compared: AND-ed predicates, an optional creator set (lowercase,
 * sorted), whether payloads were selected, and the row cap.
 */
export type ReadSpec = {
  where: Where[]
  creators?: readonly string[]
  payload: boolean
  maxRows: number
}

export type Snapshot = { rows: Row[]; block: bigint }
/** `cached` is true when the rows come from a read that had finished before this call. */
export type CacheHit = Snapshot & { cached: boolean }

/** The part of `Storage` the cache needs, so tests and non-browser hosts can pass their own. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type ReadCacheOptions = {
  /** How long a finished head read may answer later reads. 0 keeps only in-flight sharing. */
  ttlMs: number
  storage?: KeyValueStore
  /** Separates stores for different RPCs. */
  namespace?: string
}

export type ReadCache = {
  readonly ttlMs: number
  /** A read covering `spec` that is in flight or finished within the TTL, newest first. */
  head: (spec: ReadSpec) => Promise<CacheHit> | undefined
  /** A finished or in-flight read covering `spec` pinned at exactly `block`. */
  at: (spec: ReadSpec, block: bigint) => Promise<CacheHit> | undefined
  /** Registers a read as soon as it starts, so identical concurrent reads share one request. */
  add: (spec: ReadSpec, block: bigint | Promise<bigint>, rows: Promise<Row[]>) => void
  clear: () => void
}

type Entry = { spec: ReadSpec; at: number; block?: bigint; rows?: Row[]; promise: Promise<Snapshot> }

/** Pinned snapshots are immutable, but only useful for a moment after they are read. */
const PINNED_KEEP = 30_000
const MAX_ENTRIES = 100
const MAX_PERSISTED = 40
const BIGINT_TAG = "__collate_bigint"

export function createReadCache(options: ReadCacheOptions): ReadCache {
  const { ttlMs, storage } = options
  const storeKey = `collate:reads:v1:${options.namespace ?? "default"}`
  let entries: Entry[] = restore()

  function restore(): Entry[] {
    if (!storage || ttlMs <= 0) return []
    try {
      const raw = storage.getItem(storeKey)
      if (!raw) return []
      const now = Date.now()
      const saved = JSON.parse(raw, revive) as { spec: ReadSpec; at: number; block: bigint; rows: Row[] }[]
      return saved
        .filter((s) => now - s.at <= ttlMs && typeof s.block === "bigint" && Array.isArray(s.rows))
        .map((s) => ({ ...s, promise: Promise.resolve({ rows: s.rows, block: s.block }) }))
    } catch {
      return []
    }
  }

  function persist() {
    if (!storage || ttlMs <= 0) return
    const now = Date.now()
    const saved = entries
      .filter((e) => e.rows && e.block !== undefined && now - e.at <= ttlMs)
      .slice(-MAX_PERSISTED)
      .map(({ spec, at, block, rows }) => ({ spec, at, block, rows }))
    try {
      storage.setItem(storeKey, JSON.stringify(saved, replace))
    } catch {
      // Quota or blocked storage: the in-memory cache still works for this page.
      try {
        storage.removeItem(storeKey)
      } catch {
        /* nothing more to do */
      }
    }
  }

  function prune(now: number) {
    const keep = Math.max(ttlMs, PINNED_KEEP)
    entries = entries.filter((e) => !e.rows || now - e.at <= keep)
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  }

  const answer = (entry: Entry, filter: RowFilter): Promise<CacheHit> => {
    const cached = entry.rows !== undefined
    return entry.promise.then(({ rows, block }) => ({ rows: filter === ALL ? rows : rows.filter(filter), block, cached }))
  }

  return {
    ttlMs,
    head(spec) {
      const now = Date.now()
      let best: { entry: Entry; filter: RowFilter } | undefined
      for (const entry of entries) {
        if (entry.rows && now - entry.at > ttlMs) continue
        const filter = covers(entry.spec, spec)
        if (filter && (!best || entry.at >= best.entry.at)) best = { entry, filter }
      }
      return best && answer(best.entry, best.filter)
    },
    at(spec, block) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]!
        if (entry.block !== block) continue
        const filter = covers(entry.spec, spec)
        if (filter) return answer(entry, filter)
      }
      return undefined
    },
    add(spec, block, rows) {
      const now = Date.now()
      prune(now)
      const entry: Entry = { spec, at: now, promise: Promise.all([rows, block]).then(([r, b]) => ({ rows: r, block: b })) }
      entries.push(entry)
      // A pinned read's block is known now, so a concurrent read of the same block joins it at once.
      if (typeof block === "bigint") entry.block = block
      else block.then((b) => (entry.block = b)).catch(() => undefined)
      entry.promise.then(
        ({ rows: r }) => {
          entry.rows = r
          persist()
        },
        () => {
          entries = entries.filter((e) => e !== entry)
        },
      )
    },
    clear() {
      entries = []
      try {
        storage?.removeItem(storeKey)
      } catch {
        /* ignore */
      }
    },
  }
}

function replace(_key: string, value: unknown) {
  return typeof value === "bigint" ? { [BIGINT_TAG]: value.toString() } : value
}

function revive(_key: string, value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tagged = (value as Record<string, unknown>)[BIGINT_TAG]
    if (typeof tagged === "string" && Object.keys(value).length === 1) return BigInt(tagged)
  }
  return value
}

/* ---------- Coverage: can a finished read answer another one in the browser? ---------- */

/** The wallets a query is restricted to by a top-level `$creator` equality or OR of them. */
export function creatorScope(query: Where[]): Set<string> | undefined {
  for (const w of query) {
    const parts = w.op === "or" ? w.any : [w]
    const values = parts.map((p) => (p.op === "eq" && p.field === "$creator" ? p.value : undefined))
    if (values.length && values.every((v) => v !== undefined)) {
      return new Set(values.map((v) => String(typeof v === "object" ? v.value : v).toLowerCase()))
    }
  }
  return undefined
}

type RowFilter = (row: Row) => boolean
const ALL: RowFilter = () => true

/** One canonical typed form per value, so `"x"` and `v.str("x")` compare equal. */
function typed(value: WhereValue): TypedValue {
  if (typeof value === "string") return { type: "str", value }
  if (typeof value === "boolean") return { type: "bool", value }
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? { type: "u64", value: String(value) } : { type: "i32", value }
  if (value.type === "addr" || value.type === "key") return { type: value.type, value: value.value.toLowerCase() }
  return value
}

function canonical(w: Where): unknown {
  switch (w.op) {
    case "or":
      return { op: "or", any: w.any.map(canonical) }
    case "and":
      return { op: "and", all: w.all.map(canonical) }
    case "startsWith":
      return w
    default:
      return { op: w.op, field: w.field, value: typed(w.value) }
  }
}

const same = (a: Where, b: Where) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/** `field = a`, or `field = a OR field = b …`, as a field and its allowed values. */
function equalities(w: Where): { field: string; values: string[] } | undefined {
  if (w.op === "eq") return { field: w.field, values: [JSON.stringify(typed(w.value))] }
  if (w.op !== "or" || w.any.length === 0) return undefined
  const parts = w.any.map(equalities)
  const field = parts[0]?.field
  if (!field || parts.some((p) => !p || p.field !== field)) return undefined
  return { field, values: parts.flatMap((p) => p!.values) }
}

/** Every row matching `r` also matches `c`: equal, or `r` narrows an OR of equalities in `c`. */
function implies(r: Where, c: Where): boolean {
  if (same(r, c)) return true
  const rs = equalities(r)
  const cs = equalities(c)
  return Boolean(rs && cs && rs.field === cs.field && rs.values.every((v) => cs.values.includes(v)))
}

/** Equalities can be checked against a row in the browser; ranges are left to Arkiv on purpose. */
function evaluable(w: Where): boolean {
  if (w.op === "or") return w.any.every(evaluable)
  if (w.op === "and") return w.all.every(evaluable)
  return w.op === "eq" && (!w.field.startsWith("$") || ["$creator", "$owner", "$key"].includes(w.field))
}

function test(row: Row, w: Where): boolean {
  if (w.op === "or") return w.any.some((x) => test(row, x))
  if (w.op === "and") return w.all.every((x) => test(row, x))
  if (w.op !== "eq") return false
  const t = typed(w.value)
  const actual = w.field === "$creator" ? row.creator : w.field === "$owner" ? row.owner : w.field === "$key" ? row.key : row.attrs[w.field]
  switch (t.type) {
    case "str":
      return actual === t.value
    case "u64":
      return typeof actual === "number" ? String(actual) === t.value : actual === t.value
    case "addr":
    case "key":
      return typeof actual === "string" && actual.toLowerCase() === t.value
    default:
      return actual === t.value
  }
}

/**
 * How the rows of finished read `c` answer read `r`, or `undefined` when they cannot. `c` covers
 * `r` when every predicate of `c` is implied by `r`, the predicates `r` adds are equalities, `c`
 * read every creator `r` asks for, and `c` selected at least what `r` selects. The answer is `c`'s
 * rows filtered by `r`'s extra predicates and creators. Range predicates are never evaluated
 * locally, so a range query always reaches Arkiv.
 */
export function covers(c: ReadSpec, r: ReadSpec): RowFilter | undefined {
  if (r.payload && !c.payload) return undefined
  if (c.maxRows < r.maxRows) return undefined
  if (c.creators) {
    // A `$creator` filter written into the predicates restricts creators just as well.
    const asked = r.creators ?? [...(creatorScope(r.where) ?? [])]
    const have = new Set(c.creators)
    if (asked.length === 0 || asked.some((x) => !have.has(x))) return undefined
  }
  if (!c.where.every((cw) => r.where.some((rw) => implies(rw, cw)))) return undefined
  const extra = r.where.filter((rw) => !c.where.some((cw) => same(rw, cw)))
  if (!extra.every(evaluable)) return undefined
  const creators = r.creators && r.creators.length !== c.creators?.length ? new Set(r.creators) : undefined
  if (!creators && extra.length === 0) return ALL
  return (row) => (!creators || creators.has(row.creator)) && extra.every((w) => test(row, w))
}
