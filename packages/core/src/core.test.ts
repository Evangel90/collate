import { describe, expect, it } from "vitest"
import type { Address, Hex } from "viem"
import { aggregate } from "./aggregate.js"
import { findConsensus, findDisputes } from "./disputes.js"
import { computePanel } from "./panel.js"
import { decodePanel, encodePanel } from "./share.js"
import { supersede } from "./supersede.js"
import { buildTrust, partitionByTrust } from "./trust.js"
import type { Panel, Row } from "./types.js"
import { createdByAny, eq, gt, or, renderWhere, v } from "./where.js"

const A = "0x00000000000000000000000000000000000000aa" as Address
const B = "0x00000000000000000000000000000000000000bb" as Address
const C = "0x00000000000000000000000000000000000000cc" as Address
const ROOT = "0x0000000000000000000000000000000000000001" as Address

let n = 0
function row(creator: Address, attrs: Row["attrs"], createdAt = 100n, payload?: unknown): Row {
  n += 1
  return {
    key: `0x${n.toString(16).padStart(64, "0")}` as Hex,
    creator,
    owner: creator,
    createdAt,
    expiresAt: 10_000n,
    flags: { readonly: true, permissionlessExtension: true },
    attrs,
    payload,
  }
}

const result = (creator: Address, unit: string, a: number, b: number, extra: Row["attrs"] = {}, at = 100n) =>
  row(creator, { type: "unit_result", unit_code: unit, state: unit.slice(0, 2), votes_a: a, votes_b: b, ...extra }, at)

describe("where", () => {
  it("renders typed predicates the way the node parses them", () => {
    expect(renderWhere([eq("type", "unit_result"), gt("submitted_at", 5)])).toBe(
      "type = str('unit_result') AND submitted_at > u64(5)",
    )
  })

  it("renders creator filters as an OR of $creator", () => {
    // The SDK checksums addresses when rendering.
    expect(renderWhere([createdByAny([A, B])]).toLowerCase()).toBe(
      `$creator = addr(${A}) or $creator = addr(${B})`,
    )
    expect(renderWhere([or(eq("type", "a"), eq("type", "b")), eq("n", v.i32(-1))])).toBe(
      "(type = str('a') OR type = str('b')) AND n = i32(-1)",
    )
  })

  it("rejects non-integer numbers", () => {
    expect(() => renderWhere([eq("x", 1.5)])).toThrow(/not an integer/)
  })
})

describe("trust", () => {
  const config = { rootCreators: [ROOT], listQuery: [eq("type", "accreditation")], addressField: "observer" }

  it("trusts only wallets named in entities the root created", () => {
    const grants = [
      row(ROOT, { type: "accreditation", observer: A.toUpperCase().replace("0X", "0x") }, 1n, { alias: "Observer 01" }),
      row(C, { type: "accreditation", observer: B }), // written by a non-root: ignored
      row(ROOT, { type: "accreditation", observer: "not-an-address" }),
    ]
    const trust = buildTrust(config, grants)
    expect([...trust.members.keys()]).toEqual([A])
    expect(trust.members.get(A)?.label).toBe("Observer 01")

    const { trusted, ignored } = partitionByTrust([result(A, "LA-01", 1, 2), result(B, "LA-01", 9, 9)], trust)
    expect(trusted.map((r) => r.creator)).toEqual([A])
    expect(ignored.map((r) => r.creator)).toEqual([B])
  })
})

