import type { Hex } from "viem"
import { aggregate } from "./aggregate"
import type { Clients } from "./client"
import { findDisputes } from "./disputes"
import { watch } from "./live"
import { fetchAll, fetchMatchingMany } from "./query"
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
  // New entities are re-read in batches: quickly for trusted owners, lazily for everyone else.
  const queued = { fast: new Set<Hex>(), slow: new Set<Hex>() }
  const timers: { fast?: ReturnType<typeof setTimeout>; slow?: ReturnType<typeof setTimeout> } = {}

  const set = (patch: Partial<PanelState>) => {
    if (destroyed) return
    state = { ...state, ...patch, updatedAt: Date.now() }
    for (const l of listeners) l(state)
  }

  const recompute = (rows: Row[], ignored = state.ignored, trust = state.trust) =>
    set({ ...computePanel(config, rows), rows, ignored, trust, status: "ready", error: undefined })

  const trusts = (trust: TrustSet | undefined, creator: string) => !trust || trust.members.has(creator)

  async function load() {
    const block = await clients.http.getBlockNumber({ cacheTime: 0 })
    let trust: TrustSet | undefined
    if (config.trust) trust = (await resolveTrust(clients.http, config.trust, block)).trust

    let rows: Row[]
    let ignored: Row[] = []
    if (!trust) {
      rows = (await fetchAll(clients.http, { where: config.query, atBlock: block })).rows
    } else if (config.includeIgnored) {
      const all = (await fetchAll(clients.http, { where: config.query, atBlock: block })).rows
      ;({ trusted: rows, ignored } = partitionByTrust(all, trust))
    } else {
      const creators = [...trust.members.keys()]
      rows = (await fetchAll(clients.http, { where: config.query, creators, atBlock: block })).rows
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
        set({ status: "error", error: error instanceof Error ? error.message : String(error) })
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
    const lane = trusts(trust, owner) ? "fast" : config.includeIgnored ? "slow" : undefined
    if (!lane) return
    queued[lane].add(key)
    timers[lane] ??= setTimeout(() => void flush(lane), lane === "fast" ? 250 : 3000)
  }

  async function flush(lane: "fast" | "slow") {
    timers[lane] = undefined
    const known = new Set([...state.rows, ...state.ignored].map((r) => r.key))
    const keys = [...queued[lane]].filter((k) => !known.has(k))
    queued[lane].clear()
    if (keys.length === 0 || destroyed) return
    try {
      // Ask the node which new entities match this panel, then re-check each creator.
      const found = await fetchMatchingMany(clients.http, keys, config.query)
      const fresh = found.filter((r) => !state.rows.some((x) => x.key === r.key) && !state.ignored.some((x) => x.key === r.key))
      const trusted = fresh.filter((r) => trusts(state.trust, r.creator))
      const ignored = config.includeIgnored ? fresh.filter((r) => !trusts(state.trust, r.creator)) : []
      if (trusted.length) recompute([...state.rows, ...trusted], [...state.ignored, ...ignored])
      else if (ignored.length) set({ ignored: [...state.ignored, ...ignored] })
    } catch (error) {
      set({ live: "error", error: error instanceof Error ? error.message : String(error) })
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
      clearTimeout(timers.fast)
      clearTimeout(timers.slow)
      unwatch?.()
      listeners.clear()
    },
  }
}
