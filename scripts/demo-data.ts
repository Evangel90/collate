/**
 * The demo election: 1 election, 2 observer groups, 12 observers, 72 polling units across 6 states,
 * 12 LGAs and 24 wards, 3 fictional parties, deliberate disagreements, second counts and one
 * correction. Everything is generated from a fixed seed, so every run produces the same figures.
 *
 * Real Nigerian state and LGA names only. Every result, party, observer, ward and polling unit is
 * synthetic: wards are numbered ("Ikeja Ward 03") and units are generic ("Unit 002, Town Hall"), so
 * nothing here can pass for a real polling unit or a real result. The election id and name say so.
 */
import type { ElectionInput, Party, ResultFigures, ResultInput, UnitInput } from "../apps/web/src/model/schema"

export const ELECTION = "collate-demo-ng"

export const PARTIES: Party[] = [
  { field: "votes_a", name: "Unity Party", short: "UP" },
  { field: "votes_b", name: "Progress Alliance", short: "PA" },
  { field: "votes_c", name: "Green Coalition", short: "GC" },
]

export function electionInput(now: number): ElectionInput {
  return {
    election: ELECTION,
    name: "Collate demo election (synthetic results, real Nigerian geography)",
    description:
      "Not a real election. A demo of Collate: every result, party, observer, ward and polling unit is synthetic; only the state and LGA names are real. No figure here reflects any real vote.",
    parties: PARTIES,
    opensAt: now - 13 * 3600,
    // Closes after judging ends (19–23 Oct 2026), so accreditation leases (close + 7 days) outlive it.
    closesAt: Math.max(now + 3 * 24 * 3600, Date.UTC(2026, 9, 26, 22) / 1000),
    quorum: 1,
  }
}

/** Six real states, two real LGAs each. Ward numbers are arbitrary labels, not INEC wards. */
const GEOGRAPHY = [
  { state: "Lagos", code: "LA", lean: [0.46, 0.34, 0.2], lgas: [
    { name: "Ikeja", code: "IKJ", wards: [3, 8] },
    { name: "Surulere", code: "SUR", wards: [2, 5] },
  ] },
  { state: "Kano", code: "KN", lean: [0.3, 0.5, 0.2], lgas: [
    { name: "Nassarawa", code: "NAS", wards: [4, 9] },
    { name: "Fagge", code: "FAG", wards: [1, 6] },
  ] },
  { state: "Rivers", code: "RV", lean: [0.36, 0.28, 0.36], lgas: [
    { name: "Port Harcourt", code: "PHC", wards: [5, 11] },
    { name: "Obio/Akpor", code: "OBA", wards: [2, 7] },
  ] },
  { state: "FCT", code: "FC", lean: [0.4, 0.4, 0.2], lgas: [
    { name: "Abuja Municipal", code: "AMC", wards: [3, 10] },
    { name: "Bwari", code: "BWR", wards: [1, 4] },
  ] },
  { state: "Enugu", code: "EN", lean: [0.26, 0.3, 0.44], lgas: [
    { name: "Enugu North", code: "ENN", wards: [2, 6] },
    { name: "Nsukka", code: "NSK", wards: [5, 9] },
  ] },
  { state: "Oyo", code: "OY", lean: [0.42, 0.38, 0.2], lgas: [
    { name: "Ibadan North", code: "IBN", wards: [4, 8] },
    { name: "Ogbomosho North", code: "OGN", wards: [3, 7] },
  ] },
]
const UNITS_PER_WARD = 3
const SITES = ["Primary School", "Town Hall", "Health Centre", "Community Square", "Civic Centre", "Market Shed", "Secondary School", "Motor Park"]

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

const pad = (n: number, width: number) => String(n).padStart(width, "0")

export type DemoUnit = UnitInput & { lean: number[] }

