import { ENTITY_EVENTS_ABI, type PublicArkivClient } from "@arkiv-network/sdk"
import type { Hex } from "viem"

export type LiveHandlers = {
  onCreated?: (key: Hex, owner: string, block: bigint) => void
  onDeleted?: (key: Hex) => void
  onExtended?: (key: Hex, expiresAt: bigint) => void
  onError?: (error: Error) => void
}

/** The address every Arkiv entity event is emitted from (not exported by SDK 0.8.1). */
const ARKIV_ADDRESS = "0x4400000000000000000000000000000000000044"

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

/**
 * Delivers the entity events from `fromBlock` to the head, in one `eth_getLogs` call. A panel whose
 * snapshot came from the session cache uses it to catch up on what happened since that snapshot:
 * logs are not metered like `arkiv_query`, so the catch-up itself costs no query.
 */
export async function replay(client: PublicArkivClient, fromBlock: bigint, handlers: LiveHandlers): Promise<void> {
  const logs = await client.getLogs({ address: ARKIV_ADDRESS, events: ENTITY_EVENTS_ABI, fromBlock, toBlock: "latest" })
  for (const log of logs) {
    const block = log.blockNumber ?? fromBlock
    switch (log.eventName) {
      case "EntityCreated":
        handlers.onCreated?.(log.args.entityKey as Hex, String(log.args.owner).toLowerCase(), block)
        break
      case "EntityDeleted":
        handlers.onDeleted?.(log.args.entityKey as Hex)
        break
      case "ExpiryExtended":
        handlers.onExtended?.(log.args.entityKey as Hex, log.args.expiresAt as bigint)
        break
    }
  }
}
