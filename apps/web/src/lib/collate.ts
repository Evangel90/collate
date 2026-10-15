import { createCollate } from "@collate/core"
import deploymentJson from "../deployment.json"

export type Coordinator = { id: string; name: string; address: string; observers: string[] }
export type Deployment = {
  network: { name: string; chainId: number }
  election: string
  coordinators: Coordinator[]
  observers: { alias: string; address: string }[]
  unaccredited: { alias: string; address: string }
}

export const deployment = deploymentJson as Deployment

/** One set of public Arkiv clients for the whole app. Reads need no wallet and no Collate server. */
export const collate = createCollate()

const names = new Map<string, string>([
  ...deployment.observers.map((o) => [o.address, o.alias] as const),
  ...deployment.coordinators.map((c) => [c.address, c.name] as const),
  [deployment.unaccredited.address, deployment.unaccredited.alias],
])

/** Synthetic alias for a known demo wallet, if any. */
export const nameOf = (address: string) => names.get(address.toLowerCase())

/** Viewer preferences stay in this browser, never on Arkiv. */
export const prefs = {
  get(key: string): string | undefined {
    try {
      return localStorage.getItem(`collate:${key}`) ?? undefined
    } catch {
      return undefined
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`collate:${key}`, value)
    } catch {
      /* private mode or blocked storage: the choice just is not remembered */
    }
  },
}
