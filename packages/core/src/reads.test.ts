/**
 * Query budget tests: a mocked Tiramisu (in-memory entities, a small parser for the query text the
 * SDK sends, snapshots by block, event logs) counts every `arkiv_query`, so each page flow of the
 * app can be checked for how many metered queries it costs.
 */
import { ENTITY_EVENTS_ABI, type PublicArkivClient } from "@arkiv-network/sdk"
import { custom, encodeAbiParameters, encodeEventTopics, numberToHex, stringToHex, type Address, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import { covers, type KeyValueStore, type ReadSpec } from "./cache"
import { createClients, type Clients, type CollateOptions } from "./client"
import { createPanel, type PanelHandle } from "./panel"
import { fetchAll } from "./query"
import type { Panel, PanelState, Row, Where } from "./types"
import { eq, gt, or, v } from "./where"

type Attr = string | number
type Ent = { key: Hex; creator: Address; createdAt: bigint; attrs: Record<string, Attr>; payload?: unknown }

const hex64 = (n: number | bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address

/* ---------- A tiny Tiramisu ---------- */

type Match = (e: Ent) => boolean

/** Parses the subset of the query language the SDK renders: comparisons, AND, OR, parentheses. */
function parse(query: string): Match {
  const re = /\s*(\(|\)|AND\b|OR\b|([$\w]+)\s*(=|!=|>=|<=|>|<)\s*(\w+)\(('(?:[^']|'')*'|[^)]*)\))/y
  const tokens: RegExpExecArray[] = []
  for (let m = re.exec(query); m; m = re.exec(query)) tokens.push(m)
  let i = 0
  const compare = (t: RegExpExecArray): Match => {
    const [, , field, op, type, raw] = t as unknown as [string, string, string, string, string, string]
    const value: Attr = type === "str" ? raw.slice(1, -1).replace(/''/g, "'") : type === "u64" ? Number(raw) : raw.toLowerCase()
    return (e) => {
      const actual = field === "$creator" || field === "$owner" ? e.creator : field === "$key" ? e.key : e.attrs[field]
      if (actual === undefined) return false
      switch (op) {
        case "=":
          return actual === value
        case ">":
          return actual > value
        case "<":
          return actual < value
        default:
          throw new Error(`mock: no ${op}`)
      }
    }
  }
  const factor = (): Match => {
    const t = tokens[i++]!
    if (t[1] === "(") {
      const inner = expr()
      i++ // ")"
      return inner
    }
    return compare(t)
  }
  const term = (): Match => {
    let left = factor()
    while (tokens[i]?.[1] === "AND") {
      i++
      const [l, r] = [left, factor()]
      left = (e) => l(e) && r(e)
    }
    return left
  }
  function expr(): Match {
    let left = term()
    while (tokens[i]?.[1] === "OR") {
      i++
      const [l, r] = [left, term()]
      left = (e) => l(e) || r(e)
    }
    return left
  }
  return expr()
}

function rpcEntity(e: Ent) {
  return {
    key: e.key,
    owner: e.creator,
    creator: e.creator,
    createdAt: numberToHex(e.createdAt),
    updatedAt: numberToHex(e.createdAt),
    expiresAt: numberToHex(e.createdAt + 100_000n),
    creationFlags: 0,
    contentType: "application/json",
    payload: e.payload === undefined ? undefined : stringToHex(JSON.stringify(e.payload)),
    attributes: Object.entries(e.attrs).map(([name, value]) => ({ name, type: typeof value === "number" ? "u64" : "str", value: String(value) })),
  }
}

function createdLog(e: Ent) {
  return {
    address: "0x4400000000000000000000000000000000000044",
    topics: encodeEventTopics({ abi: ENTITY_EVENTS_ABI, eventName: "EntityCreated", args: { entityKey: e.key, owner: e.creator } }),
    data: encodeAbiParameters([{ type: "uint64" }, { type: "uint8" }], [e.createdAt + 100_000n, 0]),
    blockNumber: numberToHex(e.createdAt),
    blockHash: hex64(e.createdAt),
    transactionHash: hex64(e.createdAt),
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  }
}

function mockChain() {
  const entities: Ent[] = []
  const calls: string[] = []
  const queries: string[] = []
  let head = 1_000n
  let limitedFor = 0
  let n = 0

  const transport = custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        calls.push(method)
        if (method === "eth_blockNumber") return numberToHex(head)
        if (method === "eth_chainId") return numberToHex(60138453056)
        if (method === "eth_getLogs") {
          const [filter] = params as [{ fromBlock: Hex; toBlock: Hex | "latest" }]
          const to = filter.toBlock === "latest" ? head : BigInt(filter.toBlock)
          return entities.filter((e) => e.createdAt >= BigInt(filter.fromBlock) && e.createdAt <= to).map(createdLog)
        }
        if (method !== "arkiv_query") throw new Error(`mock: unexpected ${method}`)
        const [query, options] = params as [string, { atBlock?: Hex; limit?: Hex; cursor?: string }]
        if (limitedFor > 0) {
          throw Object.assign(new Error("HTTP request failed."), {
            name: "HttpRequestError",
            status: 429,
            headers: new Headers({ "retry-after": String(limitedFor) }),
          })
        }
        queries.push(query)
        const at = options.atBlock ? BigInt(options.atBlock) : head
        const match = parse(query)
        const all = entities.filter((e) => e.createdAt <= at && match(e))
        const offset = Number(options.cursor ?? 0)
        const limit = Number(options.limit ?? 200)
        return {
          data: all.slice(offset, offset + limit).map(rpcEntity),
          blockNumber: numberToHex(at),
          cursor: offset + limit < all.length ? String(offset + limit) : undefined,
        }
      },
    },
    { retryCount: 0 },
  )

  return {
    transport,
    calls,
    queries,
    /** Metered queries sent so far. */
    count: () => queries.length,
    get head() {
      return head
    },
    /** Writes an entity in a new block. */
    add(creator: Address, attrs: Record<string, Attr>, payload?: unknown): Ent {
      n += 1
      head += 1n
      const e = { key: hex64(n), creator, createdAt: head, attrs, payload }
      entities.push(e)
      return e
    },
    /** Deletes an entity (or lets it expire) in a new block. */
    remove(key: Hex) {
      head += 1n
      entities.splice(entities.findIndex((e) => e.key === key), 1)
    },
    limit(seconds: number) {
      limitedFor = seconds
    },
  }
}

