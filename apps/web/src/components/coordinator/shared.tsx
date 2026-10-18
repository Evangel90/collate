import type { Row } from "collate-core"
import { useEffect, useState } from "react"
import { collate } from "../../lib/collate"
import { DEFAULT_PARTIES } from "../../lib/data"
import { href } from "../../lib/router"
import type { Party } from "../../model/schema"
import { Icon } from "../ui"

export const LEASE_DAYS = 7
/** Tiramisu makes a block every 2 s. */
export const BLOCKS_PER_DAY = 43_200n

export type Status = { kind: "busy" | "error" | "done" | "warn"; text: string; link?: string } | undefined

export type StepId = "election" | "units" | "observers" | "share"
export const STEP_IDS: StepId[] = ["election", "units", "observers", "share"]

/** One election's setup as this wallet created it: the election, its units and accreditations. */
export type Setup = { election: Row | undefined; units: Row[]; accreditations: Row[] }

export function setupOf(rows: readonly Row[]): Setup {
  return {
    election: rows.find((r) => r.attrs.type === "election"),
    units: rows.filter((r) => r.attrs.type === "unit").sort((a, b) => String(a.attrs.unit_code).localeCompare(String(b.attrs.unit_code))),
    accreditations: rows.filter((r) => r.attrs.type === "accreditation").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  }
}

export type ElectionMeta = { name: string; description: string; parties: Party[]; quorum: number; opensAt: number; closesAt: number }

/** The election payload, read defensively: it is whatever the creating wallet wrote. */
export function metaOf(row: Row | undefined, fallbackName: string): ElectionMeta {
  const p = (row?.payload ?? {}) as { name?: unknown; description?: unknown; parties?: unknown; quorum?: unknown }
  const parties = Array.isArray(p.parties) && p.parties.length === 3 ? (p.parties as Party[]) : DEFAULT_PARTIES
  return {
    name: typeof p.name === "string" && p.name ? p.name : fallbackName,
    description: typeof p.description === "string" ? p.description : "",
    parties,
    quorum: Number.isInteger(p.quorum) && (p.quorum as number) >= 1 ? (p.quorum as number) : 1,
    opensAt: Number(row?.attrs.opens_at ?? 0),
    closesAt: Number(row?.attrs.closes_at ?? 0),
  }
}

export const aliasOf = (row: Row) => {
  const alias = (row.payload as { alias?: unknown } | undefined)?.alias
  return typeof alias === "string" && alias ? alias : "Observer"
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const formatDate = (unixSeconds: number) =>
  unixSeconds ? new Date(unixSeconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "not set"

/** A link to this app as an absolute URL, for sharing outside it. */
export function absoluteHref(path: string, params?: Record<string, string>): string {
  return `${window.location.origin}${window.location.pathname}${href(path, params)}`
}

/** Moves within the console; the URL holds the open election and step, so Back works. */
export function go(params: Record<string, string> = {}) {
  window.location.hash = href("/coordinate", params)
}

export function StatusLine({ status }: { status: Status }) {
  if (!status) return null
  const tone = status.kind === "error" ? "notice-error" : status.kind === "done" ? "notice-good" : status.kind === "warn" ? "notice-warn" : ""
  return (
    <p className={`notice ${tone}`} role="status">
      {status.text}{" "}
      {status.link && (
        <a href={status.link} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
    </p>
  )
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return null
  return (
    <a className="mono" href={collate.explorer.tx(hash)} target="_blank" rel="noreferrer">
      {hash.slice(0, 10)}… ↗
    </a>
  )
}

/** Copies `text`; says "Copied" for a moment. */
export function CopyButton({ text, label = "Copy", title }: { text: string; label?: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      className="btn btn-small"
      title={title}
      aria-label={title}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined)
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : label}
    </button>
  )
}
