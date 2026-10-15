import type { PublicArkivClient } from "@arkiv-network/sdk"
import type { Hex } from "viem"

export type LiveHandlers = {
  onCreated?: (key: Hex, owner: string, block: bigint) => void
  onDeleted?: (key: Hex) => void
  onExtended?: (key: Hex, expiresAt: bigint) => void
  onError?: (error: Error) => void
}

/**
 * Subscribes to entity events from the head onwards. Pass a client on a WebSocket transport for
 * push delivery; over HTTP the SDK falls back to polling. No `fromBlock` is set on purpose: with
 * one, viem replays history through `eth_getLogs` instead of subscribing.
 */
export function watch(client: PublicArkivClient, handlers: LiveHandlers): () => void {
  return client.watchEntityEvents({
    onEntityCreated: (e) => handlers.onCreated?.(e.entityKey, e.owner.toLowerCase(), e.blockNumber),
    onEntityDeleted: (e) => handlers.onDeleted?.(e.entityKey),
    onExpiryExtended: (e) => handlers.onExtended?.(e.entityKey, e.expiresAt),
    onError: (error) => handlers.onError?.(error),
  })
}
