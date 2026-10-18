import type { PublicArkivClient } from "@arkiv-network/sdk"
import type { Address } from "viem"
import { fetchAll } from "./query.js"
import type { Row, SelfRegistration, TrustConfig, TrustMember, TrustSet } from "./types.js"

const ADDRESS = /^0x[0-9a-f]{40}$/

/** The wallet a list entity names, lowercase, or `undefined` when the attribute is not an address. */
function namedWallet(row: Row, field: string): string | undefined {
  const raw = row.attrs[field]
  if (typeof raw !== "string") return undefined
  const address = raw.toLowerCase()
  return ADDRESS.test(address) ? address : undefined
}

function labelOf(row: Row, field: string | undefined): string | undefined {
  const label = field ? row.attrs[field] : undefined
  if (label !== undefined) return String(label)
  return row.payload && typeof row.payload === "object" && "alias" in row.payload
    ? String((row.payload as { alias: unknown }).alias)
    : undefined
}

/**
 * True when `row` is a registration that grants trust: it names a wallet, and that wallet is the
 * row's `$creator`. A registration naming anyone else grants nothing.
 */
export function isSelfRegistration(self: SelfRegistration, row: Row): boolean {
  return namedWallet(row, self.addressField) === row.creator
}

/**
 * Builds the trust set from list entities that the root creators wrote, plus, when the config has
 * a `selfRegistration` list, each wallet's own registration. Trust always comes from the immutable
 * `$creator`, never from an attribute anyone could write: an accreditation counts only because a
 * root wallet created it, and a registration only for the wallet that created it.
 */
export function buildTrust(config: TrustConfig, listRows: Row[], selfRows: Row[] = []): TrustSet {
  const roots = config.rootCreators.map((r) => r.toLowerCase() as Address)
  const rootSet = new Set<string>(roots)
  const members = new Map<string, TrustMember>()
  // Keep the grant that lasts longest, so a lease renewal shows the right expiry.
  const offer = (member: TrustMember) => {
    const prior = members.get(member.address)
    if (prior && prior.grantExpiresAt >= member.grantExpiresAt) return
    members.set(member.address, member)
  }
  for (const row of listRows) {
    if (!rootSet.has(row.creator)) continue
    const address = namedWallet(row, config.addressField)
    if (!address) continue
    offer({ address: address as Address, via: row.creator, grantKey: row.key, grantExpiresAt: row.expiresAt, label: labelOf(row, config.labelField) })
  }
  const self = config.selfRegistration
  if (self) {
    const vouched = new Set(members.keys())
    for (const row of selfRows) {
      if (!isSelfRegistration(self, row)) continue
      // A wallet a root vouched for keeps that grant: it is the stronger claim, and the one shown.
      if (vouched.has(row.creator)) continue
      offer({
        address: row.creator,
        via: row.creator,
        grantKey: row.key,
        grantExpiresAt: row.expiresAt,
        label: labelOf(row, self.labelField),
        selfRegistered: true,
      })
    }
  }
  return { roots, members }
}

export type TrustRead = {
  trust: TrustSet
  /** The block the trust set is current at (the older of the two lists, when one came from the cache). */
  block: bigint
  cached?: boolean
  /** With `selfRegistration`: the block the registrations were read at. */
  selfBlock?: bigint
}

/**
 * Fetches the root creators' list entities (and the registrations, if any) and resolves the
 * trusted wallets. Registrations come from any wallet, so they cost one read of their own; it is
 * pinned to the root list's block when that list was read just now, so both are one snapshot.
 */
export async function resolveTrust(client: PublicArkivClient, config: TrustConfig, atBlock?: bigint): Promise<TrustRead> {
  const list = await fetchAll(client, {
    where: config.listQuery,
    creators: config.rootCreators,
    atBlock,
    payload: true,
  })
  const self = config.selfRegistration
  if (!self) return { trust: buildTrust(config, list.rows), block: list.block, cached: list.cached }
  const open = await fetchAll(client, {
    where: self.listQuery,
    atBlock: atBlock ?? (list.cached ? undefined : list.block),
    payload: true,
  })
  const cached = Boolean(list.cached || open.cached)
  return {
    trust: buildTrust(config, list.rows, open.rows),
    block: cached && open.block < list.block ? open.block : list.block,
    cached,
    selfBlock: open.block,
  }
}

/** Splits rows into those whose creator is trusted and those that are not. */
export function partitionByTrust(rows: Row[], trust: TrustSet): { trusted: Row[]; ignored: Row[] } {
  const trusted: Row[] = []
  const ignored: Row[] = []
  for (const row of rows) (trust.members.has(row.creator) ? trusted : ignored).push(row)
  return { trusted, ignored }
}
