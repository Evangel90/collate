/** The panel configs Collate runs through @collate/core. Each is also an "Open in collate-core" link. */
import { eq, gt, or, v, type Panel, type TrustConfig } from "@collate/core"
import { PARTY_FIELDS } from "./schema"

export function trustFor(election: string, coordinator: string): TrustConfig {
  return {
    rootCreators: [coordinator as `0x${string}`],
    listQuery: [eq("type", "accreditation"), eq("election", election)],
    addressField: "observer",
  }
}

const resultTypes = or(eq("type", "unit_result"), eq("type", "correction"))

/**
 * Q4 plus Q8: results and corrections, trust-filtered by the chosen coordinator. A unit counts
 * only when at least `quorum` trusted observers agree and they are a majority of those who reported.
 */
export function resultsPanel(election: string, coordinator: string, groupBy: "state" | "lga" | "ward", quorum?: number): Panel {
  return {
    title: `Votes by ${groupBy.toUpperCase() === "LGA" ? "LGA" : groupBy}`,
    query: [resultTypes, eq("election", election)],
    trust: trustFor(election, coordinator),
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

/** Q6: results submitted in the last hour (range on a u64 attribute). */
export function latestPanel(election: string, coordinator: string, sinceSeconds: number): Panel {
  return {
    title: "Submitted in the last hour",
    query: [resultTypes, eq("election", election), gt("submitted_at", v.u64(sinceSeconds))],
    trust: trustFor(election, coordinator),
    view: "table",
  }
}

/** Q7: units with rejected ballots above a threshold. */
export function suspiciousPanel(election: string, coordinator: string, threshold: number): Panel {
  return {
    title: `Units with more than ${threshold} rejected ballots`,
    query: [resultTypes, eq("election", election), gt("rejected", v.u64(threshold))],
    trust: trustFor(election, coordinator),
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
