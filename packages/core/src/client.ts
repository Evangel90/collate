import { createPublicClient, type PublicArkivClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket, type Chain, type Transport } from "viem"
import { meter, type ReadBudget } from "./budget.js"
import { createReadCache, type KeyValueStore, type ReadCache } from "./cache.js"
import { DEFAULT_CACHE_TTL, setReadCache } from "./query.js"

export const TIRAMISU = {
  chain: tiramisu,
  rpcHttp: "https://rpc.tiramisu.db-chain.testnet.arkiv.network",
  rpcWs: "wss://rpc.tiramisu.db-chain.testnet.arkiv.network",
  explorer: "https://tiramisu.explorer.arkiv.network",
} as const

export type CollateOptions = {
  chain?: Chain
  rpcHttp?: string
  rpcWs?: string
  explorer?: string
  /** The HTTP transport to read through instead of `http(rpcHttp)`, e.g. a mock in tests. */
  transport?: Transport
  /**
   * How long (ms) a finished head read may answer identical or narrower reads in this tab.
   * Default 90 s. 0 keeps only the sharing of identical reads in flight.
   */
  cacheTtlMs?: number
  /**
   * Where finished reads persist across reloads, with the same TTL. Defaults to `sessionStorage`
   * when the page has one; `null` keeps the cache in memory.
   */
  storage?: KeyValueStore | null
  /** Called for every `arkiv_query` request sent, each page of a walk counted. */
  onQuery?: (query: string) => void
}

export type Explorer = {
  entity: (key: string) => string
  tx: (hash: string) => string
  address: (address: string) => string
}

export type Clients = {
  chain: Chain
  http: PublicArkivClient
  /** Lazily created WebSocket client, used only for live entity events. */
  ws: () => PublicArkivClient | undefined
  explorer: Explorer
  /** Queries this tab has sent, and whether Tiramisu has said the anonymous budget is spent. */
  budget: ReadBudget
  /** The session read cache behind every `fetchAll` on `http`. */
  cache: ReadCache
}

function sessionStore(): KeyValueStore | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage
  } catch {
    return undefined // blocked storage throws on access
  }
}

export function createClients(options: CollateOptions = {}): Clients {
  const chain = options.chain ?? TIRAMISU.chain
  const rpcHttp = options.rpcHttp ?? TIRAMISU.rpcHttp
  const rpcWs = options.rpcWs ?? (options.chain || options.transport ? undefined : TIRAMISU.rpcWs)
  const base = (options.explorer ?? TIRAMISU.explorer).replace(/\/$/, "")

  // No viem retries: on a 429 viem waits out `Retry-After` (up to 15 min) before failing.
  const { transport, budget } = meter(options.transport ?? http(rpcHttp, { retryCount: 0 }), options.onQuery)
  const httpClient = createPublicClient({ chain, transport, cacheTime: 0 })
  const cache = createReadCache({
    ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL,
    storage: options.storage === null ? undefined : (options.storage ?? sessionStore()),
    namespace: `${chain.id}:${rpcHttp}`,
  })
  setReadCache(httpClient, cache)

  let wsClient: PublicArkivClient | undefined
  return {
    chain,
    http: httpClient,
    ws: () => {
      if (!rpcWs) return undefined
      wsClient ??= createPublicClient({
        chain,
        transport: webSocket(rpcWs, { reconnect: true, keepAlive: true }),
      })
      return wsClient
    },
    explorer: {
      entity: (key) => `${base}/entity/${key}`,
      tx: (hash) => `${base}/tx/${hash}`,
      address: (address) => `${base}/address/${address}`,
    },
    budget,
    cache,
  }
}
