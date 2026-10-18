import type { FullEntity, PublicArkivClient } from "@arkiv-network/sdk"
import { createReadCache, type ReadCache, type ReadSpec } from "./cache.js"
import { toRow } from "./rows.js"
import type { Row, Where } from "./types.js"
import { createdByAny, toExpression } from "./where.js"

/** Arkiv's per-page maximum. */
export const PAGE_SIZE = 200
/** Creators per OR group, to keep query text reasonable. */
const CREATOR_CHUNK = 25

export type FetchOptions = {
  where: Where[]
  /** Only entities created by one of these wallets. Empty array means "nothing". */
  creators?: readonly string[]
  /** Read at this block; defaults to the current head, read once. */
  atBlock?: bigint
  /** Stop after this many rows, as a guard against unbounded walks. */
  maxRows?: number
  /** Also fetch payload and content type. Off by default: reads are metered, so fetch only what is shown. */
  payload?: boolean
  /**
   * Skip snapshots the session cache already holds and read at a newly fetched head, e.g. right
   * after a write. Ignored when `atBlock` is set.
   */
  fresh?: boolean
}

/** Everything a Row needs except the payload. */
const LEAN = { key: true, owner: true, creator: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true } as const
const FULL = { ...LEAN, contentType: true, payload: true } as const

const heads = new WeakMap<object, { at: number; block: Promise<bigint> }>()
const caches = new WeakMap<object, ReadCache>()
const HEAD_TTL = 2_000
/** How long a head snapshot answers identical (or narrower) reads in this tab. */
export const DEFAULT_CACHE_TTL = 90_000

/**
 * The current block, shared by every caller within two seconds, so panels loading together read
 * one snapshot. `fresh` always asks the node. Block numbers are not metered like queries.
 */
export function headBlock(client: PublicArkivClient, fresh = false): Promise<bigint> {
  const cached = heads.get(client)
  if (!fresh && cached && Date.now() - cached.at < HEAD_TTL) return cached.block
  const block = client.getBlockNumber({ cacheTime: 0 })
  heads.set(client, { at: Date.now(), block })
  block.catch(() => heads.delete(client))
  return block
}

/** Gives a client its session read cache (`createClients` does this). */
export function setReadCache(client: PublicArkivClient, cache: ReadCache) {
  caches.set(client, cache)
}

/** The client's read cache; a memory-only one with the default TTL if none was set. */
export function readCacheFor(client: PublicArkivClient): ReadCache {
  let cache = caches.get(client)
  if (!cache) caches.set(client, (cache = createReadCache({ ttlMs: DEFAULT_CACHE_TTL })))
  return cache
}

/** `cached` is true when the rows came from a snapshot the session cache already held. */
export type FetchResult = { rows: Row[]; block: bigint; cached?: boolean }

const specOf = (options: FetchOptions): ReadSpec => ({
  where: options.where,
  creators: options.creators && [...new Set(options.creators.map((c) => c.toLowerCase()))].sort(),
  payload: options.payload ?? false,
  maxRows: options.maxRows ?? 50_000,
})

/**
 * Runs a query and follows cursors past the 200-per-page cap until done. Every page is read at one
 * pinned block so the walk is a consistent snapshot.
 *
 * Tiramisu prices every query the same, so reads go through a session cache first: identical
 * concurrent reads share one request, and a head read finished within the TTL (default 90 s)
 * answers the same read, or a narrower one (fewer creators, one value of an OR, an extra
 * equality), without a query. Pinned reads (`atBlock`) reuse only a snapshot of that exact block.
 */
export async function fetchAll(client: PublicArkivClient, options: FetchOptions): Promise<FetchResult> {
  if (options.creators && options.creators.length === 0) {
    return { rows: [], block: options.atBlock ?? (await headBlock(client)) }
  }
  if (options.where.length === 0) throw new Error("collate: a query needs at least one predicate")
  const spec = specOf(options)
  const cache = readCacheFor(client)
  const pinned = options.atBlock
  const hit = pinned !== undefined ? cache.at(spec, pinned) : options.fresh ? undefined : cache.head(spec)
  if (hit) return hit
  const block = pinned !== undefined ? Promise.resolve(pinned) : headBlock(client, options.fresh)
  const rows = block.then((b) => readAll(client, spec, b))
  cache.add(spec, pinned ?? block, rows)
  return { rows: await rows, block: await block, cached: false }
}

/** The network part: one walk per 25 creators, in parallel, merged and de-duplicated. */
async function readAll(client: PublicArkivClient, spec: ReadSpec, block: bigint): Promise<Row[]> {
  const groups: Where[][] = []
  if (spec.creators) {
    for (let i = 0; i < spec.creators.length; i += CREATOR_CHUNK) {
      groups.push([...spec.where, createdByAny(spec.creators.slice(i, i + CREATOR_CHUNK))])
    }
  } else {
    groups.push(spec.where)
  }
  const pages = await Promise.all(groups.map((where) => walk(client, where, block, spec.maxRows, spec.payload)))
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const row of pages.flat()) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    rows.push(row)
  }
  return rows
}

async function walk(client: PublicArkivClient, where: Where[], block: bigint, maxRows: number, payload: boolean) {
  const rows: Row[] = []
  let page = await client
    .select(payload ? FULL : LEAN)
    .where(where.map(toExpression))
    .atBlock(block)
    .limit(PAGE_SIZE)
    .fetch()
  for (;;) {
    for (const entity of page.entities) rows.push(toRow(entity as FullEntity))
    if (!page.hasNextPage() || rows.length >= maxRows) break
    page = await page.next()
  }
  return rows
}

/**
 * Fetches those of `keys` that still match the predicates, in one query per 25 keys. Pass the
 * block the newest key was created in, so the read is never older than the entities it looks for.
 */
export async function fetchMatchingMany(
  client: PublicArkivClient,
  keys: readonly string[],
  where: Where[],
  payload = false,
  atBlock?: bigint,
): Promise<Row[]> {
  const rows: Row[] = []
  const block = atBlock ?? (await headBlock(client, true))
  for (let i = 0; i < keys.length; i += CREATOR_CHUNK) {
    const byKey = keys.slice(i, i + CREATOR_CHUNK).map((k): Where => ({ op: "eq", field: "$key", value: { type: "key", value: k } }))
    const anyKey: Where = byKey.length === 1 ? byKey[0]! : { op: "or", any: byKey }
    rows.push(...(await fetchAll(client, { where: [anyKey, ...where], payload, atBlock: block })).rows)
  }
  return rows
}

/** Fetches one entity by key if it still matches the predicates; `undefined` otherwise. */
export async function fetchMatching(
  client: PublicArkivClient,
  key: `0x${string}`,
  where: Where[],
): Promise<Row | undefined> {
  const page = await client
    .select(FULL)
    .where([toExpression({ op: "eq", field: "$key", value: { type: "key", value: key } }), ...where.map(toExpression)])
    .limit(1)
    .fetch()
  const entity = page.entities[0]
  return entity ? toRow(entity as FullEntity) : undefined
}