/** 72 units, state by state: index = state * 12 + lga * 6 + ward * 3 + unit. */
export function units(): DemoUnit[] {
  const out: DemoUnit[] = []
  const rand = rng(2026)
  for (const s of GEOGRAPHY) {
    for (const lga of s.lgas) {
      for (const ward of lga.wards) {
        for (let n = 1; n <= UNITS_PER_WARD; n++) {
          out.push({
            election: ELECTION,
            unitCode: `${s.code}-${lga.code}-${pad(ward, 2)}-${pad(n, 3)}`,
            ward: `${lga.name} Ward ${pad(ward, 2)}`,
            lga: lga.name,
            state: s.state,
            registered: 600 + Math.floor(rand() * 900),
            name: `Unit ${pad(n, 3)}, ${SITES[Math.floor(rand() * SITES.length)]}`,
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

/** Observer index (0-based) → unit indexes of their first counts, before the deliberate extras. */
export function assignments(): Map<number, number[]> {
  const plan = new Map<number, number[]>()
  // Observers 01–08 (group A) split all 72 units, 9 each.
  for (let o = 0; o < 8; o++) plan.set(o, Array.from({ length: 9 }, (_, i) => o * 9 + i))
  // Observer 08 leaves its last unit (OY-OGN-07-003) for the live demo, submitted from the observer page.
  plan.set(7, plan.get(7)!.slice(0, 8))
  // Group B's own observers (09–12) double-cover Rivers, FCT and Enugu, units 24–59.
  for (let o = 8; o < 12; o++) plan.set(o, Array.from({ length: 9 }, (_, i) => 24 + (o - 8) * 9 + i))
  return plan
}

/** Group A accredits observers 01–08; group B accredits 05–12. */
export const ACCREDITED_BY_A = [0, 1, 2, 3, 4, 5, 6, 7]
export const ACCREDITED_BY_B = [4, 5, 6, 7, 8, 9, 10, 11]

export const alias = (o: number) => `Observer ${pad(o + 1, 2)}`

/** Deliberate extras that make the demo interesting. Unit indexes refer to `units()`. */
export const EXTRAS = {
  /** Observer 04 also counts LA-IKJ-03-002 and disagrees with Observer 01; outvoted once Observer 02 agrees (2 of 3). */
  outlierA: { observer: 3, unit: 1, shift: 37 },
  /** Observer 01 also counts KN-NAS-09-002 and disagrees with Observer 02: one against one, contested in group A. */
  contestedA: { observer: 0, unit: 16, shift: 52 },
  /** Observer 10 disagrees with Observer 05 on FC-AMC-10-002: contested in group B. */
  contestedB: { observer: 9, unit: 40, shift: 29 },
  /**
   * Second counts that agree with the unit's first observer, for committee consensus. Observer 02 on
   * LA-IKJ-03-002 makes it certified 2/3 with Observer 04 the outlier; Observer 04 on KN-FAG-06-003
   * agrees with Observer 03's correction; the rest give group A units that still count at quorum 2
   * (EN-ENN-02-003 and OY-OGN-03-001 also gain a second group B source).
   */
  agreements: [
    { observer: 1, unit: 1 },
    { observer: 3, unit: 23 },
    { observer: 5, unit: 10 },
    { observer: 0, unit: 28 },
    { observer: 4, unit: 50 },
    { observer: 6, unit: 66 },
  ],
  /** Observer 03 mistypes KN-FAG-06-003, then posts a correction. */
  correction: { observer: 2, unit: 23, typo: 90 },
  /** An unaccredited wallet posts an inflated LA-IKJ-03-001. Nobody trusts it, so it never counts. */
  rogue: { unit: 0, votes_a: 5000 },
}

export type PlannedResult = { observer: number; unit: number; figures: ResultFigures; submittedAt: number; note: string }

/**
 * Every observer's results in posting order: first counts, then second counts. `submitted_at`
 * spreads over the 12 hours before `now`, so the latest-submissions panel has something to show.
 */
export function observerResults(now: number): PlannedResult[] {
  const all = units()
  const jitter = rng(4242)
  const out: PlannedResult[] = []
  for (const [o, plan] of assignments()) {
    for (const [i, u] of plan.entries()) {
      let figures = trueFigures(all[u]!, u)
      if (o === EXTRAS.contestedB.observer && u === EXTRAS.contestedB.unit) figures = shifted(figures, EXTRAS.contestedB.shift)
      // The mistyped original; the correction follows once its key is known.
      if (o === EXTRAS.correction.observer && u === EXTRAS.correction.unit) figures = { ...figures, votes_a: figures.votes_a + EXTRAS.correction.typo }
      // Group A from about 12 hours ago, group B's own observers from about 10; one result every ~50 minutes each.
      const start = o < 8 ? 12 * 3600 : 10 * 3600
      const at = now - start + i * 50 * 60 + Math.floor(jitter() * 40 * 60)
      out.push({ observer: o, unit: u, figures, submittedAt: at, note: "" })
    }
  }
  const second = (o: number, u: number, figures: ResultFigures, i: number) =>
    out.push({ observer: o, unit: u, figures, submittedAt: now - 2 * 3600 + i * 900 + Math.floor(jitter() * 300), note: "Second count at this unit" })
  const { outlierA, contestedA } = EXTRAS
  second(outlierA.observer, outlierA.unit, shifted(trueFigures(all[outlierA.unit]!, outlierA.unit), outlierA.shift), 0)
  second(contestedA.observer, contestedA.unit, shifted(trueFigures(all[contestedA.unit]!, contestedA.unit), contestedA.shift), 1)
  for (const [i, { observer, unit }] of EXTRAS.agreements.entries()) second(observer, unit, trueFigures(all[unit]!, unit), i + 2)
  return out
}

/** The correction of Observer 03's typo: the true figures, with a reason. */
export function correctionPlan(now: number) {
  const { observer, unit } = EXTRAS.correction
  return {
    observer,
    unit,
    figures: trueFigures(units()[unit]!, unit),
    submittedAt: now - 20 * 60,
    reason: `Typed ${EXTRAS.correction.typo} extra votes for Unity Party; corrected from the result sheet`,
  }
}

/** The unaccredited wallet's inflated result. */
export function roguePlan(now: number) {
  const { unit, votes_a } = EXTRAS.rogue
  return { unit, figures: { ...trueFigures(units()[unit]!, unit), votes_a }, submittedAt: now - 5 * 60, note: "Totally real" }
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
