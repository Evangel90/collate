import type { Hex } from "viem"
import { aggregate } from "./aggregate"
import { creatorScope } from "./cache"
import type { Clients } from "./client"
import { findConsensus } from "./disputes"
import { describeError } from "./errors"
import { replay, watch } from "./live"
import { fetchAll, fetchMatchingMany, headBlock, type FetchResult } from "./query"
import { supersede } from "./supersede"
import { isSelfRegistration, partitionByTrust, resolveTrust, type TrustRead } from "./trust"
import type { Panel, PanelState, Row, TrustSet } from "./types"

export type PanelHandle = {
  readonly config: Panel
  getState: () => PanelState
  /** Calls `listener` now and on every change. Starts loading (and live updates) on first use. */
  subscribe: (listener: (state: PanelState) => void) => () => void
  /** Reads again at the current head, bypassing the session cache. */
  refresh: () => Promise<void>
  destroy: () => void
}

const EMPTY_TOTAL = { group: "Total", count: 0, sums: {}, min: {}, max: {}, keys: [] }
/** Batching delay for new entities from wallets the panel already scopes to. */
const SCOPED_FLUSH = 250
/**
 * A live panel with no trust list and no `$creator` filter could match any new entity on a busy,
 * shared chain, and Tiramisu charges per query: such panels re-read at most once a minute.
 */
const UNSCOPED_FLUSH = 60_000
/**
 * With a self-registration list, any wallet's write could be a registration, and entity events
 * carry no attributes. Each new wallet's first write is checked, in batches of up to 25 keys at most
 * once a minute: on a busy chain the same few wallets write constantly, so this soon costs nothing.
 */
const REGISTRATION_FLUSH = 60_000
const REGISTRATION_BATCH = 25

/** The pure part of a panel: trusted rows in, totals, consensus and supersessions out. */
export function computePanel(
  config: Panel,
  rows: Row[],
): Pick<PanelState, "current" | "superseded" | "resolved" | "consensus" | "disputes" | "groups" | "total"> {
  const { current, superseded } = config.supersedeField
    ? supersede(rows, config.supersedeField)
    : { current: rows, superseded: [] }
  const { resolved, consensus, disputes } = config.disputeKey
    ? findConsensus(current, config.disputeKey, config.compareFields ?? config.sum ?? [], config.quorum ?? 1)
    : { resolved: current, consensus: [], disputes: [] }
  const { groups, total } = aggregate(resolved, { groupBy: config.groupBy, sum: config.sum })
  return { current, superseded, resolved, consensus, disputes, groups, total }
}

const maxBlock = (a: bigint, b: bigint) => (a > b ? a : b)

/**
 * A live, trust-filtered view of one Arkiv query. Reads go straight to Arkiv's public RPC; there is
 * no indexer or backend in between, so anyone serving the same config sees the same numbers.
 *
 * Reads are metered per query, so a panel spends as few as it can: the first load may be answered
 * by the session cache (and then catches up through the event log, which is not metered), an idle
 * panel makes none, and each burst of new entities from trusted wallets costs one batched re-read.
 */
