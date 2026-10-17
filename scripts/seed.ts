/**
 * Seeds the synthetic demo election on Tiramisu. Safe to re-run: every step first queries Arkiv for
 * what it would write and skips if it is already there. A write whose outcome is unknown stops the
 * run instead of being resent; reconcile it on the explorer first.
 *
 *   npm run seed            # fund wallets from Coordinator A, then write everything
 *   npm run seed -- --dry   # show the plan and balances, write nothing
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  createPublicClient,
  createWalletClient,
  EntityMutationError,
  type CreateEntityParameters,
} from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, or, type Expression } from "@arkiv-network/sdk/query"
import { formatEther, http, parseEther, type Hex, type PrivateKeyAccount } from "viem"
import { accreditationEntity, correctionEntity, electionEntity, resultEntity, unitEntity } from "../apps/web/src/model/schema"
import {
  ACCREDITED_BY_A,
  ACCREDITED_BY_B,
  ELECTION,
  EXTRAS,
  alias,
  assignments,
  electionInput,
  result,
  shifted,
  trueFigures,
  units,
} from "./demo-data"
import { writeDeployment } from "./deployment"
import { loadWallets } from "./env"

const DRY = process.argv.includes("--dry")
const EXPLORER = "https://tiramisu.explorer.arkiv.network"
const LOG = resolve(import.meta.dirname, "../arkiv/seed-transactions.md")

const publicClient = createPublicClient({ chain: tiramisu, transport: http(), cacheTime: 0 })
const walletFor = (account: PrivateKeyAccount) =>
  createWalletClient({ account, chain: tiramisu, transport: http(undefined, { retryCount: 0, timeout: 60_000 }) })

const w = loadWallets()
writeDeployment(w)
const now = Math.floor(Date.now() / 1000)
const UNITS = units()

function log(role: string, what: string, txHash: Hex) {
  if (!existsSync(LOG)) {
    writeFileSync(
      LOG,
      "# Seed transactions\n\nEvery write the seed script made on Tiramisu (chain 7738577). These links stay valid after the entities expire.\n\n| Wallet | What | Transaction |\n| --- | --- | --- |\n",
    )
  }
  appendFileSync(LOG, `| ${role} | ${what} | [${txHash.slice(0, 10)}…](${EXPLORER}/tx/${txHash}) |\n`)
  console.log(`  ✓ ${role}: ${what}\n    ${EXPLORER}/tx/${txHash}`)
}

async function count(where: Expression[], creator: Hex) {
  const page = await publicClient.select({ key: true }).where(where).createdBy(creator).limit(200).fetch()
  return page.entities.length
}

/** Sends one batch; on an unknown outcome, stops with the hash rather than resending. */
async function batch(account: PrivateKeyAccount, role: string, what: string, creates: CreateEntityParameters[]) {
  try {
    const res = await walletFor(account).executeBatch({ creates })
    log(role, what, res.txHash)
    return res.createdEntities
  } catch (error) {
    if (error instanceof EntityMutationError && error.txHash) {
      throw new Error(`${role}: outcome of ${error.txHash} unknown. Check ${EXPLORER}/tx/${error.txHash} before re-running.`, { cause: error })
    }
    throw error
  }
}

/** Creates in chunks; each chunk is atomic. One chunk when it fits, so an election lands whole. */
async function chunked(account: PrivateKeyAccount, role: string, what: string, creates: CreateEntityParameters[], size: number) {
  for (let i = 0; i < creates.length; i += size) {
    const part = creates.slice(i, i + size)
    const label = creates.length > size ? `${what} (${i + 1}–${i + part.length} of ${creates.length})` : what
    await batch(account, role, label, part)
  }
}

