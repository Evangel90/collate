import { EntityMutationError } from "@arkiv-network/sdk"
import type { Row } from "collate-core"
import { describe, expect, it } from "vitest"
import type { UnitInput } from "../../model/schema"
import {
  checkDraft,
  checkElectionId,
  checkUnits,
  classifyWriteError,
  draftId,
  electionIdFor,
  emptyUnit,
  existingFrom,
  parseCsv,
  parseObservers,
  partyShort,
  planSize,
  remaining,
  sampleUnits,
  slugify,
  toBatches,
  unitsFromCsv,
  withLanded,
} from "./plan"

const unit = (code: string): UnitInput => ({ election: "e", unitCode: code, ward: "W", lga: "L", state: "S", registered: 1, name: code })
const units = (n: number) => Array.from({ length: n }, (_, i) => unit(`U-${String(i + 1).padStart(3, "0")}`))
const row = (attrs: Row["attrs"]): Row => ({
  key: "0x01",
  creator: "0x0000000000000000000000000000000000000001",
  owner: "0x0000000000000000000000000000000000000001",
  createdAt: 1n,
  expiresAt: 2n,
  flags: { readonly: true, permissionlessExtension: false },
  attrs,
  payload: undefined,
})

describe("election ids", () => {
  it("slugs a name and adds the suffix", () => {
    expect(slugify("  Ward 3 By-élection (synthetic)! ")).toBe("ward-3-by-election-synthetic")
    expect(electionIdFor("Ward 3", "k2x9")).toBe("ward-3-k2x9")
    expect(electionIdFor("!!!", "k2x9")).toBe("election-k2x9")
  })

  it("rejects bad or taken ids", () => {
    expect(checkElectionId("ward-3-k2x9", new Set())).toBeUndefined()
    expect(checkElectionId("Ward 3", new Set())).toMatch(/lowercase/)
    expect(checkElectionId("a--b", new Set())).toMatch(/single hyphens/)
    expect(checkElectionId("ab", new Set())).toMatch(/3 to 64/)
    expect(checkElectionId("mine-1", new Set(["mine-1"]))).toMatch(/already have/)
  })

  it("derives short party labels", () => {
    expect(partyShort("Unity Party")).toBe("UP")
    expect(partyShort("Labour")).toBe("LAB")
    expect(partyShort("Party A")).toBe("PA")
  })
})

describe("units CSV and validation", () => {
  it("parses quoted fields and CRLF", () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n\n')).toEqual([
      ["a", "b, c", 'd "q"'],
      ["1", "2", "3"],
    ])
  })

  it("reads the header and keeps unquoted commas in the name", () => {
    const res = unitsFromCsv("unit_code,ward,lga,state,registered,name\nLA-1,W1,Ikeja,Lagos,800,Unit 001, Town Hall\nLA-2,W1,Ikeja,Lagos,650,\"Unit 002, School\"")
    expect("units" in res && res.units.map((u) => [u.unitCode, u.name])).toEqual([
      ["LA-1", "Unit 001, Town Hall"],
      ["LA-2", "Unit 002, School"],
    ])
    expect(unitsFromCsv("code,ward\nx,y")).toHaveProperty("error")
  })

  it("flags duplicates, empty cells, bad numbers and codes already on Arkiv; ignores blank rows", () => {
    const drafts = [
      { ...emptyUnit(), unitCode: "A", ward: "w", lga: "l", state: "s", registered: "10", name: "" },
      { ...emptyUnit(), unitCode: "A", ward: "w", lga: "l", state: "s", registered: "1.5", name: "" },
      { ...emptyUnit(), unitCode: "B", ward: "", lga: "l", state: "s", registered: "5", name: "" },
      { ...emptyUnit(), unitCode: "OLD", ward: "w", lga: "l", state: "s", registered: "5", name: "" },
      emptyUnit(),
    ]
    const check = checkUnits(drafts, "e", new Set(["OLD"]))
    expect(check.units.map((u) => [u.unitCode, u.name, u.registered])).toEqual([["A", "A", 10]])
    expect(check.messages).toEqual([
      "Row 2, unit code: same code as row 1",
      "Row 2, registered voters: a whole number, 0 or more",
      "Row 3, ward: required",
      "Row 4, unit code: already registered for this election",
    ])
    expect(check.problems.get(drafts[1]!.id)).toEqual({ unitCode: "same code as row 1", registered: "a whole number, 0 or more" })
  })

  it("fills sample units that pass validation and skip taken codes", () => {
    const first = sampleUnits(6)
    expect(checkUnits(first, "e").messages).toEqual([])
    const taken = new Set(first.map((u) => u.unitCode))
    const more = sampleUnits(6, taken)
    expect(more.some((u) => taken.has(u.unitCode))).toBe(false)
    expect(checkUnits(more, "e", taken).units).toHaveLength(6)
  })
})

