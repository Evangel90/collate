import { createPublicClient, type PublicArkivClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket, type Chain } from "viem"

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
}

export function createClients(options: CollateOptions = {}): Clients {
  const chain = options.chain ?? TIRAMISU.chain
  const rpcHttp = options.rpcHttp ?? TIRAMISU.rpcHttp
  const rpcWs = options.rpcWs ?? (options.chain ? undefined : TIRAMISU.rpcWs)
  const base = (options.explorer ?? TIRAMISU.explorer).replace(/\/$/, "")

  const httpClient = createPublicClient({ chain, transport: http(rpcHttp), cacheTime: 0 })
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
  }
}
