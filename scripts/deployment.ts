/** Writes the public half of the deployment (addresses, roles, aliases) for the web app and README. */
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { ACCREDITED_BY_A, ACCREDITED_BY_B, ELECTION, alias } from "./demo-data"
import type { Wallets } from "./env"

export const DEPLOYMENT_PATH = resolve(import.meta.dirname, "../apps/web/src/deployment.json")

export function writeDeployment(w: Wallets) {
  const deployment = {
    network: { name: "Tiramisu", chainId: 7738577 },
    election: ELECTION,
    coordinators: [
      { id: "a", name: "Observer Group A", address: w.coordinatorA.address.toLowerCase(), observers: ACCREDITED_BY_A.map(alias) },
      { id: "b", name: "Observer Group B", address: w.coordinatorB.address.toLowerCase(), observers: ACCREDITED_BY_B.map(alias) },
    ],
    observers: w.observers.map((o, i) => ({ alias: alias(i), address: o.address.toLowerCase() })),
    unaccredited: { alias: "Unaccredited wallet", address: w.rogue.address.toLowerCase() },
  }
  writeFileSync(DEPLOYMENT_PATH, JSON.stringify(deployment, null, 2) + "\n")
  return deployment
}
