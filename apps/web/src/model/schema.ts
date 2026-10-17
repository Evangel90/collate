/**
 * Collate's Arkiv data model, shared by the web app and the seed script. Every attribute here is
 * something Collate filters on; everything only displayed goes in the payload. Trust always comes
 * from `$creator`. Keep /arkiv/schema.md in step with this file.
 */
import { ExpirationTime, jsonToPayload, type CreateEntityParameters } from "@arkiv-network/sdk"
import { u64 } from "@arkiv-network/sdk/attr"
import type { Hex } from "viem"

export const PARTY_FIELDS = ["votes_a", "votes_b", "votes_c"] as const
export type PartyField = (typeof PARTY_FIELDS)[number]

export type Party = { field: PartyField; name: string; short: string }

export type ElectionInput = {
  election: string
  name: string
  description: string
  parties: Party[]
  /** Unix seconds. */
  opensAt: number
  closesAt: number
  /**
   * Optional: how many agreeing observers the coordinator recommends before a unit counts. Viewers
   * start from it and may change it; absent means 1.
   */
  quorum?: number
}

export type UnitInput = {
  election: string
  unitCode: string
  ward: string
  lga: string
  state: string
  registered: number
  name: string
}

export type ResultFigures = {
  votes_a: number
  votes_b: number
  votes_c: number
  rejected: number
  accredited: number
}

export type ResultInput = ResultFigures & {
  election: string
  unitCode: string
  ward: string
  lga: string
  state: string
  /** Unix seconds. */
  submittedAt: number
  /** SHA-256 of the result-sheet photo, hex. The photo itself never leaves the device. */
  photoSha256?: string
  note?: string
}

const DAY = 24 * 60 * 60
const json = (value: object) => ({ payload: jsonToPayload(value), contentType: "application/json" as const })

/** Entity Expiration per type, in one place so schema.md can quote it. */
export const EXPIRY = {
  election: () => ExpirationTime.fromDays(90),
  unit: () => ExpirationTime.fromDays(90),
  /** A lease: election close + 7 days. The coordinator extends it while counting continues. */
  accreditation: (closesAt: number) => ExpirationTime.atDate(new Date((closesAt + 7 * DAY) * 1000)),
  unit_result: () => ExpirationTime.fromDays(30),
  correction: () => ExpirationTime.fromDays(30),
}

export function electionEntity(e: ElectionInput): CreateEntityParameters {
  return {
    ...json({ name: e.name, description: e.description, parties: e.parties, ...(e.quorum ? { quorum: e.quorum } : {}) }),
    attributes: { type: "election", election: e.election, opens_at: u64(e.opensAt), closes_at: u64(e.closesAt) },
    expires: EXPIRY.election(),
    flags: { readonly: true },
  }
}

export function unitEntity(u: UnitInput): CreateEntityParameters {
  return {
    ...json({ name: u.name }),
    attributes: {
      type: "unit",
      election: u.election,
      unit_code: u.unitCode,
      ward: u.ward,
      lga: u.lga,
      state: u.state,
      registered: u64(u.registered),
    },
    expires: EXPIRY.unit(),
    flags: { readonly: true },
  }
}

/** Readonly still allows revoking: a revoke is a delete, which readonly does not block. */
export function accreditationEntity(election: string, observer: string, alias: string, closesAt: number): CreateEntityParameters {
  return {
    ...json({ alias }),
    attributes: { type: "accreditation", election, observer: observer.toLowerCase() },
    expires: EXPIRY.accreditation(closesAt),
    flags: { readonly: true },
  }
}

function resultAttributes(type: "unit_result" | "correction", r: ResultInput) {
  return {
    type,
    election: r.election,
    unit_code: r.unitCode,
    ward: r.ward,
    lga: r.lga,
    state: r.state,
    votes_a: u64(r.votes_a),
    votes_b: u64(r.votes_b),
    votes_c: u64(r.votes_c),
    rejected: u64(r.rejected),
    accredited: u64(r.accredited),
    submitted_at: u64(r.submittedAt),
  }
}

/**
 * A posted result can never be edited (readonly), but anyone may keep it alive (permissionless
 * extension), so a result outlives the group that posted it.
 */
export function resultEntity(r: ResultInput): CreateEntityParameters {
  return {
    ...json({ photo_sha256: r.photoSha256 ?? null, note: r.note ?? "" }),
    attributes: resultAttributes("unit_result", r),
    expires: EXPIRY.unit_result(),
    flags: { readonly: true, permissionlessExtension: true },
  }
}

export function correctionEntity(r: ResultInput, corrects: Hex, reason: string): CreateEntityParameters {
  return {
    ...json({ photo_sha256: r.photoSha256 ?? null, reason }),
    attributes: { ...resultAttributes("correction", r), corrects: corrects.toLowerCase() },
    expires: EXPIRY.correction(),
    flags: { readonly: true, permissionlessExtension: true },
  }
}

/** Browser-side sanity checks run before an observer signs. Returns problems, empty when fine. */
export function checkFigures(f: ResultFigures, registered: number): string[] {
  const problems: string[] = []
  const values = [f.votes_a, f.votes_b, f.votes_c, f.rejected, f.accredited]
  if (values.some((x) => !Number.isInteger(x) || x < 0)) problems.push("Every figure must be a whole number, 0 or more.")
  const cast = f.votes_a + f.votes_b + f.votes_c + f.rejected
  if (cast > f.accredited) problems.push(`Votes cast (${cast}) are above accredited voters (${f.accredited}).`)
  if (f.accredited > registered) problems.push(`Accredited voters (${f.accredited}) are above registered voters (${registered}).`)
  return problems
}
