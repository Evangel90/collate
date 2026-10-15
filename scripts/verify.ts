/**
 * Reproduces Collate's totals from Arkiv with no web app and no Collate code in the trust path
 * beyond @collate/core's pure functions. Prints the exact queries it runs.
 *
 *   npm run verify                         # Observer Group A
 *   npm run verify -- --coordinator 0x…    # any coordinator wallet
 */
import { computePanel, createCollate, renderWhere } from "@collate/core"
import deployment from "../apps/web/src/deployment.json" with { type: "json" }
import { resultsPanel } from "../apps/web/src/model/panels"

const arg = process.argv.indexOf("--coordinator")
const coordinator = (arg > 0 ? process.argv[arg + 1] : deployment.coordinators[0]!.address)!.toLowerCase()
const panel = resultsPanel(deployment.election, coordinator, "state")
const collate = createCollate()

const block = await collate.clients.http.getBlockNumber()
console.log(`Tiramisu block ${block}, coordinator ${coordinator}\n`)

console.log("Q3, trusted observers:")
console.log(`  ${renderWhere(panel.trust!.listQuery)} AND $creator = ${coordinator}`)
const { trust } = await collate.resolveTrust(panel.trust!, block)
for (const m of trust.members.values()) console.log(`  ${m.address}  ${m.label ?? ""}`)

const creators = [...trust.members.keys()]
console.log(`\nQ4 + Q8, results and corrections from those ${creators.length} wallets:`)
console.log(`  ${renderWhere(panel.query)} AND ($creator = … OR …)`)
const { rows } = await collate.fetchAll({ where: panel.query, creators, atBlock: block })
const all = await collate.fetchAll({ where: panel.query, atBlock: block })
console.log(`  ${rows.length} trusted entities; ${all.rows.length - rows.length} from other wallets ignored`)

const out = computePanel(panel, rows)
console.log(`\nCorrections applied: ${out.superseded.length}`)
for (const d of out.disputes) {
  console.log(`Disputed ${d.key}: ${d.entries.map((r) => `${r.creator.slice(0, 8)} a=${r.attrs.votes_a} b=${r.attrs.votes_b} c=${r.attrs.votes_c}`).join("  vs  ")}`)
}
console.log("\nTotals by state (disputed units excluded):")
console.table(
  Object.fromEntries(
    [...out.groups, out.total].map((g) => [g.group, { units: g.count, votes_a: g.sums.votes_a, votes_b: g.sums.votes_b, votes_c: g.sums.votes_c, rejected: g.sums.rejected }]),
  ),
)
process.exit(0)