describe("trust: self-registration", () => {
  const D = "0x00000000000000000000000000000000000000dd" as Address
  const config = {
    rootCreators: [ROOT],
    listQuery: [eq("type", "accreditation")],
    addressField: "observer",
    selfRegistration: { listQuery: [eq("type", "sandbox_registration")], addressField: "observer" },
  }
  const accredit = (who: Address) => row(ROOT, { type: "accreditation", observer: who }, 1n, { alias: "Observer" })
  const register = (creator: Address, named: string, alias = "Tester") => row(creator, { type: "sandbox_registration", observer: named }, 2n, { alias })

  it("accepts a registration created by the wallet it names, marked as self-registered", () => {
    const own = register(B, B.toUpperCase().replace("0X", "0x"), "Tester 00bb")
    const trust = buildTrust(config, [], [own])
    expect(trust.members.get(B)).toMatchObject({ address: B, via: B, grantKey: own.key, label: "Tester 00bb", selfRegistered: true })
  })

  it("rejects a registration naming another wallet", () => {
    const trust = buildTrust(config, [], [register(C, B), register(C, "not-an-address")])
    expect(trust.members.size).toBe(0)
  })

  it("ignores registrations when the config has no open list", () => {
    const { selfRegistration: _, ...closed } = config
    expect(buildTrust(closed, [], [register(B, B)]).members.size).toBe(0)
  })

  it("joins root-vouched members, and a vouched wallet keeps its accreditation", () => {
    const trust = buildTrust(config, [accredit(A)], [register(A, A), register(B, B)])
    expect([...trust.members.keys()].sort()).toEqual([A, B])
    expect(trust.members.get(A)).toMatchObject({ via: ROOT, label: "Observer" })
    expect(trust.members.get(A)?.selfRegistered).toBeUndefined()
    expect(trust.members.get(B)?.selfRegistered).toBe(true)
  })

  it("drops a registration once it is gone from the list, as an expired or deleted accreditation is", () => {
    const own = register(B, B)
    expect(buildTrust(config, [accredit(A)], [own]).members.has(B)).toBe(true)
    // Expired and deleted entities are no longer returned by Arkiv, so the next read omits them.
    expect(buildTrust(config, [accredit(A)], []).members.has(B)).toBe(false)
  })

  it("splits rows by the joined set, so forged and unregistered writers stay in the ignored list", () => {
    const trust = buildTrust(config, [accredit(A)], [register(B, B), register(C, D)])
    const { trusted, ignored } = partitionByTrust(
      [result(A, "LA-01", 1, 1), result(B, "LA-01", 1, 1), result(C, "LA-01", 9, 9), result(D, "LA-01", 9, 9)],
      trust,
    )
    expect(trusted.map((r) => r.creator)).toEqual([A, B])
    expect(ignored.map((r) => r.creator)).toEqual([C, D])
  })
})

describe("supersede", () => {
  it("replaces an original with a correction from the same creator and keeps the original visible", () => {
    const original = result(A, "LA-01", 10, 20)
    const correction = result(A, "LA-01", 11, 20, { corrects: original.key }, 200n)
    const { current, superseded } = supersede([original, correction], "corrects")
    expect(current).toEqual([correction])
    expect(superseded).toEqual([{ original, by: correction }])
  })

  it("drops a correction aimed at someone else's entity", () => {
    const original = result(A, "LA-01", 10, 20)
    const hostile = result(B, "LA-01", 0, 99, { corrects: original.key }, 200n)
    const { current, superseded } = supersede([original, hostile], "corrects")
    expect(current).toEqual([original])
    expect(superseded).toEqual([])
  })

  it("follows a chain and lets the latest of several corrections win", () => {
    const r0 = result(A, "LA-01", 1, 1)
    const c1 = result(A, "LA-01", 2, 2, { corrects: r0.key }, 200n)
    const c2 = result(A, "LA-01", 3, 3, { corrects: r0.key }, 300n)
    const c3 = result(A, "LA-01", 4, 4, { corrects: c2.key }, 400n)
    const { current, superseded } = supersede([r0, c1, c2, c3], "corrects")
    expect(current).toEqual([c3])
    expect(superseded.map((s) => [s.original.key, s.by.key])).toEqual([
      [r0.key, c2.key],
      [c1.key, c2.key],
      [c2.key, c3.key],
    ])
  })

  it("keeps a correction whose original is out of scope", () => {
    const orphan = result(A, "LA-01", 2, 2, { corrects: "0xdead" })
    expect(supersede([orphan], "corrects").current).toEqual([orphan])
  })
})