export function createPanel(clients: Clients, config: Panel): PanelHandle {
  let state: PanelState = {
    status: "loading",
    rows: [],
    current: [],
    superseded: [],
    resolved: [],
    consensus: [],
    disputes: [],
    groups: [],
    total: EMPTY_TOTAL,
    ignored: [],
    live: "off",
    updatedAt: 0,
  }
  const listeners = new Set<(s: PanelState) => void>()
  const roots = new Set((config.trust?.rootCreators ?? []).map((r) => r.toLowerCase()))
  const scope = config.trust ? undefined : creatorScope(config.query)
  let started = false
  let destroyed = false
  let unwatch: (() => void) | undefined
  let inFlight: Promise<void> | undefined
  let again = false
  let wantFresh = false
  let wantMin: bigint | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // The block the trust list was read at: a root's write after it may change who is trusted.
  let trustBlock = -1n
  // New entities are re-read in one batch per flush, at the newest block among them.
  const queued = new Map<Hex, { owner: string; block: bigint }>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let lastFlush = 0
  // Self-registration: the block the registrations were read at, wallets already seen writing
  // since, and their first new entities, waiting to be checked.
  const selfReg = config.trust?.selfRegistration
  let selfBlock = -1n
  const seenOwners = new Set<string>()
  const candidates = new Map<Hex, { owner: string; block: bigint }>()
  let candidateTimer: ReturnType<typeof setTimeout> | undefined
  let lastCandidateFlush = 0

  const set = (patch: Partial<PanelState>) => {
    if (destroyed) return
    state = { ...state, ...patch, updatedAt: Date.now() }
    for (const l of listeners) l(state)
  }

  const recompute = (rows: Row[], ignored = state.ignored, trust = state.trust) =>
    set({ ...computePanel(config, rows), rows, ignored, trust, status: "ready", error: undefined })

  const trusts = (trust: TrustSet | undefined, creator: string) => !trust || trust.members.has(creator)

  /** Reads the snapshot: from the session cache when `atBlock` is unset, else pinned at that block. */
  async function load(atBlock?: bigint) {
    let trust: TrustSet | undefined
    let trustRead: Omit<TrustRead, "trust"> | undefined
    if (config.trust) {
      const t = await resolveTrust(clients.http, config.trust, atBlock)
      trust = t.trust
      trustRead = t
    }
    // A trust list read just now pins the rows to its block, so both are one snapshot.
    const block = atBlock ?? (trustRead && !trustRead.cached ? trustRead.block : undefined)
    const read = (creators?: string[]) => fetchAll(clients.http, { where: config.query, creators, atBlock: block, payload: config.payload })

    let result: FetchResult
    let rows: Row[]
    let ignored: Row[] = []
    if (!trust) {
      result = await read()
      rows = result.rows
    } else if (config.includeIgnored) {
      result = await read()
      ;({ trusted: rows, ignored } = partitionByTrust(result.rows, trust))
    } else {
      result = await read([...trust.members.keys()])
      rows = result.rows
    }
    trustBlock = trustRead?.block ?? result.block
    if (trustRead?.selfBlock !== undefined) selfBlock = trustRead.selfBlock
    set({ block: result.block })
    recompute(rows, ignored, trust)

    // A cached snapshot can be up to a TTL old: replay the event log since then.
    const cachedAt = [trustRead?.cached ? trustRead.block : undefined, result.cached ? result.block : undefined].filter(
      (b): b is bigint => b !== undefined,
    )
    if (config.live && cachedAt.length) void catchUp(cachedAt.reduce((a, b) => (a < b ? a : b)) + 1n)
  }

  async function catchUp(fromBlock: bigint) {
    try {
      const head = await headBlock(clients.http, true)
      if (fromBlock > head || destroyed) return
      await replay(clients.http, fromBlock, { onCreated, onDeleted, onExtended })
    } catch {
      // Without the log the snapshot may be stale, so read it again rather than guess.
      if (!destroyed) void refresh(true)
    }
  }

  /**
   * Coalesces overlapping refreshes: one runs, and one more follows if asked for meanwhile. A fresh
   * refresh reads at the current head (or `minBlock`, if later) and bypasses the session cache.
   */
  function refresh(fresh: boolean, minBlock?: bigint): Promise<void> {
    if (fresh) {
      wantFresh = true
      if (minBlock !== undefined) wantMin = wantMin === undefined ? minBlock : maxBlock(wantMin, minBlock)
    }
    if (inFlight) {
      again = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          again = false
          const fresh = wantFresh
          const min = wantMin
          wantFresh = false
          wantMin = undefined
          const head = fresh ? await headBlock(clients.http, true) : undefined
          await load(head === undefined ? undefined : min === undefined ? head : maxBlock(head, min))
        } while (again && !destroyed)
      } catch (error) {
        const { message, retryAfterSeconds } = describeError(error)
        set({ status: "error", error: message })
        if (retryAfterSeconds !== undefined) {
          // One retry once the budget resets; the session cache may answer it if another panel got there first.
          clearTimeout(retryTimer)
          retryTimer = setTimeout(() => void refresh(false), Math.min(retryAfterSeconds, 900) * 1000)
        }
      } finally {
        inFlight = undefined
      }
    })()
    return inFlight
  }

  const scheduleRefresh = (minBlock?: bigint) => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(true, minBlock), 400)
  }

  function onCreated(key: Hex, owner: string, block: bigint) {
    if (roots.has(owner)) {
      if (block > trustBlock) scheduleRefresh(block) // the trust list may have changed
      return
    }
    if (selfReg && !state.trust?.members.has(owner)) maybeRegistration(key, owner, block)
    // Arkiv is shared and busy: entities from untrusted owners are never re-read live, which keeps
    // an idle viewer of a trusted panel at zero queries. The ignored list comes with each snapshot.
    if (config.trust ? state.trust && !state.trust.members.has(owner) : scope && !scope.has(owner)) return
    queued.set(key, { owner, block })
    if (flushTimer) return
    const wait = config.trust || scope ? SCOPED_FLUSH : Math.max(SCOPED_FLUSH, lastFlush + UNSCOPED_FLUSH - Date.now())
    flushTimer = setTimeout(() => void flush(), wait)
  }

  async function flush() {
    flushTimer = undefined
    if (destroyed) return
    if (config.trust && !state.trust) {
      // Events that arrive while the trust list loads wait for it; a failed load re-reads everything anyway.
      if (state.status === "error") queued.clear()
      else flushTimer = setTimeout(() => void flush(), 500)
      return
    }
    const known = new Set(state.rows.map((r) => r.key))
    const batch = [...queued].filter(([key, e]) => !known.has(key) && trusts(state.trust, e.owner))
    queued.clear()
    if (batch.length === 0) return
    lastFlush = Date.now()
    const block = batch.reduce((m, [, e]) => maxBlock(m, e.block), 0n)
    try {
      // Ask the node which new entities match this panel, then re-check each creator.
      const found = await fetchMatchingMany(clients.http, batch.map(([key]) => key), config.query, config.payload, block)
      const fresh = found.filter((r) => !known.has(r.key) && trusts(state.trust, r.creator))
      if (fresh.length) recompute([...state.rows, ...fresh])
    } catch (error) {
      set({ live: "error", error: describeError(error).message })
    }
  }

  /**
   * Queues a wallet's first entity since the registrations were read, in case it is a registration.
   * Entities at or before that block are already in the snapshot.
   */
  function maybeRegistration(key: Hex, owner: string, block: bigint) {
    if (block <= selfBlock || seenOwners.has(owner)) return
    seenOwners.add(owner)
    candidates.set(key, { owner, block })
    scheduleCandidates()
  }

  function scheduleCandidates() {
    if (candidateTimer || candidates.size === 0) return
    const wait = Math.max(SCOPED_FLUSH, lastCandidateFlush + REGISTRATION_FLUSH - Date.now())
    candidateTimer = setTimeout(() => void flushCandidates(), wait)
  }

  /** One query asks which queued entities are registrations; a valid one re-reads trust and results. */
  async function flushCandidates() {
    candidateTimer = undefined
    if (destroyed || !selfReg) return
    if (!state.trust) {
      if (state.status === "error") candidates.clear()
      else candidateTimer = setTimeout(() => void flushCandidates(), 500)
      return
    }
    for (const [key, e] of candidates) if (e.block <= selfBlock || state.trust.members.has(e.owner)) candidates.delete(key)
    const batch = [...candidates].slice(0, REGISTRATION_BATCH)
    for (const [key] of batch) candidates.delete(key)
    if (batch.length > 0) {
      lastCandidateFlush = Date.now()
      const block = batch.reduce((m, [, e]) => maxBlock(m, e.block), 0n)
      try {
        const found = await fetchMatchingMany(clients.http, batch.map(([key]) => key), selfReg.listQuery, false, block)
        // A registration naming another wallet grants nothing, so it changes nothing here either.
        if (found.some((r) => isSelfRegistration(selfReg, r))) scheduleRefresh(block)
      } catch (error) {
        set({ live: "error", error: describeError(error).message })
      }
    }
    scheduleCandidates() // anything past the batch size waits for the next window
  }

  function onDeleted(key: Hex) {
    if (state.trust && [...state.trust.members.values()].some((m) => m.grantKey === key)) return scheduleRefresh()
    if (state.rows.some((r) => r.key === key)) recompute(state.rows.filter((r) => r.key !== key))
    else if (state.ignored.some((r) => r.key === key)) set({ ignored: state.ignored.filter((r) => r.key !== key) })
  }

  function onExtended(key: Hex, expiresAt: bigint) {
    if (!state.rows.some((r) => r.key === key && r.expiresAt !== expiresAt)) return
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
    void refresh(false)
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
    refresh: () => refresh(true),
    destroy() {
      destroyed = true
      clearTimeout(refreshTimer)
      clearTimeout(flushTimer)
      clearTimeout(candidateTimer)
      clearTimeout(retryTimer)
      unwatch?.()
      listeners.clear()
    },
  }
}