/* ---------- The demo, in miniature ---------- */

const E = "test-election"
const CA = addr(0xa1)
const CB = addr(0xb1)
const [O1, O2, O3, O4] = [addr(0x01), addr(0x02), addr(0x03), addr(0x04)]
const STRANGER = addr(0x99)

function seed(chain: ReturnType<typeof mockChain>) {
  for (const c of [CA, CB]) {
    chain.add(c, { type: "election", election: E }, { name: "Test election", quorum: 1 })
    for (const u of ["U1", "U2", "U3", "U4"]) chain.add(c, { type: "unit", election: E, unit_code: u, state: u < "U3" ? "S1" : "S2", registered: 100 }, { name: u })
  }
  for (const o of [O1, O2, O3]) chain.add(CA, { type: "accreditation", election: E, observer: o }, { alias: o })
  for (const o of [O3, O4]) chain.add(CB, { type: "accreditation", election: E, observer: o }, { alias: o })
  const result = (o: Address, unit: string, a: number, rejected = 2) =>
    chain.add(o, { type: "unit_result", election: E, unit_code: unit, state: unit < "U3" ? "S1" : "S2", votes_a: a, votes_b: 10, votes_c: 5, rejected, accredited: 200, submitted_at: 1_700_000_000 })
  result(O1, "U1", 50, 9)
  result(O2, "U1", 50, 9)
  result(O3, "U2", 70)
  result(O4, "U3", 80, 12)
  result(STRANGER, "U4", 999)
  chain.add(O1, { type: "unit_result", election: "other", unit_code: "U1", votes_a: 1 })
  return { result }
}

// The app's configs (apps/web/src/model/panels.ts and lib/data.ts), restated so core stays standalone.
const resultTypes = or(eq("type", "unit_result"), eq("type", "correction"))
const trustFor = (coordinator: Address) => ({ rootCreators: [coordinator], listQuery: [eq("type", "accreditation"), eq("election", E)], addressField: "observer" })
const resultsPanel = (coordinator: Address, extra: Partial<Panel> = {}): Panel => ({
  title: "Votes by state",
  query: [resultTypes, eq("election", E)],
  trust: trustFor(coordinator),
  supersedeField: "corrects",
  disputeKey: "unit_code",
  groupBy: "state",
  sum: ["votes_a", "votes_b", "votes_c", "rejected", "accredited"],
  view: "bar",
  live: true,
  includeIgnored: true,
  ...extra,
})
/** Q1+Q2+Q3 for every coordinator on the page, in one query. */
const electionReads = (coordinators: Address[]) => ({
  where: [or(eq("type", "election"), eq("type", "unit"), eq("type", "accreditation")), eq("election", E)],
  creators: coordinators,
  payload: true,
})
const landingStat = { where: [resultTypes, eq("election", E)] }