async function fund() {
  console.log("\n1. Funding")
  const funder = w.coordinatorA
  const balance = await publicClient.getBalance({ address: funder.address })
  console.log(`  Coordinator A ${funder.address}: ${formatEther(balance)} GLM`)
  if (balance === 0n) {
    const message = `Fund Coordinator A (${funder.address}) at https://hub.arkiv.network/faucet, then re-run.`
    if (DRY) return console.log(`  ${message}`)
    throw new Error(message)
  }
  // Measured on Tiramisu at ~1 gwei: a 57-entity setup batch ≈ 0.0065 GLM, a 7-result batch ≈ 0.001
  // GLM. These top-ups leave ample room for corrections and Lifetime Extensions.
  const targets = [
    { role: "Coordinator B", address: w.coordinatorB.address, want: parseEther("0.1") },
    ...w.observers.map((o, i) => ({ role: alias(i), address: o.address, want: parseEther("0.05") })),
    { role: "Unaccredited", address: w.rogue.address, want: parseEther("0.02") },
  ]
  for (const t of targets) {
    const want = t.want
    const have = await publicClient.getBalance({ address: t.address })
    if (have >= want / 2n) continue
    if (DRY) {
      console.log(`  would send ${formatEther(want - have)} GLM to ${t.role}`)
      continue
    }
    const hash = await walletFor(funder).sendTransaction({ to: t.address, value: want - have })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== "success") throw new Error(`Funding ${t.role} failed: ${hash}`)
    log("Coordinator A", `fund ${t.role} with ${formatEther(want - have)} GLM`, hash)
  }
}

async function coordinator(account: PrivateKeyAccount, role: string, accredited: number[]) {
  const election = electionInput(now)
  const existing = await count([eq("type", "election"), eq("election", ELECTION)], account.address)
  if (existing > 0) {
    console.log(`  ${role}: election already on Arkiv, skipping`)
    return
  }
  const creates = [
    electionEntity(election),
    ...UNITS.map(unitEntity),
    ...accredited.map((o) => accreditationEntity(ELECTION, w.observers[o]!.address, alias(o), election.closesAt)),
  ]
  if (DRY) return console.log(`  ${role}: would create ${creates.length} entities`)
  try {
    await batch(account, role, `election, ${UNITS.length} units, ${accredited.length} accreditations`, creates)
  } catch (error) {
    if (String(error).includes("unknown")) throw error
    // Never split after a send that may have landed: re-check before writing again.
    if ((await count([eq("type", "election"), eq("election", ELECTION)], account.address)) > 0) throw error
    console.log(`  one batch was refused (${(error as Error).message.split("\n")[0]}); splitting`)
    await chunked(account, role, "election setup", creates, 15)
  }
}

function observerPlan(o: number) {
  const plan = assignments().get(o) ?? []
  const creates: CreateEntityParameters[] = []
  for (const u of plan) {
    const unit = UNITS[u]!
    let figures = trueFigures(unit, u)
    if (o === EXTRAS.disputeB.observer && u === EXTRAS.disputeB.unit) figures = shifted(figures, EXTRAS.disputeB.shift)
    // The mistyped original; the correction follows once its key is known.
    if (o === EXTRAS.correction.observer && u === EXTRAS.correction.unit) figures = { ...figures, votes_a: figures.votes_a + 90 }
    creates.push(resultEntity(result(unit, figures, now - 3600 * 5 + u * 337)))
  }
  const extra = (e: { observer: number; unit: number }, f: ReturnType<typeof trueFigures>, note: string) => {
    if (e.observer === o) creates.push(resultEntity(result(UNITS[e.unit]!, f, now - 1800 + e.unit * 7, note)))
  }
  extra(EXTRAS.confirmation, trueFigures(UNITS[EXTRAS.confirmation.unit]!, EXTRAS.confirmation.unit), "Second count at this unit")
  extra(EXTRAS.disputeA, shifted(trueFigures(UNITS[EXTRAS.disputeA.unit]!, EXTRAS.disputeA.unit), EXTRAS.disputeA.shift), "Second count at this unit")
  extra(EXTRAS.disputeA2, shifted(trueFigures(UNITS[EXTRAS.disputeA2.unit]!, EXTRAS.disputeA2.unit), EXTRAS.disputeA2.shift), "Second count at this unit")
  return creates
}

