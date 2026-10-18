/**
 * Replays the demo dataset offline through collate-core's computePanel, with no Arkiv reads: the
 * rows the seed would write, in the order it writes them, trust-filtered for each observer group.
 * Shows what the results page should show after a fresh seed, at quorum 1 and 2.
 *
 *   npm run replay
 */
import { computePanel, type Consensus, type Row } from "collate-core"
import type { Hex } from "viem"
import deployment from "../apps/web/src/deployment.json" with { type: "json" }
import { resultsPanel } from "../apps/web/src/model/panels"
import { ELECTION, alias, correctionPlan, observerResults, result, roguePlan, units } from "./demo-data"

const now = Math.floor(Date.now() / 1000)
const UNITS = units()
const address = (o: number) => deployment.observers.find((x) => x.alias === alias(o))!.address as Hex

// One block per batch, as the seed sends them: each observer's results, the correction, the rogue write.
const rows: Row[] = []
let block = 1000n
const push = (creator: Hex, type: string, attrs: Record<string, string | number>) => {
  const key = `0x${(rows.length + 1).toString(16).padStart(64, "0")}` as Hex
  rows.push({
    key,
    creator,
    owner: creator,
    createdAt: block,
    expiresAt: block + 1_000_000n,
    flags: { readonly: true, permissionlessExtension: true },
    attrs: { type, election: ELECTION, ...attrs },
    payload: undefined,
  })
  return key
}
const attrs = (u: number, r: ReturnType<typeof result>) => ({
  unit_code: r.unitCode, ward: r.ward, lga: r.lga, state: r.state,
  votes_a: r.votes_a, votes_b: r.votes_b, votes_c: r.votes_c, rejected: r.rejected, accredited: r.accredited, submitted_at: r.submittedAt,
})

const plan = observerResults(now)
const fix = correctionPlan(now)
let original: Hex | undefined
for (let o = 0; o < deployment.observers.length; o++, block++) {
  for (const p of plan.filter((x) => x.observer === o)) {
    const key = push(address(o), "unit_result", attrs(p.unit, result(UNITS[p.unit]!, p.figures, p.submittedAt, p.note)))
    if (o === fix.observer && p.unit === fix.unit) original = key
  }
}
push(address(fix.observer), "correction", { ...attrs(fix.unit, result(UNITS[fix.unit]!, fix.figures, fix.submittedAt)), corrects: original! })
block++
const bad = roguePlan(now)
push(deployment.unaccredited.address as Hex, "unit_result", attrs(bad.unit, result(UNITS[bad.unit]!, bad.figures, bad.submittedAt, bad.note)))

console.log(`${ELECTION}: ${UNITS.length} units, ${rows.length} result entities (every walk fits one 200-entity page: ${rows.length <= 200})\n`)
const figures = (r: Row) => `${deployment.observers.find((x) => x.address === r.creator)?.alias ?? r.creator} a=${r.attrs.votes_a} b=${r.attrs.votes_b}`
const table: Record<string, Record<string, number>> = {}
for (const group of deployment.coordinators) {
  const trusted = new Set(group.observers.map((a) => deployment.observers.find((x) => x.alias === a)!.address))
  const mine = rows.filter((r) => trusted.has(r.creator))
  for (const quorum of [1, 2]) {
    const out = computePanel(resultsPanel(ELECTION, group.address, "state", quorum), mine)
    const count = (s: Consensus["status"]) => out.consensus.filter((c) => c.status === s).length
    table[`${group.name}, quorum ${quorum}`] = {
      entities: mine.length,
      reported: out.consensus.length,
      certified: count("certified"),
      contested: count("contested"),
      pending: count("pending"),
      corrections: out.superseded.length,
    }
    if (quorum === 1) {
      console.log(`${group.name}, ${mine.length} trusted entities, ${rows.length - mine.length} ignored:`)
      for (const c of out.consensus.filter((c) => c.sources > 1 || c.status !== "certified")) {
        const outliers = c.outliers.length ? `; outlier ${c.outliers.map(figures).join(", ")}` : ""
        const who = c.status === "certified" ? `${c.agreeing.length}/${c.sources}` : c.entries.map(figures).join(" vs ")
        console.log(`  ${c.status.padEnd(9)} ${c.key}  ${who}${outliers}`)
      }
      console.log()
    }
  }
}
console.table(table)