/* ---------- Harness ---------- */

type Live = {
  onEntityCreated?: (e: { entityKey: Hex; owner: Address; blockNumber: bigint }) => void
  onEntityDeleted?: (e: { entityKey: Hex }) => void
}

function setup(options: CollateOptions = {}) {
  const chain = mockChain()
  const data = seed(chain)
  const watchers = new Set<Live>()
  const ws = {
    watchEntityEvents: (handlers: Live) => {
      watchers.add(handlers)
      return () => watchers.delete(handlers)
    },
  } as unknown as PublicArkivClient
  const make = (more: CollateOptions = {}): Clients => ({ ...createClients({ transport: chain.transport, storage: null, ...options, ...more }), ws: () => ws })
  const clients = make()
  const emit = (e: Ent) => {
    for (const w of watchers) w.onEntityCreated?.({ entityKey: e.key, owner: e.creator, blockNumber: e.createdAt })
  }
  const emitDeleted = (e: Ent) => {
    chain.remove(e.key)
    for (const w of watchers) w.onEntityDeleted?.({ entityKey: e.key })
  }
  return { chain, data, clients, make, emit, emitDeleted }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function loaded(handle: PanelHandle): Promise<PanelState> {
  handle.subscribe(() => undefined)
  for (let i = 0; i < 200; i++) {
    const s = handle.getState()
    if (s.status !== "loading") return s
    await sleep(5)
  }
  throw new Error("panel never loaded")
}

const creators = (rows: Row[]) => [...new Set(rows.map((r) => r.creator))].sort()

/* ---------- Tests ---------- */

describe("query budget: Results page", () => {
  it("first load costs 2 queries: the election, units and accreditations in one, the results in another", async () => {
    const { chain, clients } = setup()
    const election = await fetchAll(clients.http, electionReads([CA, CB]))
    const state = await loaded(createPanel(clients, resultsPanel(CA)))
    expect(chain.count()).toBe(2)
    expect(clients.budget.queries).toBe(2)
    expect(election.rows.filter((r) => r.attrs.type === "unit")).toHaveLength(8)
    expect([...state.trust!.members.keys()].sort()).toEqual([O1, O2, O3])
    expect(creators(state.rows)).toEqual([O1, O2, O3])
    expect(creators(state.ignored)).toEqual([O4, STRANGER])
    expect(state.total.sums.votes_a).toBe(50 + 70)
  })

  it("React StrictMode's mount, unmount, mount shares the same reads", async () => {
    const { chain, clients } = setup()
    void fetchAll(clients.http, electionReads([CA, CB]))
    const first = createPanel(clients, resultsPanel(CA))
    first.subscribe(() => undefined)
    first.destroy()
    void fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    expect(chain.count()).toBe(2)
  })

  it("switching Group A to B and back costs no query", async () => {
    const { chain, clients } = setup()
    await fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    await fetchAll(clients.http, electionReads([CA, CB]))
    const b = await loaded(createPanel(clients, resultsPanel(CB)))
    await loaded(createPanel(clients, resultsPanel(CA)))
    expect(chain.count()).toBe(2)
    expect([...b.trust!.members.keys()].sort()).toEqual([O3, O4])
    expect(creators(b.rows)).toEqual([O3, O4])
    expect(creators(b.ignored)).toEqual([O1, O2, STRANGER])
  })

  it("'Open in Studio' with another grouping and quorum reuses the page's reads", async () => {
    const { chain, clients } = setup()
    await fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    const studio = await loaded(createPanel(clients, resultsPanel(CA, { groupBy: "ward", quorum: 2 })))
    expect(chain.count()).toBe(2)
    expect(studio.consensus.find((c) => c.key === "U1")?.status).toBe("certified")
  })

  it("the landing stat and the results page share the results read", async () => {
    const { chain, clients } = setup()
    const stat = await fetchAll(clients.http, landingStat)
    expect(stat.rows.filter((r) => r.attrs.type === "unit_result")).toHaveLength(5)
    await fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    expect(chain.count()).toBe(2)
  })

  it("the high-rejected range query always reaches Arkiv, once", async () => {
    const { chain, clients } = setup()
    await fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    const suspicious = await loaded(
      createPanel(clients, { title: "High rejected", query: [resultTypes, eq("election", E), gt("rejected", v.u64(5))], trust: trustFor(CA), view: "table" }),
    )
    expect(chain.count()).toBe(3)
    expect(chain.queries.at(-1)).toContain("rejected > u64(5)")
    expect(suspicious.rows.map((r) => r.attrs.unit_code)).toEqual(["U1", "U1"])
  })
})

describe("query budget: other pages", () => {
  it("Studio's polling-units preset after the results page costs no query", async () => {
    const { chain, clients } = setup()
    await fetchAll(clients.http, electionReads([CA, CB]))
    const units = await loaded(
      createPanel(clients, { title: "Polling units", query: [eq("type", "unit"), eq("election", E), eq("$creator", v.addr(CA))], groupBy: "state", sum: ["registered"], view: "table" }),
    )
    expect(chain.count()).toBe(1)
    expect(units.rows).toHaveLength(4)
    expect(units.total.sums.registered).toBe(400)
  })

  it("Observer page: 2 queries, accreditations (Q9) answered from the setup read", async () => {
    const { chain, clients } = setup()
    void fetchAll(clients.http, electionReads([CA, CB]))
    const [acc] = await Promise.all([
      fetchAll(clients.http, { where: [eq("type", "accreditation"), eq("election", E), eq("observer", O3)], creators: [CA, CB] }),
      fetchAll(clients.http, { where: [eq("election", E)], creators: [O3] }),
    ])
    await fetchAll(clients.http, electionReads([CA, CB])) // the form's useElection
    expect(chain.count()).toBe(2)
    expect(creators(acc.rows)).toEqual([CA, CB])
  })

  it("Coordinator console: one setup read, and its results panel resolves trust from it", async () => {
    const { chain, clients } = setup()
    const { rows } = await fetchAll(clients.http, electionReads([CA]))
    expect(rows.filter((r) => r.attrs.type === "accreditation")).toHaveLength(3)
    await loaded(createPanel(clients, resultsPanel(CA, { includeIgnored: false })))
    expect(chain.count()).toBe(2)
  })

  it("Coordinator console right after that group's results page costs no query", async () => {
    const { chain, clients } = setup()
    await fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    await fetchAll(clients.http, electionReads([CA]))
    const mine = await loaded(createPanel(clients, resultsPanel(CA, { includeIgnored: false })))
    expect(chain.count()).toBe(2)
    expect(creators(mine.rows)).toEqual([O1, O2, O3])
  })
})

describe("query budget: live updates", () => {
  it("an idle page makes no queries, and an untrusted write costs none", async () => {
    const { chain, clients, emit } = setup()
    await loaded(createPanel(clients, resultsPanel(CA)))
    const before = chain.count()
    emit(chain.add(STRANGER, { type: "unit_result", election: E, unit_code: "U2", votes_a: 1 }))
    emit(chain.add(addr(0x77), { type: "something", app: "another app" }))
    await sleep(400)
    expect(chain.count()).toBe(before)
  })

  it("a burst of trusted writes costs one batched re-read, at the block they landed in", async () => {
    const { chain, clients, data, emit } = setup()
    const handle = createPanel(clients, resultsPanel(CA))
    await loaded(handle)
    const before = chain.count()
    emit(data.result(O1, "U3", 81))
    emit(data.result(O2, "U4", 40))
    await sleep(400)
    expect(chain.count()).toBe(before + 1)
    expect(chain.queries.at(-1)).toContain("$key = key(")
    expect(handle.getState().rows.map((r) => r.attrs.unit_code).sort()).toEqual(["U1", "U1", "U2", "U3", "U4"])
  })

  it("a cached snapshot catches up through the event log, so it never hides a newer write", async () => {
    const { chain, clients, data } = setup()
    await loaded(createPanel(clients, resultsPanel(CA)))
    const late = data.result(O3, "U4", 33) // lands after the snapshot was cached
    const before = chain.count()
    const second = createPanel(clients, resultsPanel(CA))
    await loaded(second)
    await sleep(400)
    expect(chain.calls).toContain("eth_getLogs")
    expect(chain.count()).toBe(before + 1) // only the re-read of the one new entity
    expect(second.getState().rows.some((r) => r.key === late.key)).toBe(true)
  })

  it("a new accreditation from the coordinator re-reads trust and results, bypassing the cache", async () => {
    const { chain, clients, emit } = setup()
    const handle = createPanel(clients, resultsPanel(CA))
    await loaded(handle)
    const before = chain.count()
    emit(chain.add(CA, { type: "accreditation", election: E, observer: O4 }, { alias: "O4" }))
    await sleep(700)
    expect(chain.count()).toBe(before + 2)
    expect(handle.getState().trust!.members.has(O4)).toBe(true)
    expect(creators(handle.getState().rows)).toEqual([O1, O2, O3, O4])
  })
})

describe("self-registration: the Open sandbox", () => {
  const T1 = addr(0x71)
  const T2 = addr(0x72)
  const FORGER = addr(0x73)
  const registration = (observer: Address, alias = "Tester") => [{ type: "sandbox_registration", election: E, observer }, { alias }] as const
  const sandboxPanel = (): Panel =>
    resultsPanel(CA, {
      trust: {
        ...trustFor(CA),
        selfRegistration: { listQuery: [eq("type", "sandbox_registration"), eq("election", E)], addressField: "observer" },
      },
    })

  it("switching from Group A to the sandbox costs one query: the registrations", async () => {
    const { chain, clients, data } = setup()
    chain.add(T1, ...registration(T1, "Tester 0071"))
    chain.add(FORGER, ...registration(O4)) // names someone else: grants nothing
    data.result(T1, "U4", 60)
    await fetchAll(clients.http, electionReads([CA, CB]))
    await loaded(createPanel(clients, resultsPanel(CA)))
    const sandbox = await loaded(createPanel(clients, sandboxPanel()))
    expect(chain.count()).toBe(3)
    expect(chain.queries.at(-1)).toContain("sandbox_registration")
    expect([...sandbox.trust!.members.keys()].sort()).toEqual([O1, O2, O3, T1])
    expect(sandbox.trust!.members.get(T1)).toMatchObject({ selfRegistered: true, label: "Tester 0071", via: T1 })
    expect(creators(sandbox.rows)).toEqual([O1, O2, O3, T1])
    expect(creators(sandbox.ignored)).toEqual([O4, STRANGER])
  })

  it("a new registration adds the member live: one check, then trust and results read fresh", async () => {
    const { chain, clients, data, emit } = setup()
    const handle = createPanel(clients, sandboxPanel())
    await loaded(handle)
    const before = chain.count()
    emit(chain.add(T2, ...registration(T2)))
    await sleep(900)
    expect(chain.count()).toBe(before + 4) // the check, then accreditations, registrations and results
    expect(handle.getState().trust!.members.get(T2)?.selfRegistered).toBe(true)
    // From then on the member's results arrive like any trusted observer's: one re-read per burst.
    emit(data.result(T2, "U4", 61))
    await sleep(400)
    expect(chain.count()).toBe(before + 5)
    expect(creators(handle.getState().rows)).toContain(T2)
  })

  it("a forged registration costs one check and changes nothing; that wallet is not checked again", async () => {
    const { chain, clients, emit } = setup()
    const handle = createPanel(clients, sandboxPanel())
    await loaded(handle)
    const before = chain.count()
    emit(chain.add(FORGER, ...registration(O4)))
    await sleep(700)
    expect(chain.count()).toBe(before + 1)
    expect(handle.getState().trust!.members.has(O4)).toBe(false)
    emit(chain.add(FORGER, ...registration(FORGER)))
    await sleep(400)
    expect(chain.count()).toBe(before + 1)
  })

  it("a deleted or expired registration removes the member, as a revoked accreditation does", async () => {
    const { chain, clients, data, emitDeleted } = setup()
    const own = chain.add(T1, ...registration(T1))
    data.result(T1, "U4", 60)
    const handle = createPanel(clients, sandboxPanel())
    await loaded(handle)
    expect(handle.getState().trust!.members.has(T1)).toBe(true)
    emitDeleted(own)
    await sleep(700)
    expect(handle.getState().trust!.members.has(T1)).toBe(false)
    expect(creators(handle.getState().ignored)).toContain(T1)
  })
})

describe("query budget: session cache", () => {
  it("survives a reload through storage, bigints included", async () => {
    const store = new Map<string, string>()
    const storage: KeyValueStore = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    }
    const { chain, make } = setup()
    const first = make({ storage })
    await fetchAll(first.http, electionReads([CA, CB]))
    await loaded(createPanel(first, resultsPanel(CA)))
    expect(chain.count()).toBe(2)
    const reloaded = make({ storage })
    const state = await loaded(createPanel(reloaded, resultsPanel(CB)))
    expect(chain.count()).toBe(2)
    expect(typeof state.rows[0]!.createdAt).toBe("bigint")
    expect(reloaded.budget.queries).toBe(0)
  })

  it("expires after the TTL", async () => {
    const { chain, clients } = setup({ cacheTtlMs: 30 })
    await fetchAll(clients.http, landingStat)
    await fetchAll(clients.http, landingStat)
    expect(chain.count()).toBe(1)
    await sleep(60)
    await fetchAll(clients.http, landingStat)
    expect(chain.count()).toBe(2)
  })

  it("`fresh` reads past the cache", async () => {
    const { chain, clients } = setup()
    await fetchAll(clients.http, landingStat)
    await fetchAll(clients.http, { ...landingStat, fresh: true })
    expect(chain.count()).toBe(2)
  })

  it("counts every page of a long walk", async () => {
    const { chain, clients } = setup()
    for (let i = 0; i < 450; i++) chain.add(O1, { type: "unit_result", election: "big", unit_code: `B${i}` })
    const { rows } = await fetchAll(clients.http, { where: [eq("type", "unit_result"), eq("election", "big")] })
    expect(rows).toHaveLength(450)
    expect(clients.budget.queries).toBe(3)
  })
})