const resultTypes = or(eq("type", "unit_result"), eq("type", "correction"))

async function observers() {
  console.log("\n3. Observer results")
  for (const [o, account] of w.observers.entries()) {
    const creates = observerPlan(o)
    if (creates.length === 0) continue
    if ((await count([resultTypes, eq("election", ELECTION)], account.address)) > 0) {
      console.log(`  ${alias(o)}: results already on Arkiv, skipping`)
      continue
    }
    if (DRY) {
      console.log(`  ${alias(o)}: would post ${creates.length} results`)
      continue
    }
    await batch(account, alias(o), `${creates.length} unit results`, creates)
  }
}

async function correction() {
  console.log("\n4. Correction")
  const { observer, unit: u } = EXTRAS.correction
  const account = w.observers[observer]!
  const unit = UNITS[u]!
  if ((await count([eq("type", "correction"), eq("election", ELECTION)], account.address)) > 0) {
    return console.log(`  ${alias(observer)}: correction already on Arkiv, skipping`)
  }
  const page = await publicClient
    .select({ key: true })
    .where(eq("type", "unit_result"), eq("election", ELECTION), eq("unit_code", unit.unitCode))
    .createdBy(account.address)
    .limit(2)
    .fetch()
  const original = page.entities[0]?.key
  if (!original) return console.log(`  ${alias(observer)}: original result not found yet${DRY ? " (dry run)" : ""}, skipping`)
  if (DRY) return console.log(`  ${alias(observer)}: would correct ${original}`)
  const fixed = result(unit, trueFigures(unit, u), now - 600)
  await batch(account, alias(observer), `correction of ${unit.unitCode}`, [
    correctionEntity(fixed, original, "Typed 90 extra votes for Unity Party; corrected from the result sheet"),
  ])
}

/**
 * Second counts added after the first seed, so they cannot ride in an observer's first batch (that
 * step skips any observer who has posted). Each is checked by unit before it is written.
 */
async function secondCounts() {
  console.log("\n5. Second counts")
  for (const { observer: o, unit: u } of EXTRAS.agreements) {
    const account = w.observers[o]!
    const unit = UNITS[u]!
    if ((await count([resultTypes, eq("election", ELECTION), eq("unit_code", unit.unitCode)], account.address)) > 0) {
      console.log(`  ${alias(o)}: ${unit.unitCode} already on Arkiv, skipping`)
      continue
    }
    if (DRY) {
      console.log(`  ${alias(o)}: would post a second count of ${unit.unitCode}`)
      continue
    }
    const figures = trueFigures(unit, u)
    await batch(account, alias(o), `second count of ${unit.unitCode}`, [resultEntity(result(unit, figures, now - 1800 + u * 7, "Second count at this unit"))])
  }
}

async function rogue() {
  console.log("\n6. Unaccredited write")
  const unit = UNITS[EXTRAS.rogue.unit]!
  if ((await count([resultTypes, eq("election", ELECTION)], w.rogue.address)) > 0) {
    return console.log("  unaccredited wallet: result already on Arkiv, skipping")
  }
  if (DRY) return console.log("  unaccredited wallet: would post an inflated result")
  const figures = { ...trueFigures(unit, EXTRAS.rogue.unit), votes_a: EXTRAS.rogue.votes_a }
  await batch(w.rogue, "Unaccredited", `inflated result for ${unit.unitCode}`, [resultEntity(result(unit, figures, now - 300, "Totally real"))])
}

console.log(`Seeding ${ELECTION} on Tiramisu (chain ${tiramisu.id})${DRY ? " — DRY RUN, nothing is written" : ""}`)
await fund()
console.log("\n2. Coordinators")
await coordinator(w.coordinatorA, "Coordinator A", ACCREDITED_BY_A)
await coordinator(w.coordinatorB, "Coordinator B", ACCREDITED_BY_B)
await observers()
await correction()
await secondCounts()
await rogue()
console.log("\nDone. Public addresses are in apps/web/src/deployment.json; transactions in arkiv/seed-transactions.md.")