describe("consensus", () => {
  const fields = ["votes_a", "votes_b"]
  const D = "0x00000000000000000000000000000000000000dd" as Address

  it("certifies a single report at the default quorum of 1", () => {
    const only = result(A, "LA-01", 10, 20)
    const { resolved, consensus, disputes } = findConsensus([only], "unit_code", fields)
    expect(resolved).toEqual([only])
    expect(disputes).toEqual([])
    expect(consensus).toEqual([{ key: "LA-01", status: "certified", quorum: 1, sources: 1, agreeing: [only], outliers: [], entries: [only] }])
  })

  it("contests a one-against-one split and counts neither", () => {
    const a = result(A, "LA-01", 10, 20)
    const b = result(B, "LA-01", 11, 20)
    const { resolved, consensus, disputes } = findConsensus([a, b], "unit_code", fields)
    expect(resolved).toEqual([])
    expect(consensus[0]).toMatchObject({ status: "contested", sources: 2, agreeing: [], outliers: [], entries: [a, b] })
    expect(disputes).toEqual([{ key: "LA-01", entries: [a, b] }])
  })

  it("certifies a two-against-one majority and lists the outlier", () => {
    const a = result(A, "LA-01", 10, 20, {}, 100n)
    const bad = result(B, "LA-01", 99, 20, {}, 150n)
    const c = result(C, "LA-01", 10, 20, {}, 200n)
    const { resolved, consensus, disputes } = findConsensus([a, bad, c], "unit_code", fields)
    expect(resolved).toEqual([c]) // the latest agreeing row counts, once
    expect(disputes).toEqual([])
    expect(consensus[0]).toMatchObject({ status: "certified", sources: 3, agreeing: [a, c], outliers: [bad], entries: [a, bad, c] })
  })

  it("needs a strict majority, not just the largest bucket", () => {
    // 2 agree, 2 others each say something different: 2 of 4 is not a majority.
    const rows = [result(A, "LA-01", 1, 1), result(B, "LA-01", 1, 1), result(C, "LA-01", 2, 2), result(D, "LA-01", 3, 3)]
    const { resolved, consensus } = findConsensus(rows, "unit_code", fields)
    expect(consensus[0]!.status).toBe("contested")
    expect(resolved).toEqual([])
  })

  it("holds a group as pending until quorum sources report", () => {
    const a = result(A, "LA-01", 10, 20)
    const pending = findConsensus([a], "unit_code", fields, 2)
    expect(pending.resolved).toEqual([])
    expect(pending.disputes).toEqual([])
    expect(pending.consensus[0]).toMatchObject({ status: "pending", quorum: 2, sources: 1, agreeing: [], entries: [a] })

    const b = result(B, "LA-01", 10, 20)
    const certified = findConsensus([a, b], "unit_code", fields, 2)
    expect(certified.consensus[0]).toMatchObject({ status: "certified", quorum: 2, sources: 2 })
    expect(certified.resolved).toHaveLength(1)
  })

  it("contests, not pends, once quorum sources report without agreement", () => {
    const rows = [result(A, "LA-01", 1, 1), result(B, "LA-01", 2, 2)]
    expect(findConsensus(rows, "unit_code", fields, 2).consensus[0]!.status).toBe("contested")
    // Three sources, two agree, quorum 3: enough have reported, too few agree.
    const three = [...rows, result(C, "LA-01", 1, 1)]
    expect(findConsensus(three, "unit_code", fields, 3).consensus[0]!.status).toBe("contested")
  })

  it("uses only the latest entry per source", () => {
    const old = result(A, "LA-01", 1, 1, {}, 100n)
    const fresh = result(A, "LA-01", 2, 2, {}, 200n)
    const other = result(B, "LA-01", 2, 2)
    const { resolved, consensus } = findConsensus([old, fresh, other], "unit_code", fields, 2)
    expect(consensus[0]).toMatchObject({ status: "certified", sources: 2, entries: [other, fresh] })
    expect(resolved).toEqual([fresh])
  })

  it("keeps unkeyed rows and sorts groups by key", () => {
    const loose = row(A, { type: "unit_result", votes_a: 1 })
    const rows = [result(A, "LA-02", 1, 1), loose, result(A, "LA-01", 1, 1)]
    const { resolved, consensus } = findConsensus(rows, "unit_code", fields)
    expect(consensus.map((c) => c.key)).toEqual(["LA-01", "LA-02"])
    expect(resolved).toContain(loose)
    expect(resolved).toHaveLength(3)
  })

  it("treats a nonsense quorum as 1", () => {
    const { consensus } = findConsensus([result(A, "LA-01", 1, 1)], "unit_code", fields, Number.NaN)
    expect(consensus[0]).toMatchObject({ status: "certified", quorum: 1 })
  })

  it("keeps findDisputes as the quorum-1 view", () => {
    const rows = [
      result(A, "LA-01", 10, 20),
      result(B, "LA-01", 10, 20), // agrees
      result(A, "LA-02", 5, 5),
      result(B, "LA-02", 6, 5), // one against one
      result(A, "LA-03", 1, 1),
    ]
    const { resolved, disputes } = findDisputes(rows, "unit_code", fields)
    expect(resolved.map((r) => r.attrs.unit_code).sort()).toEqual(["LA-01", "LA-03"])
    expect(disputes.map((d) => d.key)).toEqual(["LA-02"])
    expect(disputes[0]!.entries.map((r) => r.creator)).toEqual([A, B])
  })
})

describe("aggregate", () => {
  it("groups, sums, counts and tracks min and max", () => {
    const rows = [result(A, "LA-01", 10, 1), result(A, "LA-02", 5, 2), result(A, "KA-01", 7, 3)]
    const { groups, total } = aggregate(rows, { groupBy: "state", sum: ["votes_a", "votes_b"] })
    expect(groups.map((g) => [g.group, g.count, g.sums.votes_a, g.min.votes_a, g.max.votes_a])).toEqual([
      ["KA", 1, 7, 7, 7],
      ["LA", 2, 15, 5, 10],
    ])
    expect(total.sums).toEqual({ votes_a: 22, votes_b: 6 })
    expect(total.keys).toHaveLength(3)
  })

  it("sorts by a summed field", () => {
    const rows = [result(A, "LA-01", 1, 0), result(A, "KA-01", 9, 0)]
    const { groups } = aggregate(rows, { groupBy: "state", sum: ["votes_a"], sortBy: "votes_a", desc: true })
    expect(groups.map((g) => g.group)).toEqual(["KA", "LA"])
  })
})

