/** The panel configs Collate runs through @collate/core. Each is also an "Open in Studio" link. */
import { eq, gt, or, v, type Panel, type TrustConfig, type Where } from "@collate/core"
import { PARTY_FIELDS } from "./schema"

/**
 * The coordinator's accreditations; with `sandbox`, also every wallet that registered itself for
 * the election (the Open sandbox). A registration counts only for the wallet that created it.
 */
export function trustFor(election: string, coordinator: string, sandbox = false): TrustConfig {
  return {
    rootCreators: [coordinator as `0x${string}`],
    listQuery: [eq("type", "accreditation"), eq("election", election)],
    addressField: "observer",
    ...(sandbox ? { selfRegistration: { listQuery: sandboxQuery(election), addressField: "observer" } } : {}),
  }
}

/** Q10: Open sandbox registrations for the election, from any wallet. */
export function sandboxQuery(election: string): Where[] {
  return [eq("type", "sandbox_registration"), eq("election", election)]
}

const resultTypes = or(eq("type", "unit_result"), eq("type", "correction"))

/**
 * Q4′: every result and correction for the election, from any wallet. The results page, its
 * "Open in Studio" link and the landing page's live stat all read exactly this, so collate-core's
 * session cache answers all of them with one query.
 */
export function resultsQuery(election: string): Where[] {
  return [resultTypes, eq("election", election)]
}

/**
 * Q1+Q2+Q3 in one query: the election, its polling units and the accreditations, for every
 * coordinator on the page at once. Trust resolution (Q3) and switching group are then answered
 * from it in the browser by collate-core's cache, at no extra query.
 */
export function setupQuery(election: string): Where[] {
  return [or(eq("type", "election"), eq("type", "unit"), eq("type", "accreditation")), eq("election", election)]
}

/**
 * Q4 plus Q8: results and corrections, trust-filtered by the chosen coordinator. A unit counts
 * only when at least `quorum` trusted observers agree and they are a majority of those who reported.
 */
export function resultsPanel(election: string, coordinator: string, groupBy: "state" | "lga" | "ward", quorum?: number, sandbox = false): Panel {
  return {
    title: `Votes by ${groupBy.toUpperCase() === "LGA" ? "LGA" : groupBy}`,
    query: resultsQuery(election),
    trust: trustFor(election, coordinator, sandbox),
    supersedeField: "corrects",
    disputeKey: "unit_code",
    groupBy,
    sum: [...PARTY_FIELDS, "rejected", "accredited"],
    compareFields: [...PARTY_FIELDS, "rejected", "accredited"],
    quorum,
    view: "bar",
    live: true,
    includeIgnored: true,
    // Generic labels: party names live in each election's payload, which this config does not read.
    labels: { votes_a: "Party A votes", votes_b: "Party B votes", votes_c: "Party C votes", rejected: "Rejected", accredited: "Accredited" },
  }
}

/** Q5: one state. */
export function statePanel(election: string, coordinator: string, state: string): Panel {
  return { ...resultsPanel(election, coordinator, "lga"), title: `${state}: votes by LGA`, query: [resultTypes, eq("election", election), eq("state", state)] }
}

/** Q6: results submitted after a unix time (range on a u64 attribute). */
export function latestPanel(election: string, coordinator: string, sinceSeconds: number, sandbox = false): Panel {
  return {
    title: "Latest submissions",
    query: [resultTypes, eq("election", election), gt("submitted_at", v.u64(sinceSeconds))],
    trust: trustFor(election, coordinator, sandbox),
    view: "table",
  }
}

/** Q7: units with rejected ballots above a threshold. */
export function suspiciousPanel(election: string, coordinator: string, threshold: number, sandbox = false): Panel {
  return {
    title: `Units with more than ${threshold} rejected ballots`,
    query: [resultTypes, eq("election", election), gt("rejected", v.u64(threshold))],
    trust: trustFor(election, coordinator, sandbox),
    supersedeField: "corrects",
    view: "table",
  }
}

/** Q2: the polling units the coordinator registered. */
export function unitsPanel(election: string, coordinator: string): Panel {
  return {
    title: "Polling units",
    query: [eq("type", "unit"), eq("election", election), eq("$creator", v.addr(coordinator))],
    groupBy: "state",
    sum: ["registered"],
    view: "table",
  }
}
