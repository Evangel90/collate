/**
 * Seeds the synthetic demo election on Tiramisu. Safe to re-run: it first reads everything this
 * election already has from our wallets (one paginated query) and writes only what is missing. A
 * write whose outcome is unknown stops the run with its transaction hash instead of being resent;
 * reconcile it on the explorer first.
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
import { eq, fetchAll, type Row } from "collate-core"
import { formatEther, http, parseEther, type Hex, type PrivateKeyAccount } from "viem"
import { accreditationEntity, correctionEntity, electionEntity, resultEntity, unitEntity } from "../apps/web/src/model/schema"
import {
  ACCREDITED_BY_A,
  ACCREDITED_BY_B,
  ELECTION,
  alias,
  correctionPlan,
  electionInput,
  observerResults,
  result,
  roguePlan,
  units,
} from "./demo-data"
import { writeDeployment } from "./deployment"
import { loadWallets } from "./env"

const DRY = process.argv.includes("--dry")
const EXPLORER = "https://tiramisu.explorer.arkiv.network"
const LOG = resolve(import.meta.dirname, "../arkiv/seed-transactions.md")

/** Counts `arkiv_query` calls: Tiramisu meters each one (100 cost units) whatever it returns. */
let queries = 0
const countingFetch = (input: string | URL | Request, init?: RequestInit) => {
  if (typeof init?.body === "string") queries += init.body.split('"arkiv_query"').length - 1
  return fetch(input, init)
}
// No automatic retries: a retried query is one more metered query. Re-run instead; every step is idempotent.
const publicClient = createPublicClient({ chain: tiramisu, transport: http(undefined, { retryCount: 0, fetchFn: countingFetch }), cacheTime: 0 })
const walletFor = (account: PrivateKeyAccount) =>
  createWalletClient({ account, chain: tiramisu, transport: http(undefined, { retryCount: 0, timeout: 60_000 }) })

const w = loadWallets()
writeDeployment(w)
const now = Math.floor(Date.now() / 1000)
const UNITS = units()
/** Every wallet that writes in the seed. Entities from anyone else are never read here. */
const OURS = [w.coordinatorA, w.coordinatorB, ...w.observers, w.rogue].map((a) => a.address.toLowerCase())

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

/**
 * Every entity of this election created by one of our wallets, read at one block: elections, units,
 * accreditations, results and corrections. Each step decides from this snapshot in memory, so a full
 * run costs a few queries instead of one per step.
 */
async function snapshot(): Promise<Row[]> {
  const block = await publicClient.getBlockNumber()
  const before = queries
  const { rows } = await fetchAll(publicClient, { where: [eq("election", ELECTION)], creators: OURS, atBlock: block })
  const spent = queries - before
  console.log(`  read ${rows.length} entities of ${ELECTION} from our wallets at block ${block} (${spent} ${spent === 1 ? "query" : "queries"})`)
  return rows
}

const by = (rows: Row[], account: PrivateKeyAccount, ...types: string[]) =>
  rows.filter((r) => r.creator === account.address.toLowerCase() && types.includes(String(r.attrs.type)))

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
  let topUps = 0
  for (const t of targets) {
    const want = t.want
    const have = await publicClient.getBalance({ address: t.address })
    if (have >= want / 2n) continue
    topUps++
    if (DRY) {
      console.log(`  would send ${formatEther(want - have)} GLM to ${t.role}`)
      continue
    }
    const hash = await walletFor(funder).sendTransaction({ to: t.address, value: want - have })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== "success") throw new Error(`Funding ${t.role} failed: ${hash}`)
    log("Coordinator A", `fund ${t.role} with ${formatEther(want - have)} GLM`, hash)
  }
  if (topUps === 0) console.log("  every other wallet holds at least half its target, no top-ups")
}

async function coordinator(rows: Row[], account: PrivateKeyAccount, role: string, accredited: number[]) {
  const election = electionInput(now)
  const mine = by(rows, account, "election", "unit", "accreditation")
  const accreditation = (o: number) => accreditationEntity(ELECTION, w.observers[o]!.address, alias(o), election.closesAt)
  if (!mine.some((r) => r.attrs.type === "election")) {
    const creates = [electionEntity(election), ...UNITS.map(unitEntity), ...accredited.map(accreditation)]
    if (DRY) return console.log(`  ${role}: would create the election, ${UNITS.length} units and ${accredited.length} accreditations (${creates.length} entities, one batch)`)
    try {
      await batch(account, role, `election, ${UNITS.length} units, ${accredited.length} accreditations`, creates)
    } catch (error) {
      if (String(error).includes("unknown")) throw error
      // Never split after a send that may have landed: re-check before writing again.
      if (by(await snapshot(), account, "election").length > 0) throw error
      console.log(`  one batch was refused (${(error as Error).message.split("\n")[0]}); splitting`)
      await chunked(account, role, "election setup", creates, 15)
    }
    return
  }
  // The election exists. Finish a setup that an earlier split run left incomplete.
  const haveUnits = new Set(mine.filter((r) => r.attrs.type === "unit").map((r) => String(r.attrs.unit_code)))
  const haveObservers = new Set(mine.filter((r) => r.attrs.type === "accreditation").map((r) => String(r.attrs.observer)))
  const missing = [
    ...UNITS.filter((u) => !haveUnits.has(u.unitCode)).map(unitEntity),
    ...accredited.filter((o) => !haveObservers.has(w.observers[o]!.address.toLowerCase())).map(accreditation),
  ]
  if (missing.length === 0) return console.log(`  ${role}: election, units and accreditations already on Arkiv, skipping`)
  if (DRY) return console.log(`  ${role}: election exists; would add ${missing.length} missing units or accreditations`)
  await chunked(account, role, "rest of election setup", missing, 15)
}

