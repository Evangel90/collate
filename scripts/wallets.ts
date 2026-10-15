/**
 * Creates fresh testnet wallets in .env (git-ignored) if it does not exist, then prints the PUBLIC
 * addresses and roles. Private keys are never printed.
 */
import { existsSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { generatePrivateKey } from "viem/accounts"
import { writeDeployment } from "./deployment"
import { loadWallets } from "./env"

const ENV_PATH = resolve(import.meta.dirname, "../.env")
const OBSERVERS = 12

if (!existsSync(ENV_PATH)) {
  const lines = [
    "# Fresh Tiramisu testnet wallets for Collate. Never commit this file or reuse these keys.",
    `COORDINATOR_A_PRIVATE_KEY=${generatePrivateKey()}`,
    `COORDINATOR_B_PRIVATE_KEY=${generatePrivateKey()}`,
    `OBSERVER_PRIVATE_KEYS=${Array.from({ length: OBSERVERS }, generatePrivateKey).join(",")}`,
    `ROGUE_PRIVATE_KEY=${generatePrivateKey()}`,
    "",
  ]
  writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 })
  console.log("Created .env with fresh wallets.\n")
}

const w = loadWallets()
writeDeployment(w)
console.log("Role                 Address")
console.log(`Coordinator A        ${w.coordinatorA.address}   (also funds the others)`)
console.log(`Coordinator B        ${w.coordinatorB.address}`)
w.observers.forEach((o, i) => console.log(`Observer ${String(i + 1).padStart(2, "0")}          ${o.address}`))
console.log(`Unaccredited (demo)  ${w.rogue.address}`)