describe("observers", () => {
  const ADDR = "0x4381e820aa2064b8069a40b28275e9d7c75a23cd"
  it("parses address, alias lines and reports problems", () => {
    const res = parseObservers(`${ADDR}, Observer 13\n0x123, Bad\n0x4381E820AA2064B8069a40B28275e9D7c75a23cD\n0x7acbb116475e811d0852351c339ef81742a8b17d, Already`, new Set(["0x7acbb116475e811d0852351c339ef81742a8b17d"]), 14)
    expect(res.observers).toEqual([{ address: ADDR, alias: "Observer 13" }])
    expect(res.messages).toHaveLength(3)
    expect(res.messages[1]).toMatch(/Line 3: listed twice/)
    expect(res.messages[2]).toMatch(/Line 4: already accredited/)
  })

  it("suggests aliases when none is given", () => {
    expect(parseObservers(ADDR, new Set(), 3).observers[0]!.alias).toBe("Observer 03")
  })
})

describe("chunked creation and resume", () => {
  it("puts the election in the first batch of at most 15 creates", () => {
    const batches = toBatches({ election: true, units: units(40) })
    expect(batches.map(planSize)).toEqual([15, 15, 11])
    expect(batches.map((b) => b.election)).toEqual([true, false, false])
    expect(batches.flatMap((b) => b.units).map((u) => u.unitCode)).toEqual(units(40).map((u) => u.unitCode))
  })

  it("plans nothing when everything exists, and only the missing units after a partial run", () => {
    const intended = { election: true, units: units(40) }
    const rows = [row({ type: "election", election: "e" }), ...units(14).map((u) => row({ type: "unit", election: "e", unit_code: u.unitCode }))]
    const rest = remaining(intended, existingFrom(rows))
    expect(rest.election).toBe(false)
    expect(rest.units.map((u) => u.unitCode)).toEqual(units(40).slice(14).map((u) => u.unitCode))
    expect(toBatches(rest).map(planSize)).toEqual([15, 11])
    expect(planSize(remaining(intended, existingFrom([...rows, ...units(40).map((u) => row({ type: "unit", unit_code: u.unitCode }))])))).toBe(0)
  })

  it("tracks landed batches without a re-read", () => {
    const [first, second] = toBatches({ election: true, units: units(20) })
    const after = withLanded(withLanded({ election: false, unitCodes: new Set() }, first!), second!)
    expect(planSize(remaining({ election: true, units: units(20) }, after))).toBe(0)
  })

  it("classifies write failures so an unknown outcome is never resent", () => {
    const hash = "0xabc" as const
    expect(classifyWriteError(new EntityMutationError("Transaction failed", { cause: { code: 4001 } })).kind).toBe("rejected")
    expect(classifyWriteError(new EntityMutationError("Transaction failed: Execution error without revert data")).kind).toBe("refused")
    expect(classifyWriteError(new EntityMutationError(`Transaction ${hash} reverted. No reason provided by backend.`, { txHash: hash }))).toEqual({ kind: "refused", txHash: hash })
    expect(classifyWriteError(new EntityMutationError("Transaction failed: timed out", { txHash: hash }))).toEqual({ kind: "unknown", txHash: hash })
    expect(classifyWriteError(new EntityMutationError(`Transaction ${hash} succeeded — do not retry it — but emitted 3 create event(s)`, { txHash: hash })).kind).toBe("applied")
    expect(classifyWriteError(new EntityMutationError("Transaction null succeeded — do not retry it — but emitted 0 create event(s)")).kind).toBe("applied")
    expect(classifyWriteError(new Error("network down")).kind).toBe("refused")
  })
})

describe("new-election form", () => {
  const draft = { name: "Ward 3 by-election (synthetic)", description: "", closes: "2099-01-01", quorum: 1, parties: ["A one", "B two", "C three"] as [string, string, string], suffix: "k2x9", units: [] }

  it("accepts a complete draft and names its problems otherwise", () => {
    expect(draftId(draft)).toBe("ward-3-by-election-synthetic-k2x9")
    expect(checkDraft(draft, new Set())).toEqual([])
    expect(checkDraft({ ...draft, name: " ", closes: "2000-01-01", quorum: 0, parties: ["A", "a", "B"], customId: "Bad Id" }, new Set())).toEqual([
      "Name: required",
      "Counting closes: pick a date after today",
      "Quorum: a whole number from 1 to 9",
      "Parties: use three different names",
      "Election id: Use lowercase letters, digits and single hyphens only.",
    ])
  })
})
