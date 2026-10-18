import { buildTrust, decodePanel, encodePanel, type Row } from "@collate/core"
import type { Address, Hex } from "viem"
import { describe, expect, it } from "vitest"
import { normalize } from "../components/studio/model"
import { resultsPanel, sandboxQuery, trustFor } from "./panels"
import { sandboxRegistrationEntity } from "./schema"

const COORDINATOR = "0x86d0886835480cfee3a0dbfb7814434dab851381"
const ME = "0x4f2a00000000000000000000000000000000beef" as Address
const OTHER = "0x00000000000000000000000000000000000000aa" as Address

let n = 0
const row = (creator: Address, attrs: Row["attrs"], payload?: unknown): Row => ({
  key: `0x${(++n).toString(16).padStart(64, "0")}` as Hex,
  creator,
  owner: creator,
  createdAt: 1n,
  expiresAt: 1_000n,
  flags: { readonly: true, permissionlessExtension: false },
  attrs,
  payload,
})

describe("Open sandbox", () => {
  it("builds a readonly registration naming the wallet in lowercase, with its alias in the payload", () => {
    const closesAt = Math.floor(Date.now() / 1000) + 10 * 86_400
    const entity = sandboxRegistrationEntity("collate-demo-ng", ME.toUpperCase().replace("0X", "0x"), "Tester 4f2a", closesAt)
    expect(entity.attributes).toEqual({ type: "sandbox_registration", election: "collate-demo-ng", observer: ME })
    expect(entity.flags).toEqual({ readonly: true })
    expect(entity.contentType).toBe("application/json")
    expect(JSON.parse(new TextDecoder().decode(entity.payload))).toEqual({ alias: "Tester 4f2a" })
    expect(entity.expires).toBeDefined()
  })

  it("adds the registration list to Group A's trust only for the sandbox", () => {
    expect(trustFor("e", COORDINATOR).selfRegistration).toBeUndefined()
    expect(trustFor("e", COORDINATOR, true).selfRegistration).toEqual({ listQuery: sandboxQuery("e"), addressField: "observer" })
  })

  it("counts a registration only for the wallet that created it", () => {
    const trust = buildTrust(trustFor("e", COORDINATOR, true), [], [
      row(ME, { type: "sandbox_registration", election: "e", observer: ME }, { alias: "Tester 4f2a" }),
      row(OTHER, { type: "sandbox_registration", election: "e", observer: COORDINATOR }),
    ])
    expect([...trust.members.keys()]).toEqual([ME])
    expect(trust.members.get(ME)).toMatchObject({ selfRegistered: true, label: "Tester 4f2a" })
  })

  it("keeps the registration list through a share link and Studio's form", () => {
    const panel = resultsPanel("e", COORDINATOR, "state", 2, true)
    expect(decodePanel(encodePanel(panel)).trust).toEqual(panel.trust)
    expect(normalize(panel).trust?.selfRegistration).toEqual(panel.trust?.selfRegistration)
  })
})
