import type { Address, Hex } from "viem"

/** Typed scalar for a predicate. Plain numbers encode as `u64`, plain strings as `str`. */
export type TypedValue =
  | { type: "u64"; value: string }
  | { type: "i32"; value: number }
  | { type: "str"; value: string }
  | { type: "addr"; value: string }
  | { type: "key"; value: string }
  | { type: "bool"; value: boolean }

export type WhereValue = string | number | boolean | TypedValue

/**
 * A JSON-serialisable Arkiv predicate. Kept separate from the SDK's Expression class so that a
 * whole panel can be written into a URL and read back (see `share`).
 */
export type Where =
  | { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: WhereValue }
  | { op: "startsWith"; field: string; value: string }
  | { op: "or"; any: Where[] }
  | { op: "and"; all: Where[] }

/** A decoded attribute value: numbers for ordered types that fit, strings for everything else. */
export type AttrValue = string | number | boolean

/** One Arkiv entity, flattened for display and aggregation. */
export type Row = {
  key: Hex
  creator: Address
  owner: Address
  createdAt: bigint
  expiresAt: bigint
  flags: { readonly: boolean; permissionlessExtension: boolean }
  attrs: Record<string, AttrValue>
  /** Parsed JSON when the content type is JSON, text otherwise, `undefined` when not selected. */
  payload: unknown
}

export type TrustConfig = {
  /** Wallets whose list entities define who is trusted, e.g. the coordinator the viewer picked. */
  rootCreators: Address[]
  /** Predicates for the list entities, e.g. `type = "accreditation"`. */
  listQuery: Where[]
  /** Attribute on each list entity that holds the trusted wallet, e.g. `"observer"`. */
  addressField: string
  /** Optional attribute on list entities shown as the member's label. */
  labelField?: string
}

export type TrustMember = {
  address: Address
  /** The root creator that vouched for this wallet. */
  via: Address
  /** The list entity that grants trust, so a delete or expiry can be tracked. */
  grantKey: Hex
  grantExpiresAt: bigint
  label?: string
}

export type TrustSet = {
  roots: Address[]
  members: Map<string, TrustMember>
}

export type Panel = {
  title: string
  /** Every predicate must hold. */
  query: Where[]
  trust?: TrustConfig
  /** An attribute naming the key of an earlier entity by the same creator that this one replaces. */
  supersedeField?: string
  groupBy?: string
  sum?: string[]
  /** Rows sharing this attribute are one group, counted only when its sources reach consensus. */
  disputeKey?: string
  /** Fields compared when looking for agreement. Defaults to `sum`. */
  compareFields?: string[]
  /** Minimum number of sources that must agree before a group counts (default 1). */
  quorum?: number
  view: "table" | "bar"
  live?: boolean
  /** Also fetch matching entities from untrusted creators, to show what was ignored. */
  includeIgnored?: boolean
  /** Fetch payloads too (default off: Arkiv reads are metered, so a panel fetches only attributes). */
  payload?: boolean
  /** Human labels for attribute names, e.g. `{ votes_a: "Party A" }`. */
  labels?: Record<string, string>
}

export type SupersedeLink = { original: Row; by: Row }

export type Dispute = {
  key: string
  /** The latest entry from each source of a contested group. */
  entries: Row[]
}

/**
 * The verdict on one group of rows sharing a `disputeKey`. `certified`: the largest set of agreeing
 * sources reaches `quorum` and is a strict majority of those who reported. `pending`: not certified
 * and fewer than `quorum` sources so far. `contested`: neither.
 */
export type Consensus = {
  key: string
  status: "certified" | "contested" | "pending"
  quorum: number
  /** Number of sources that reported this group. */
  sources: number
  /** The agreeing majority, oldest first; empty unless certified. */
  agreeing: Row[]
  /** Certified groups only: sources that reported something else. */
  outliers: Row[]
  /** The latest entry from each source, oldest first. */
  entries: Row[]
}

export type AggRow = {
  group: string
  count: number
  sums: Record<string, number>
  min: Record<string, number>
  max: Record<string, number>
  /** Keys of the rows behind this group, for provenance. */
  keys: Hex[]
}

export type LiveStatus = "off" | "connecting" | "live" | "error"

export type PanelState = {
  status: "loading" | "ready" | "error"
  error?: string
  /** Block the snapshot was read at. */
  block?: bigint
  trust?: TrustSet
  /** Every trusted entity, including those replaced by a later one. */
  rows: Row[]
  /** Trusted entities still standing after supersession. */
  current: Row[]
  superseded: SupersedeLink[]
  /** Unkeyed rows plus one row per certified group; the input to aggregation. */
  resolved: Row[]
  /** Every keyed group with its status, sorted by key. */
  consensus: Consensus[]
  /** The contested groups only. Pending and contested groups never reach aggregation. */
  disputes: Dispute[]
  groups: AggRow[]
  total: AggRow
  /** Matching entities from untrusted creators (only with `includeIgnored`). */
  ignored: Row[]
  live: LiveStatus
  updatedAt: number
}
