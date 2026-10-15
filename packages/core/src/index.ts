import { createClients, type CollateOptions } from "./client"
import { createPanel } from "./panel"
import { fetchAll, type FetchOptions } from "./query"
import { resolveTrust } from "./trust"
import type { Panel, TrustConfig } from "./types"

export * from "./types"
export { TIRAMISU, createClients, type Clients, type CollateOptions, type Explorer } from "./client"
export { and, createdByAny, eq, gt, gte, lt, lte, or, renderWhere, startsWith, toArkivValue, toExpression, v } from "./where"
export { PAGE_SIZE, fetchAll, fetchMatching, type FetchOptions, type FetchResult } from "./query"
export { buildTrust, partitionByTrust, resolveTrust } from "./trust"
export { aggregate, type AggregateOptions } from "./aggregate"
export { findDisputes } from "./disputes"
export { later, supersede } from "./supersede"
export { watch, type LiveHandlers } from "./live"
export { decodePanel, encodePanel, shareUrl } from "./share"
export { computePanel, createPanel, type PanelHandle } from "./panel"
export { decodeAttr, num, toRow } from "./rows"

/**
 * Entry point: one set of clients, many panels.
 *
 * @example
 * const collate = createCollate()
 * const panel = collate.panel({ title: "Votes by state", query: [eq("type", "unit_result")], groupBy: "state", sum: ["votes_a"], view: "bar", live: true })
 * panel.subscribe((state) => render(state.groups, state.disputes))
 */
export function createCollate(options: CollateOptions = {}) {
  const clients = createClients(options)
  return {
    clients,
    explorer: clients.explorer,
    panel: (config: Panel) => createPanel(clients, config),
    fetchAll: (fetch: FetchOptions) => fetchAll(clients.http, fetch),
    resolveTrust: (trust: TrustConfig, atBlock?: bigint) => resolveTrust(clients.http, trust, atBlock),
  }
}

export type Collate = ReturnType<typeof createCollate>
