import { addr, bool, i32, key, str, u64, type ArkivValue } from "@arkiv-network/sdk/attr"
import * as q from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { TypedValue, Where, WhereValue } from "./types.js"

type Comparable = "eq" | "gt" | "gte" | "lt" | "lte"

const cmp =
  (op: Comparable) =>
  (field: string, value: WhereValue): Where => ({ op, field, value })

/** `field = value` */
export const eq = cmp("eq")
/** `field > value`; ordered types only. */
export const gt = cmp("gt")
/** `field >= value`; ordered types only. */
export const gte = cmp("gte")
/** `field < value`; ordered types only. */
export const lt = cmp("lt")
/** `field <= value`; ordered types only. */
export const lte = cmp("lte")
export const startsWith = (field: string, value: string): Where => ({ op: "startsWith", field, value })
export const or = (...any: Where[]): Where => ({ op: "or", any })
export const and = (...all: Where[]): Where => ({ op: "and", all })

/** Typed value helpers, for when the default encoding is not the one stored. */
export const v = {
  u64: (n: number | bigint | string): TypedValue => ({ type: "u64", value: String(n) }),
  i32: (n: number): TypedValue => ({ type: "i32", value: n }),
  str: (s: string): TypedValue => ({ type: "str", value: s }),
  addr: (a: string): TypedValue => ({ type: "addr", value: a }),
  key: (k: string): TypedValue => ({ type: "key", value: k }),
  bool: (b: boolean): TypedValue => ({ type: "bool", value: b }),
}

/**
 * Converts a value to the SDK's typed form. Non-negative integers become `u64`, which is the
 * convention for counts and timestamps; pass `v.i32(...)` explicitly for signed values.
 */
export function toArkivValue(value: WhereValue): ArkivValue {
  if (typeof value === "string") return str(value)
  if (typeof value === "boolean") return bool(value)
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0) return u64(value)
    if (Number.isInteger(value)) return i32(value)
    throw new Error(`collate: ${value} is not an integer; Arkiv has no float type (use dec)`)
  }
  switch (value.type) {
    case "u64":
      return u64(value.value)
    case "i32":
      return i32(value.value)
    case "str":
      return str(value.value)
    case "addr":
      return addr(value.value)
    case "key":
      return key(value.value as Hex)
    case "bool":
      return bool(value.value)
  }
}

/** Converts one serialisable predicate to an SDK expression. */
export function toExpression(where: Where): q.Expression {
  switch (where.op) {
    case "eq":
      return q.eq(where.field, toArkivValue(where.value))
    case "gt":
      return q.gt(where.field, toArkivValue(where.value))
    case "gte":
      return q.gte(where.field, toArkivValue(where.value))
    case "lt":
      return q.lt(where.field, toArkivValue(where.value))
    case "lte":
      return q.lte(where.field, toArkivValue(where.value))
    case "startsWith":
      return q.startsWith(where.field, where.value)
    case "or":
      return q.or(where.any.map(toExpression))
    case "and":
      return q.and(where.all.map(toExpression))
  }
}

/** The query text the node will parse, for display and reproduction. */
export function renderWhere(where: Where[]): string {
  if (where.length === 0) return ""
  return q.and(where.map(toExpression)).toString()
}

/** Restricts to entities created by any of these wallets. */
export function createdByAny(creators: readonly string[]): Where {
  if (creators.length === 0) throw new Error("collate: createdByAny needs at least one creator")
  const parts = creators.map((c) => eq("$creator", v.addr(c)))
  return parts.length === 1 ? parts[0]! : or(...parts)
}
