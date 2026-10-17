import { createClients, type CollateOptions } from "./client"
import { createPanel } from "./panel"
import { fetchAll, type FetchOptions } from "./query"
import { resolveTrust } from "./trust"
import type { Panel, TrustConfig } from "./types"

export * from "./types"
export { TIRAMISU, createClients, type Clients, type CollateOptions, type Explorer } from "./client"
export { and, createdByAny, eq, gt, gte, lt, lte, or, renderWhere, startsWith, toArkivValue, toExpression, v } from "./where"
export { DEFAULT_CACHE_TTL, PAGE_SIZE, headBlock, fetchAll, fetchMatching, fetchMatchingMany, readCacheFor, type FetchOptions, type FetchResult } from "./query"
export { covers, createReadCache, type CacheHit, type KeyValueStore, type ReadCache, type ReadSpec } from "./cache"
export { RateLimitedError, meter, type ReadBudget } from "./budget"
export { buildTrust, partitionByTrust, resolveTrust } from "./trust"
export { aggregate, type AggregateOptions } from "./aggregate"
export { findConsensus, findDisputes } from "./disputes"
export { later, supersede } from "./supersede"
export { replay, watch, type LiveHandlers } from "./live"
export { decodePanel, encodePanel, shareUrl } from "./share"
export { computePanel, createPanel, creatorScope, type PanelHandle } from "./panel"
export { decodeAttr, field, num, toRow } from "./rows"
export { describeError, type ReadError } from "./errors"

/**
 * Entry point: one set of clients, many panels.
 *
 * @example
 * const collate = createCollate()
 * const panel = collate.panel({ title: "Votes by state", query: [eq("type", "unit_result")], groupBy: "state", sum: ["votes_a"], view: "bar", live: true })
 * panel.subscribe((state) => render(state.groups, state.consensus))
 */
export function createCollate(options: CollateOptions = {}) {
  const clients = createClients(options)
  return {
    clients,
    explorer: clients.explorer,
    /** Queries sent from this tab and the rate-limit state, for a budget badge or banner. */
    budget: clients.budget,
    panel: (config: Panel) => createPanel(clients, config),
    fetchAll: (fetch: FetchOptions) => fetchAll(clients.http, fetch),
    resolveTrust: (trust: TrustConfig, atBlock?: bigint) => resolveTrust(clients.http, trust, atBlock),
  }
}

export type Collate = ReturnType<typeof createCollate>
