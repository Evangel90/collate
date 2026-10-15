import type { FullEntity, PublicArkivClient } from "@arkiv-network/sdk"
import { toRow } from "./rows"
import type { Row, Where } from "./types"
import { createdByAny, toExpression } from "./where"

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
}

/** Everything a Row needs except the payload. */
const LEAN = { key: true, owner: true, creator: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true } as const
const FULL = { ...LEAN, contentType: true, payload: true } as const

/** Reads shared across panels on one client: the head block for a moment, identical walks at one block. */
const heads = new WeakMap<object, { at: number; block: Promise<bigint> }>()
const walks = new WeakMap<object, Map<string, { at: number; rows: Promise<Row[]> }>>()
const HEAD_TTL = 2_000
const WALK_TTL = 30_000

/** The current block, shared by every caller within two seconds, so panels loading together read one snapshot. */
export function headBlock(client: PublicArkivClient): Promise<bigint> {
  const cached = heads.get(client)
  if (cached && Date.now() - cached.at < HEAD_TTL) return cached.block
  const block = client.getBlockNumber({ cacheTime: 0 })
  heads.set(client, { at: Date.now(), block })
  block.catch(() => heads.delete(client))
  return block
}

export type FetchResult = { rows: Row[]; block: bigint }

/**
 * Runs a query and follows cursors past the 200-per-page cap until done. Every page is read at one
 * pinned block so the walk is a consistent snapshot.
 */
export async function fetchAll(client: PublicArkivClient, options: FetchOptions): Promise<FetchResult> {
  const block = options.atBlock ?? (await headBlock(client))
  if (options.creators && options.creators.length === 0) return { rows: [], block }

  const groups: Where[][] = []
  if (options.creators) {
    for (let i = 0; i < options.creators.length; i += CREATOR_CHUNK) {
      groups.push([...options.where, createdByAny(options.creators.slice(i, i + CREATOR_CHUNK))])
    }
  } else {
    groups.push(options.where)
  }

  const maxRows = options.maxRows ?? 50_000
  const pages = await Promise.all(groups.map((where) => sharedWalk(client, where, block, maxRows, options.payload ?? false)))
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const row of pages.flat()) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    rows.push(row)
  }
  return { rows, block }
}

/** One walk per identical (query, block, selection) at a time; results are immutable at a fixed block. */
function sharedWalk(client: PublicArkivClient, where: Where[], block: bigint, maxRows: number, payload: boolean) {
  let cache = walks.get(client)
  if (!cache) walks.set(client, (cache = new Map()))
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at > WALK_TTL) cache.delete(k)
  const key = `${block}|${payload}|${maxRows}|${JSON.stringify(where)}`
  const hit = cache.get(key)
  if (hit) return hit.rows
  const rows = walk(client, where, block, maxRows, payload)
  cache.set(key, { at: now, rows })
  rows.catch(() => cache.delete(key))
  return rows
}

async function walk(client: PublicArkivClient, where: Where[], block: bigint, maxRows: number, payload: boolean) {
  if (where.length === 0) throw new Error("collate: a query needs at least one predicate")
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

/** Fetches those of `keys` that still match the predicates, in one query per 25 keys. */
export async function fetchMatchingMany(client: PublicArkivClient, keys: readonly string[], where: Where[], payload = false): Promise<Row[]> {
  const rows: Row[] = []
  for (let i = 0; i < keys.length; i += CREATOR_CHUNK) {
    const byKey = keys.slice(i, i + CREATOR_CHUNK).map((k): Where => ({ op: "eq", field: "$key", value: { type: "key", value: k } }))
    const anyKey: Where = byKey.length === 1 ? byKey[0]! : { op: "or", any: byKey }
    rows.push(...(await fetchAll(client, { where: [anyKey, ...where], payload })).rows)
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
