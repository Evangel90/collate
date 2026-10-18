import { createClients, type CollateOptions } from "./client.js"
import { createPanel } from "./panel.js"
import { fetchAll, type FetchOptions } from "./query.js"
import { resolveTrust } from "./trust.js"
import type { Panel, TrustConfig } from "./types.js"

export * from "./types.js"
export { TIRAMISU, createClients, type Clients, type CollateOptions, type Explorer } from "./client.js"
export { and, createdByAny, eq, gt, gte, lt, lte, or, renderWhere, startsWith, toArkivValue, toExpression, v } from "./where.js"
export { DEFAULT_CACHE_TTL, PAGE_SIZE, headBlock, fetchAll, fetchMatching, fetchMatchingMany, readCacheFor, type FetchOptions, type FetchResult } from "./query.js"
export { covers, createReadCache, creatorScope, type CacheHit, type KeyValueStore, type ReadCache, type ReadSpec } from "./cache.js"
export { RateLimitedError, meter, type ReadBudget } from "./budget.js"
export { buildTrust, isSelfRegistration, partitionByTrust, resolveTrust, type TrustRead } from "./trust.js"
export { aggregate, type AggregateOptions } from "./aggregate.js"
export { findConsensus, findDisputes } from "./disputes.js"
export { later, supersede } from "./supersede.js"
export { replay, watch, type LiveHandlers } from "./live.js"
export { decodePanel, encodePanel, shareUrl } from "./share.js"
export { computePanel, createPanel, type PanelHandle } from "./panel.js"
export { decodeAttr, field, num, toRow } from "./rows.js"
export { describeError, type ReadError } from "./errors.js"

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
