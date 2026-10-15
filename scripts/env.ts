import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts"

const ENV_PATH = resolve(import.meta.dirname, "../.env")
const KEY = /^0x[0-9a-fA-F]{64}$/

/** Reads .env without printing it. Values never leave this process. */
export function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) throw new Error("No .env found. Run `npm run wallets` first.")
  const env: Record<string, string> = {}
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "")
  }
  return { ...env, ...pick(process.env) }
}

function pick(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, value] of Object.entries(source)) if (value && /_PRIVATE_KEYS?$/.test(k)) out[k] = value
  return out
}

function account(value: string | undefined, name: string): PrivateKeyAccount {
  if (!value || !KEY.test(value)) throw new Error(`${name} is missing or not a 32-byte hex key`)
  return privateKeyToAccount(value as `0x${string}`)
}

export type Wallets = {
  coordinatorA: PrivateKeyAccount
  coordinatorB: PrivateKeyAccount
  /** Accredited observers, Observer 01 first. */
  observers: PrivateKeyAccount[]
  /** A wallet nobody accredited, used to show that untrusted writes are ignored. */
  rogue: PrivateKeyAccount
}

export function loadWallets(): Wallets {
  const env = readEnv()
  const observerKeys = (env.OBSERVER_PRIVATE_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean)
  return {
    coordinatorA: account(env.COORDINATOR_A_PRIVATE_KEY, "COORDINATOR_A_PRIVATE_KEY"),
    coordinatorB: account(env.COORDINATOR_B_PRIVATE_KEY, "COORDINATOR_B_PRIVATE_KEY"),
    observers: observerKeys.map((k, i) => account(k, `OBSERVER_PRIVATE_KEYS[${i}]`)),
    rogue: account(env.ROGUE_PRIVATE_KEY, "ROGUE_PRIVATE_KEY"),
  }
}
