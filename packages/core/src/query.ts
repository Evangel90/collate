import type { PublicArkivClient } from "@arkiv-network/sdk"
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
}

export type FetchResult = { rows: Row[]; block: bigint }

/**
 * Runs a query and follows cursors past the 200-per-page cap until done. Every page is read at one
 * pinned block so the walk is a consistent snapshot.
 */
export async function fetchAll(client: PublicArkivClient, options: FetchOptions): Promise<FetchResult> {
  const block = options.atBlock ?? (await client.getBlockNumber({ cacheTime: 0 }))
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
  const pages = await Promise.all(groups.map((where) => walk(client, where, block, maxRows)))
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const row of pages.flat()) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    rows.push(row)
  }
  return { rows, block }
}

async function walk(client: PublicArkivClient, where: Where[], block: bigint, maxRows: number) {
  if (where.length === 0) throw new Error("collate: a query needs at least one predicate")
  const rows: Row[] = []
  let page = await client
    .select("*")
    .where(where.map(toExpression))
    .atBlock(block)
    .limit(PAGE_SIZE)
    .fetch()
  for (;;) {
    for (const entity of page.entities) rows.push(toRow(entity))
    if (!page.hasNextPage() || rows.length >= maxRows) break
    page = await page.next()
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
    .select("*")
    .where([toExpression({ op: "eq", field: "$key", value: { type: "key", value: key } }), ...where.map(toExpression)])
    .limit(1)
    .fetch()
  const entity = page.entities[0]
  return entity ? toRow(entity) : undefined
}