describe("query budget: 429", () => {
  it("records Retry-After once and refuses further queries locally until then", async () => {
    const { chain, clients } = setup()
    chain.limit(120)
    const state = await loaded(createPanel(clients, resultsPanel(CA)))
    expect(state.status).toBe("error")
    expect(state.error).toMatch(/resets in about 2 min/)
    const until = clients.budget.limitedUntil!
    expect(until - Date.now()).toBeGreaterThan(100_000)
    const sent = chain.calls.filter((m) => m === "arkiv_query").length
    await expect(fetchAll(clients.http, landingStat)).rejects.toMatchObject({ name: "RateLimitedError", status: 429 })
    expect(chain.calls.filter((m) => m === "arkiv_query").length).toBe(sent)
  })
})

describe("cache coverage", () => {
  const spec = (where: Where[], more: Partial<ReadSpec> = {}): ReadSpec => ({ where, payload: false, maxRows: 50_000, ...more })
  const types = or(eq("type", "election"), eq("type", "unit"), eq("type", "accreditation"))

  it("answers a narrower OR, an extra equality and fewer creators", () => {
    const cached = spec([types, eq("election", E)], { creators: [CA, CB], payload: true })
    expect(covers(cached, spec([eq("type", "accreditation"), eq("election", E)], { creators: [CA] }))).toBeTypeOf("function")
    expect(covers(cached, spec([eq("type", "unit"), eq("election", E), eq("$creator", v.addr(CA))], { creators: [CA] }))).toBeTypeOf("function")
    expect(covers(cached, spec([eq("type", "accreditation"), eq("election", E), eq("observer", O1)], { creators: [CA, CB] }))).toBeTypeOf("function")
  })

  it("answers a creator-filtered read from an any-creator read", () => {
    expect(covers(spec([resultTypes, eq("election", E)]), spec([resultTypes, eq("election", E)], { creators: [O1] }))).toBeTypeOf("function")
  })

  it("never answers a range, a wider read, more creators or more selected fields", () => {
    const cached = spec([resultTypes, eq("election", E)], { creators: [O1, O2] })
    expect(covers(cached, spec([resultTypes, eq("election", E), gt("rejected", 5)], { creators: [O1] }))).toBeUndefined()
    expect(covers(cached, spec([resultTypes], { creators: [O1] }))).toBeUndefined()
    expect(covers(cached, spec([resultTypes, eq("election", E)], { creators: [O1, O3] }))).toBeUndefined()
    expect(covers(cached, spec([resultTypes, eq("election", E)]))).toBeUndefined()
    expect(covers(cached, spec([resultTypes, eq("election", E)], { creators: [O1], payload: true }))).toBeUndefined()
    expect(covers(spec([eq("type", "unit")]), spec([types]))).toBeUndefined()
  })
})
