import type { AnyArkivValue } from "@arkiv-network/sdk/attr"
import type { FullEntity } from "@arkiv-network/sdk"
import type { Address, Hex } from "viem"
import type { AttrValue, Row } from "./types"

const decoder = new TextDecoder()

/** Decodes one attribute: ordered numbers that fit become JS numbers, the rest stay strings. */
export function decodeAttr(value: AnyArkivValue): AttrValue {
  switch (value.type) {
    case "bool":
      return value.value
    case "i32":
      return value.value
    case "u64":
    case "u256": {
      const n = value.value
      return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString()
    }
    default:
      return String(value.value)
  }
}

function decodePayload(entity: FullEntity): unknown {
  const bytes = entity.payload
  if (!bytes || bytes.length === 0) return undefined
  const text = decoder.decode(bytes)
  if (entity.contentType?.startsWith("application/json")) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

/** Flattens an SDK entity (selected with `"*"`) into a row. */
export function toRow(entity: FullEntity): Row {
  const attrs: Record<string, AttrValue> = {}
  for (const [name, value] of Object.entries(entity.attributes ?? {})) {
    attrs[name] = decodeAttr(value)
  }
  return {
    key: entity.key as Hex,
    creator: (entity.creator as string).toLowerCase() as Address,
    owner: (entity.owner as string).toLowerCase() as Address,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    flags: {
      readonly: entity.creationFlags?.readonly ?? false,
      permissionlessExtension: entity.creationFlags?.permissionlessExtension ?? false,
    },
    attrs,
    payload: decodePayload(entity),
  }
}

/** An attribute, or a system field: `$key`, `$creator` or `$owner`. */
export function field(row: Row, name: string): AttrValue | undefined {
  if (name === "$key") return row.key
  if (name === "$creator") return row.creator
  if (name === "$owner") return row.owner
  return row.attrs[name]
}

/** Numeric attribute, or 0 when missing or non-numeric. */
export function num(row: Row, field: string): number {
  const value = row.attrs[field]
  return typeof value === "number" ? value : 0
}
