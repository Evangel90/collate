import type { Hex } from "viem"
import { aggregate } from "./aggregate"
import type { Clients } from "./client"
import { findDisputes } from "./disputes"
import { describeError } from "./errors"
import { watch } from "./live"
import { fetchAll, fetchMatchingMany, headBlock } from "./query"
import { supersede } from "./supersede"
import { partitionByTrust, resolveTrust } from "./trust"
import type { Panel, PanelState, Row, TrustSet } from "./types"

export type PanelHandle = {
  readonly config: Panel
  getState: () => PanelState
  /** Calls `listener` now and on every change. Starts loading (and live updates) on first use. */
  subscribe: (listener: (state: PanelState) => void) => () => void
  refresh: () => Promise<void>
  destroy: () => void
}

const EMPTY_TOTAL = { group: "Total", count: 0, sums: {}, min: {}, max: {}, keys: [] }

/** The pure part of a panel: trusted rows in, totals, disputes and supersessions out. */
export function computePanel(
  config: Panel,
  rows: Row[],
): Pick<PanelState, "current" | "superseded" | "resolved" | "disputes" | "groups" | "total"> {
  const { current, superseded } = config.supersedeField
    ? supersede(rows, config.supersedeField)
    : { current: rows, superseded: [] }
  const { resolved, disputes } = config.disputeKey
    ? findDisputes(current, config.disputeKey, config.compareFields ?? config.sum ?? [])
    : { resolved: current, disputes: [] }
  const { groups, total } = aggregate(resolved, { groupBy: config.groupBy, sum: config.sum })
  return { current, superseded, resolved, disputes, groups, total }
}

/**
 * A live, trust-filtered view of one Arkiv query. Reads go straight to Arkiv's public RPC; there is
 * no indexer or backend in between, so anyone serving the same config sees the same numbers.
 */
export function createPanel(clients: Clients, config: Panel): PanelHandle {
  let state: PanelState = {
    status: "loading",
    rows: [],
    current: [],
    superseded: [],
    resolved: [],
    disputes: [],
    groups: [],
    total: EMPTY_TOTAL,
    ignored: [],
    live: "off",
    updatedAt: 0,
  }
  const listeners = new Set<(s: PanelState) => void>()
  let started = false
  let destroyed = false
  let unwatch: (() => void) | undefined
  let inFlight: Promise<void> | undefined
  let again = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // New entities from trusted owners are re-read in one batch per flush.
  const queued = new Set<Hex>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  const set = (patch: Partial<PanelState>) => {
    if (destroyed) return
    state = { ...state, ...patch, updatedAt: Date.now() }
    for (const l of listeners) l(state)
  }

  const recompute = (rows: Row[], ignored = state.ignored, trust = state.trust) =>
    set({ ...computePanel(config, rows), rows, ignored, trust, status: "ready", error: undefined })

  const trusts = (trust: TrustSet | undefined, creator: string) => !trust || trust.members.has(creator)

  async function load() {
    const block = await headBlock(clients.http)
    let trust: TrustSet | undefined
    if (config.trust) trust = (await resolveTrust(clients.http, config.trust, block)).trust

    let rows: Row[]
    let ignored: Row[] = []
    if (!trust) {
      rows = (await fetchAll(clients.http, { where: config.query, atBlock: block, payload: config.payload })).rows
    } else if (config.includeIgnored) {
      const all = (await fetchAll(clients.http, { where: config.query, atBlock: block, payload: config.payload })).rows
      ;({ trusted: rows, ignored } = partitionByTrust(all, trust))
    } else {
      const creators = [...trust.members.keys()]
      rows = (await fetchAll(clients.http, { where: config.query, creators, atBlock: block, payload: config.payload })).rows
    }
    set({ block })
    recompute(rows, ignored, trust)
  }

  /** Coalesces overlapping refreshes: one runs, and one more follows if asked for meanwhile. */
  function refresh(): Promise<void> {
    if (inFlight) {
      again = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          again = false
          await load()
        } while (again && !destroyed)
      } catch (error) {
        const { message, retryAfterSeconds } = describeError(error)
        set({ status: "error", error: message })
        if (retryAfterSeconds !== undefined) {
          clearTimeout(retryTimer)
          retryTimer = setTimeout(() => void refresh(), Math.min(retryAfterSeconds, 900) * 1000)
        }
      } finally {
        inFlight = undefined
      }
    })()
    return inFlight
  }

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 400)
  }

  function onCreated(key: Hex, owner: string) {
    const trust = state.trust
    if (trust?.roots.includes(owner as Hex)) return scheduleRefresh() // the trust list may have changed
    // Arkiv is shared and busy: entities from untrusted owners are never re-read live, which keeps
    // an idle viewer of a trusted panel at zero queries. The ignored list comes with each snapshot.
    if (trust && !trust.members.has(owner)) return
    queued.add(key)
    // Without a trust list any event could match, so batch those more slowly.
    flushTimer ??= setTimeout(() => void flush(), trust ? 250 : 5000)
  }

  async function flush() {
    flushTimer = undefined
    const known = new Set(state.rows.map((r) => r.key))
    const keys = [...queued].filter((k) => !known.has(k))
    queued.clear()
    if (keys.length === 0 || destroyed) return
    try {
      // Ask the node which new entities match this panel, then re-check each creator.
      const found = await fetchMatchingMany(clients.http, keys, config.query, config.payload)
      const fresh = found.filter((r) => !known.has(r.key) && trusts(state.trust, r.creator))
      if (fresh.length) recompute([...state.rows, ...fresh])
    } catch (error) {
      set({ live: "error", error: describeError(error).message })
    }
  }

  function onDeleted(key: Hex) {
    if (state.trust && [...state.trust.members.values()].some((m) => m.grantKey === key)) return scheduleRefresh()
    if (state.rows.some((r) => r.key === key)) recompute(state.rows.filter((r) => r.key !== key))
    else if (state.ignored.some((r) => r.key === key)) set({ ignored: state.ignored.filter((r) => r.key !== key) })
  }

  function onExtended(key: Hex, expiresAt: bigint) {
    if (!state.rows.some((r) => r.key === key)) return
    recompute(state.rows.map((r) => (r.key === key ? { ...r, expiresAt } : r)))
  }

  function startLive() {
    const client = clients.ws() ?? clients.http
    set({ live: "connecting" })
    try {
      unwatch = watch(client, {
        onCreated,
        onDeleted,
        onExtended,
        onError: (error) => set({ live: "error", error: error.message }),
      })
      set({ live: "live" })
    } catch (error) {
      set({ live: "error", error: error instanceof Error ? error.message : String(error) })
    }
  }

  function start() {
    if (started) return
    started = true
    if (config.live) startLive() // watch first, so nothing lands between snapshot and subscription
    void refresh()
  }

  return {
    config,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      start()
      return () => listeners.delete(listener)
    },
    refresh,
    destroy() {
      destroyed = true
      clearTimeout(refreshTimer)
      clearTimeout(flushTimer)
      clearTimeout(retryTimer)
      unwatch?.()
      listeners.clear()
    },
  }
}
