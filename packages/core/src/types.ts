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
  /** Groups where trusted sources disagree on this key are flagged instead of counted. */
  disputeKey?: string
  /** Fields compared when looking for disagreement. Defaults to `sum`. */
  compareFields?: string[]
  view: "table" | "bar"
  live?: boolean
  /** Also fetch matching entities from untrusted creators, to show what was ignored. */
  includeIgnored?: boolean
  /** Human labels for attribute names, e.g. `{ votes_a: "Party A" }`. */
  labels?: Record<string, string>
}

export type SupersedeLink = { original: Row; by: Row }

export type Dispute = {
  key: string
  /** The latest entry from each disagreeing source. */
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
  /** One row per dispute key that is not in dispute; the input to aggregation. */
  resolved: Row[]
  disputes: Dispute[]
  groups: AggRow[]
  total: AggRow
  /** Matching entities from untrusted creators (only with `includeIgnored`). */
  ignored: Row[]
  live: LiveStatus
  updatedAt: number
}
