/**
 * Reproduces Collate's totals from Arkiv with no web app and no Collate code in the trust path
 * beyond @collate/core's pure functions. Prints the exact queries it runs: two, since Tiramisu meters
 * every query (Q3 for the trusted observers, then Q4′ for every result, split by trust in memory).
 *
 *   npm run verify                         # Observer Group A
 *   npm run verify -- --coordinator 0x…    # any coordinator wallet
 *   npm run verify -- --quorum 2           # require 2 agreeing observers per unit (default 1)
 */
import { computePanel, createCollate, partitionByTrust, renderWhere, type Consensus, type Row } from "@collate/core"
import deployment from "../apps/web/src/deployment.json" with { type: "json" }
import { resultsPanel } from "../apps/web/src/model/panels"

const arg = process.argv.indexOf("--coordinator")
const coordinator = (arg > 0 ? process.argv[arg + 1] : deployment.coordinators[0]!.address)!.toLowerCase()
const q = process.argv.indexOf("--quorum")
const quorum = q > 0 ? Number(process.argv[q + 1]) : 1
const panel = resultsPanel(deployment.election, coordinator, "state", quorum)
const collate = createCollate()

const block = await collate.clients.http.getBlockNumber()
console.log(`Tiramisu block ${block}, coordinator ${coordinator}, quorum ${quorum}\n`)

console.log("Q3, trusted observers:")
console.log(`  ${renderWhere(panel.trust!.listQuery)} AND $creator = ${coordinator}`)
const { trust } = await collate.resolveTrust(panel.trust!, block)
for (const m of trust.members.values()) console.log(`  ${m.address}  ${m.label ?? ""}`)

console.log(`\nQ4′, results and corrections from any wallet (kept only if created by one of those ${trust.members.size}):`)
console.log(`  ${renderWhere(panel.query)}`)
const all = await collate.fetchAll({ where: panel.query, atBlock: block })
const { trusted: rows, ignored } = partitionByTrust(all.rows, trust)
console.log(`  ${rows.length} trusted entities; ${ignored.length} from other wallets ignored`)

const out = computePanel(panel, rows)
const figures = (r: Row) => `${r.creator.slice(0, 8)} a=${r.attrs.votes_a} b=${r.attrs.votes_b} c=${r.attrs.votes_c}`
const by = (status: Consensus["status"]) => out.consensus.filter((c) => c.status === status)
console.log(`\nCorrections applied: ${out.superseded.length}`)
console.log(`Units: ${by("certified").length} certified, ${by("contested").length} contested, ${by("pending").length} pending`)
for (const c of by("certified").filter((c) => c.sources > 1)) {
  const outliers = c.outliers.length ? `; outlier ${c.outliers.map(figures).join(", ")}` : ""
  console.log(`Certified ${c.agreeing.length}/${c.sources} ${c.key}: ${figures(c.agreeing[c.agreeing.length - 1]!)}${outliers}`)
}
for (const c of by("contested")) console.log(`Contested ${c.key}: ${c.entries.map(figures).join("  vs  ")}`)
console.log("\nTotals by state (certified units only):")
console.table(
  Object.fromEntries(
    [...out.groups, out.total].map((g) => [g.group, { units: g.count, votes_a: g.sums.votes_a, votes_b: g.sums.votes_b, votes_c: g.sums.votes_c, rejected: g.sums.rejected }]),
  ),
)
process.exit(0)
