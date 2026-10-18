import { describe, expect, it } from "vitest"
import { formatAttr, humanizeKey } from "./format.js"

describe("humanizeKey", () => {
  it("turns attribute names into words", () => {
    expect(humanizeKey("drug_name")).toBe("Drug name")
    expect(humanizeKey("cic-outcome")).toBe("Cic outcome")
    expect(humanizeKey("$creator")).toBe("Creator")
  })
})

describe("formatAttr", () => {
  it("shows unix-second and millisecond timestamps as dates", () => {
    expect(formatAttr("submitted_at", 1792260586)).toMatch(/Oct 2026/)
    expect(formatAttr("created_at", 1792260586000)).toMatch(/Oct 2026/)
  })

  it("leaves other numbers as grouped digits, even large ones", () => {
    expect(formatAttr("votes_a", 254)).toBe("254")
    expect(formatAttr("units", 1792260586)).toBe("1,792,260,586")
  })

  it("shortens addresses and spells out booleans", () => {
    expect(formatAttr("observer", "0x36a95c939fa70f29421261c770160645efa9f9e4")).toBe("0x36a9…f9e4")
    expect(formatAttr("historical", true)).toBe("Yes")
    expect(formatAttr("ward", "Abuja Municipal Ward 03")).toBe("Abuja Municipal Ward 03")
  })
})
