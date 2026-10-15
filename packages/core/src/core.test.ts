import { describe, expect, it } from "vitest"
import type { Address, Hex } from "viem"
import { aggregate } from "./aggregate"
import { findDisputes } from "./disputes"
import { computePanel } from "./panel"
import { decodePanel, encodePanel } from "./share"
import { supersede } from "./supersede"
import { buildTrust, partitionByTrust } from "./trust"
import type { Panel, Row } from "./types"
import { createdByAny, eq, gt, or, renderWhere, v } from "./where"

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

describe("disputes", () => {
  it("flags disagreeing sources and counts agreeing ones once", () => {
    const rows = [
      result(A, "LA-01", 10, 20),
      result(B, "LA-01", 10, 20), // agrees
      result(A, "LA-02", 5, 5),
      result(B, "LA-02", 6, 5), // disagrees
      result(A, "LA-03", 1, 1),
    ]
    const { resolved, disputes } = findDisputes(rows, "unit_code", ["votes_a", "votes_b"])
    expect(resolved.map((r) => r.attrs.unit_code).sort()).toEqual(["LA-01", "LA-03"])
    expect(disputes).toHaveLength(1)
    expect(disputes[0]!.key).toBe("LA-02")
    expect(disputes[0]!.entries.map((r) => r.creator)).toEqual([A, B])
  })

  it("uses only the latest entry per source", () => {
    const rows = [result(A, "LA-01", 1, 1, {}, 100n), result(A, "LA-01", 2, 2, {}, 200n), result(B, "LA-01", 2, 2)]
    const { resolved, disputes } = findDisputes(rows, "unit_code", ["votes_a", "votes_b"])
    expect(disputes).toEqual([])
    expect(resolved).toHaveLength(1)
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
  it("supersedes, then flags disputes, then aggregates what is left", () => {
    const panel: Panel = {
      title: "t",
      query: [eq("type", "unit_result")],
      supersedeField: "corrects",
      disputeKey: "unit_code",
      groupBy: "state",
      sum: ["votes_a", "votes_b"],
      view: "table",
    }
    const wrong = result(A, "LA-01", 99, 0)
    const fixed = result(A, "LA-01", 10, 0, { corrects: wrong.key }, 200n)
    const agree = result(B, "LA-01", 10, 0)
    const d1 = result(A, "LA-02", 1, 1)
    const d2 = result(B, "LA-02", 2, 2)
    const out = computePanel(panel, [wrong, fixed, agree, d1, d2])
    expect(out.superseded).toHaveLength(1)
    expect(out.disputes.map((d) => d.key)).toEqual(["LA-02"])
    expect(out.total.sums.votes_a).toBe(10)
  })
})

describe("share", () => {
  it("round-trips a panel through a URL-safe string", () => {
    const panel: Panel = {
      title: "Votes by state — ñ",
      query: [eq("type", "unit_result"), createdByAny([A])],
      groupBy: "state",
      sum: ["votes_a"],
      view: "bar",
    }
    const encoded = encodePanel(panel)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodePanel(encoded)).toEqual(panel)
  })

  it("rejects a panel without a query", () => {
    expect(() => decodePanel(encodePanel({ title: "x", query: [], view: "table" }))).toThrow(/no query/)
  })
})

describe("describeError", () => {
  it("turns a wrapped HTTP 429 into a retry hint", async () => {
    const { describeError } = await import("./errors")
    const http = { status: 429, headers: new Headers({ "retry-after": "883" }), message: "HTTP request failed." }
    const wrapped = { message: "outer", cause: http }
    expect(describeError(wrapped)).toEqual({
      message: expect.stringContaining("about 15 min"),
      retryAfterSeconds: 883,
    })
    expect(describeError(new Error("boom\ndetails"))).toEqual({ message: "boom" })
  })
})
