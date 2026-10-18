/**
 * Accredits one more observer wallet for the demo election, from a seed coordinator's key.
 *
 *   npm run accredit -- --address 0x… --alias "Observer 13" [--group a|b]
 *
 * One query first: the election (for its closing time, which sets the lease) and any live
 * accreditation of this wallet by the same coordinator, so running it twice writes nothing.
 */
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, fetchAll, or } from "collate-core"
import { http, isAddress } from "viem"
import { accreditationEntity } from "../apps/web/src/model/schema"
import { ELECTION } from "./demo-data"
import { loadWallets } from "./env"

const EXPLORER = "https://tiramisu.explorer.arkiv.network"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const address = arg("address")?.toLowerCase()
const alias = arg("alias")?.trim()
const group = (arg("group") ?? "a").toLowerCase()
if (!address || !isAddress(address)) throw new Error("Pass --address 0x… (the observer's wallet)")
if (!alias) throw new Error('Pass --alias "Observer 13" (public, so synthetic, never a real name)')
if (group !== "a" && group !== "b") throw new Error("--group must be a or b")

const w = loadWallets()
const coordinator = group === "a" ? w.coordinatorA : w.coordinatorB
// No automatic retries: each retried query is one more metered query.
const publicClient = createPublicClient({ chain: tiramisu, transport: http(undefined, { retryCount: 0 }), cacheTime: 0 })

const { rows } = await fetchAll(publicClient, {
  where: [or(eq("type", "election"), eq("type", "accreditation")), eq("election", ELECTION)],
  creators: [coordinator.address],
})
const election = rows.find((r) => r.attrs.type === "election")
if (!election) throw new Error(`Group ${group.toUpperCase()} has no election "${ELECTION}" on Arkiv. Run the seed first.`)
const existing = rows.find((r) => r.attrs.type === "accreditation" && r.attrs.observer === address)
if (existing) {
  console.log(`Already accredited by Group ${group.toUpperCase()}: entity ${existing.key}. Nothing written.`)
  process.exit(0)
}

const closesAt = Number(election.attrs.closes_at)
const wallet = createWalletClient({ account: coordinator, chain: tiramisu, transport: http(undefined, { retryCount: 0, timeout: 60_000 }) })
const res = await wallet.createEntity(accreditationEntity(ELECTION, address, alias, closesAt))
console.log(`✓ Group ${group.toUpperCase()} accredited ${alias} (${address}) for ${ELECTION}`)
console.log(`  entity ${res.entityKey}`)
console.log(`  ${EXPLORER}/tx/${res.txHash}`)
