import type { PublicArkivClient } from "@arkiv-network/sdk"
import type { Address } from "viem"
import { fetchAll } from "./query"
import type { Row, TrustConfig, TrustMember, TrustSet } from "./types"

const ADDRESS = /^0x[0-9a-f]{40}$/

/**
 * Builds the trust set from list entities that the root creators wrote. Trust always comes from
 * the immutable `$creator`, never from an attribute anyone could write: an accreditation counts
 * only because a root wallet created it.
 */
export function buildTrust(config: TrustConfig, listRows: Row[]): TrustSet {
  const roots = config.rootCreators.map((r) => r.toLowerCase() as Address)
  const rootSet = new Set<string>(roots)
  const members = new Map<string, TrustMember>()
  for (const row of listRows) {
    if (!rootSet.has(row.creator)) continue
    const raw = row.attrs[config.addressField]
    if (typeof raw !== "string") continue
    const address = raw.toLowerCase()
    if (!ADDRESS.test(address)) continue
    const label = config.labelField ? row.attrs[config.labelField] : undefined
    const payloadLabel =
      row.payload && typeof row.payload === "object" && "alias" in row.payload
        ? String((row.payload as { alias: unknown }).alias)
        : undefined
    const prior = members.get(address)
    // Keep the grant that lasts longest, so a lease renewal shows the right expiry.
    if (prior && prior.grantExpiresAt >= row.expiresAt) continue
    members.set(address, {
      address: address as Address,
      via: row.creator,
      grantKey: row.key,
      grantExpiresAt: row.expiresAt,
      label: label !== undefined ? String(label) : payloadLabel,
    })
  }
  return { roots, members }
}

/** Fetches the root creators' list entities and resolves the trusted wallets. */
export async function resolveTrust(
  client: PublicArkivClient,
  config: TrustConfig,
  atBlock?: bigint,
): Promise<{ trust: TrustSet; block: bigint }> {
  const { rows, block } = await fetchAll(client, {
    where: config.listQuery,
    creators: config.rootCreators,
    atBlock,
  })
  return { trust: buildTrust(config, rows), block }
}

/** Splits rows into those whose creator is trusted and those that are not. */
export function partitionByTrust(rows: Row[], trust: TrustSet): { trusted: Row[]; ignored: Row[] } {
  const trusted: Row[] = []
  const ignored: Row[] = []
  for (const row of rows) (trust.members.has(row.creator) ? trusted : ignored).push(row)
  return { trusted, ignored }
}