describe("panel pipeline", () => {
  const panel: Panel = {
    title: "t",
    query: [eq("type", "unit_result")],
    supersedeField: "corrects",
    disputeKey: "unit_code",
    groupBy: "state",
    sum: ["votes_a", "votes_b"],
    view: "table",
  }

  it("supersedes, then decides consensus, then aggregates what is certified", () => {
    const wrong = result(A, "LA-01", 99, 0)
    const fixed = result(A, "LA-01", 10, 0, { corrects: wrong.key }, 200n)
    const agree = result(B, "LA-01", 10, 0)
    const d1 = result(A, "LA-02", 1, 1)
    const d2 = result(B, "LA-02", 2, 2)
    const out = computePanel(panel, [wrong, fixed, agree, d1, d2])
    expect(out.superseded).toHaveLength(1)
    // The correction, not the mistyped original, is A's entry, so A and B agree on LA-01.
    expect(out.consensus.map((c) => [c.key, c.status])).toEqual([["LA-01", "certified"], ["LA-02", "contested"]])
    expect(out.consensus[0]!.entries).toEqual([agree, fixed])
    expect(out.disputes.map((d) => d.key)).toEqual(["LA-02"])
    expect(out.total.sums.votes_a).toBe(10)
  })

  it("counts only certified groups at the panel's quorum", () => {
    const a1 = result(A, "LA-01", 10, 0)
    const b1 = result(B, "LA-01", 10, 0)
    const lone = result(A, "LA-02", 7, 0)
    const out = computePanel({ ...panel, quorum: 2 }, [a1, b1, lone])
    expect(out.consensus.map((c) => [c.key, c.status])).toEqual([["LA-01", "certified"], ["LA-02", "pending"]])
    expect(out.disputes).toEqual([])
    expect(out.total.sums.votes_a).toBe(10)
    expect(out.total.count).toBe(1)
  })
})

describe("share", () => {
  it("round-trips a panel through a URL-safe string", () => {
    const panel: Panel = {
      title: "Votes by state — ñ",
      query: [eq("type", "unit_result"), createdByAny([A])],
      groupBy: "state",
      sum: ["votes_a"],
      disputeKey: "unit_code",
      quorum: 2,
      view: "bar",
    }
    const encoded = encodePanel(panel)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodePanel(encoded)).toEqual(panel)
  })

  it("round-trips a trust config with a self-registration list", () => {
    const panel: Panel = {
      title: "Sandbox",
      query: [eq("type", "unit_result")],
      trust: {
        rootCreators: [ROOT],
        listQuery: [eq("type", "accreditation"), eq("election", "e")],
        addressField: "observer",
        selfRegistration: { listQuery: [eq("type", "sandbox_registration"), eq("election", "e")], addressField: "observer" },
      },
      view: "table",
    }
    expect(decodePanel(encodePanel(panel))).toEqual(panel)
  })

  it("drops a malformed self-registration list rather than trusting more", () => {
    const panel = {
      title: "x",
      query: [eq("type", "a")],
      trust: { rootCreators: [ROOT], listQuery: [eq("type", "b")], addressField: "observer", selfRegistration: { listQuery: [], addressField: "observer" } },
      view: "table",
    } as Panel
    expect(decodePanel(encodePanel(panel)).trust?.selfRegistration).toBeUndefined()
  })

  it("drops a quorum that is not a whole number of at least 1", () => {
    const decoded = decodePanel(encodePanel({ title: "x", query: [eq("type", "a")], view: "table", quorum: 0 }))
    expect(decoded.quorum).toBeUndefined()
  })

  it("rejects a panel without a query", () => {
    expect(() => decodePanel(encodePanel({ title: "x", query: [], view: "table" }))).toThrow(/no query/)
  })
})

describe("describeError", () => {
  it("turns a wrapped HTTP 429 into a retry hint", async () => {
    const { describeError } = await import("./errors.js")
    const http = { status: 429, headers: new Headers({ "retry-after": "883" }), message: "HTTP request failed." }
    const wrapped = { message: "outer", cause: http }
    expect(describeError(wrapped)).toEqual({
      message: expect.stringContaining("about 15 min"),
      retryAfterSeconds: 883,
    })
    expect(describeError(new Error("boom\ndetails"))).toEqual({ message: "boom" })
  })
})
