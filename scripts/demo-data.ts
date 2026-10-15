/**
 * The synthetic demo election: 1 election, 2 observer groups, 12 observers, 48 polling units across
 * 2 states, 4 LGAs and 8 wards, 3 fictional parties, deliberate disputes and one correction.
 * Everything is generated from a fixed seed, so every run produces the same figures.
 * No real people or places beyond two state names.
 */
import type { ElectionInput, Party, ResultFigures, ResultInput, UnitInput } from "../apps/web/src/model/schema"

export const ELECTION = "demo-2027"

export const PARTIES: Party[] = [
  { field: "votes_a", name: "Unity Party", short: "UP" },
  { field: "votes_b", name: "Progress Alliance", short: "PA" },
  { field: "votes_c", name: "Green Coalition", short: "GC" },
]

export function electionInput(now: number): ElectionInput {
  return {
    election: ELECTION,
    name: "Demo General Election 2027",
    description: "A fully synthetic election for the Collate demo. Fictional parties, units and observers.",
    parties: PARTIES,
    opensAt: now - 6 * 3600,
    // Closes after judging ends, so accreditation leases (close + 7 days) outlive 23 Oct 2026.
    closesAt: Math.max(now + 3 * 24 * 3600, Date.UTC(2026, 9, 25, 22) / 1000),
  }
}

const GEOGRAPHY = [
  { state: "Lagos", code: "LA", lean: [0.46, 0.34, 0.2], lgas: [
    { name: "Lagoon North", code: "LN", wards: ["Harbour", "Market"] },
    { name: "Lagoon South", code: "LS", wards: ["Creek", "Palm"] },
  ] },
  { state: "Kano", code: "KN", lean: [0.3, 0.5, 0.2], lgas: [
    { name: "Savanna East", code: "SE", wards: ["Baobab", "Dune"] },
    { name: "Savanna West", code: "SW", wards: ["Millet", "Kola"] },
  ] },
]
const UNITS_PER_WARD = 6

/** Mulberry32: small, deterministic PRNG. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type DemoUnit = UnitInput & { lean: number[] }

export function units(): DemoUnit[] {
  const out: DemoUnit[] = []
  const rand = rng(2027)
  for (const s of GEOGRAPHY) {
    for (const lga of s.lgas) {
      for (const [wi, ward] of lga.wards.entries()) {
        for (let n = 1; n <= UNITS_PER_WARD; n++) {
          out.push({
            election: ELECTION,
            unitCode: `${s.code}-${lga.code}${wi + 1}-${String(n).padStart(2, "0")}`,
            ward: `${ward} Ward`,
            lga: lga.name,
            state: s.state,
            registered: 600 + Math.floor(rand() * 900),
            name: `${ward} Ward, Unit ${n} (${["Primary School", "Town Hall", "Health Centre", "Square", "Library", "Market Shed"][n - 1]})`,
            lean: s.lean,
          })
        }
      }
    }
  }
  return out
}

/** The true count at a unit, as an honest observer would record it. */
export function trueFigures(unit: DemoUnit, index: number): ResultFigures {
  const rand = rng(10_000 + index)
  const accredited = Math.floor(unit.registered * (0.38 + rand() * 0.3))
  const rejected = Math.floor(rand() * 12)
  const valid = accredited - rejected - Math.floor(rand() * 8)
  const weights = unit.lean.map((w) => w * (0.75 + rand() * 0.5))
  const sum = weights.reduce((a, b) => a + b, 0)
  const a = Math.floor((valid * weights[0]!) / sum)
  const b = Math.floor((valid * weights[1]!) / sum)
  return { votes_a: a, votes_b: b, votes_c: valid - a - b, rejected, accredited }
}

/** Observer index (0-based) → unit indexes they post, before the deliberate extras. */
export function assignments(): Map<number, number[]> {
  const plan = new Map<number, number[]>()
  for (let o = 0; o < 8; o++) plan.set(o, Array.from({ length: 6 }, (_, i) => o * 6 + i))
  // Observer 08 leaves its last unit for the live demo, submitted from the observer page.
  plan.set(7, plan.get(7)!.slice(0, 5))
  // Group B's own observers (09–12) double-cover Kano, units 24–47.
  for (let o = 8; o < 12; o++) plan.set(o, Array.from({ length: 6 }, (_, i) => 24 + (o - 8) * 6 + i))
  return plan
}

/** Group A accredits observers 01–08; group B accredits 05–12. */
export const ACCREDITED_BY_A = [0, 1, 2, 3, 4, 5, 6, 7]
export const ACCREDITED_BY_B = [4, 5, 6, 7, 8, 9, 10, 11]

export const alias = (o: number) => `Observer ${String(o + 1).padStart(2, "0")}`

/** Deliberate extras that make the demo interesting. Unit indexes refer to `units()`. */
export const EXTRAS = {
  /** Observer 03 also counts unit 0 and agrees with Observer 01: a confirmation. */
  confirmation: { observer: 2, unit: 0 },
  /** Observer 04 also counts unit 1 and disagrees with Observer 01: dispute in group A. */
  disputeA: { observer: 3, unit: 1, shift: 37 },
  /** Observer 02 also counts unit 40 and disagrees with Observer 07: second dispute in group A. */
  disputeA2: { observer: 1, unit: 40, shift: 52 },
  /** Observer 10 disagrees with Observer 06 on unit 33: dispute in group B. */
  disputeB: { observer: 9, unit: 33, shift: 29 },
  /** Observer 03 mistypes unit 13, then posts a correction. */
  correction: { observer: 2, unit: 13 },
  /** An unaccredited wallet posts an inflated unit 0. Nobody trusts it, so it never counts. */
  rogue: { unit: 0, votes_a: 5000 },
}

export function result(unit: DemoUnit, figures: ResultFigures, submittedAt: number, note = ""): ResultInput {
  return {
    ...figures,
    election: ELECTION,
    unitCode: unit.unitCode,
    ward: unit.ward,
    lga: unit.lga,
    state: unit.state,
    submittedAt,
    photoSha256: fakePhotoHash(unit.unitCode + JSON.stringify(figures)),
    note,
  }
}

/** Stand-in for a result-sheet photo hash: deterministic hex, clearly not a real photo. */
function fakePhotoHash(seed: string): string {
  let h = 2166136261
  let out = ""
  for (let round = 0; round < 8; round++) {
    for (const ch of seed + round) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    out += (h >>> 0).toString(16).padStart(8, "0")
  }
  return out
}

/** Shift votes between parties A and B, keeping the totals plausible. */
export function shifted(f: ResultFigures, shift: number): ResultFigures {
  const move = Math.min(shift, f.votes_b)
  return { ...f, votes_a: f.votes_a + move, votes_b: f.votes_b - move }
}