/** Each observer's first and second counts go in one batch, minus units that observer already reported. */
async function observers(rows: Row[]) {
  console.log("\n3. Observer results")
  const plan = observerResults(now)
  let wrote = false
  for (const [o, account] of w.observers.entries()) {
    const mine = plan.filter((p) => p.observer === o)
    if (mine.length === 0) continue
    const reported = new Set(by(rows, account, "unit_result", "correction").map((r) => String(r.attrs.unit_code)))
    const todo = mine.filter((p) => !reported.has(UNITS[p.unit]!.unitCode))
    if (todo.length === 0) {
      console.log(`  ${alias(o)}: all ${mine.length} results already on Arkiv, skipping`)
      continue
    }
    const second = todo.filter((p) => p.note).length
    const what = `${todo.length} unit results${second ? ` (${second} second ${second === 1 ? "count" : "counts"})` : ""}`
    const already = mine.length > todo.length ? `; ${mine.length - todo.length} already on Arkiv` : ""
    if (DRY) {
      console.log(`  ${alias(o)}: would post ${what}${already}`)
      continue
    }
    await batch(account, alias(o), what, todo.map((p) => resultEntity(result(UNITS[p.unit]!, p.figures, p.submittedAt, p.note))))
    wrote = true
  }
  return wrote
}

async function correction(rows: Row[], observersWrote: boolean) {
  console.log("\n4. Correction")
  const fix = correctionPlan(now)
  const account = w.observers[fix.observer]!
  const unit = UNITS[fix.unit]!
  const at = (list: Row[], type: string) => by(list, account, type).filter((r) => r.attrs.unit_code === unit.unitCode)
  if (at(rows, "correction").length > 0) return console.log(`  ${alias(fix.observer)}: correction already on Arkiv, skipping`)
  let original = at(rows, "unit_result")[0]?.key
  // The original was posted in this run, so the first snapshot cannot have its key: read once more.
  if (!original && observersWrote) original = at(await snapshot(), "unit_result")[0]?.key
  if (!original) {
    if (DRY) return console.log(`  ${alias(fix.observer)}: would correct ${unit.unitCode} once its original is posted`)
    return console.log(`  ${alias(fix.observer)}: original of ${unit.unitCode} not found yet, skipping; re-run to post the correction`)
  }
  if (DRY) return console.log(`  ${alias(fix.observer)}: would correct ${original}`)
  await batch(account, alias(fix.observer), `correction of ${unit.unitCode}`, [correctionEntity(result(unit, fix.figures, fix.submittedAt), original, fix.reason)])
}

async function rogue(rows: Row[]) {
  console.log("\n5. Unaccredited write")
  const bad = roguePlan(now)
  const unit = UNITS[bad.unit]!
  if (by(rows, w.rogue, "unit_result", "correction").length > 0) return console.log("  unaccredited wallet: result already on Arkiv, skipping")
  if (DRY) return console.log(`  unaccredited wallet: would post an inflated result for ${unit.unitCode}`)
  await batch(w.rogue, "Unaccredited", `inflated result for ${unit.unitCode}`, [resultEntity(result(unit, bad.figures, bad.submittedAt, bad.note))])
}

console.log(`Seeding ${ELECTION} on Tiramisu (chain ${tiramisu.id})${DRY ? " — DRY RUN, nothing is written" : ""}`)
await fund()
console.log("\n2. Coordinators")
const rows = await snapshot()
await coordinator(rows, w.coordinatorA, "Coordinator A", ACCREDITED_BY_A)
await coordinator(rows, w.coordinatorB, "Coordinator B", ACCREDITED_BY_B)
const observersWrote = await observers(rows)
await correction(rows, observersWrote)
await rogue(rows)
console.log(`\nArkiv queries: ${queries} (100 cost units each on Tiramisu; balance and nonce reads are not queries).`)
console.log("Done. Public addresses are in apps/web/src/deployment.json; transactions in arkiv/seed-transactions.md.")
