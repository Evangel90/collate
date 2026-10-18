import type { Panel } from "./types.js"

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** Encodes a whole panel config into a URL-safe string. */
export function encodePanel(panel: Panel): string {
  return toBase64Url(JSON.stringify(panel))
}

/** Decodes a panel config produced by `encodePanel`, checking the fields it relies on. */
export function decodePanel(encoded: string): Panel {
  const panel = JSON.parse(fromBase64Url(encoded)) as Panel
  if (typeof panel !== "object" || panel === null) throw new Error("collate: panel is not an object")
  if (!Array.isArray(panel.query) || panel.query.length === 0) throw new Error("collate: panel has no query")
  if (panel.view !== "table" && panel.view !== "bar") panel.view = "table"
  panel.title = typeof panel.title === "string" ? panel.title : "Untitled panel"
  if (panel.quorum !== undefined && !(Number.isInteger(panel.quorum) && panel.quorum >= 1)) delete panel.quorum
  const self = panel.trust?.selfRegistration
  // A malformed open list is dropped rather than half-applied: without it the panel trusts less, never more.
  if (self !== undefined && !(Array.isArray(self?.listQuery) && self.listQuery.length > 0 && typeof self.addressField === "string" && self.addressField)) {
    delete panel.trust!.selfRegistration
  }
  return panel
}

/** Builds a link to a page that renders the panel, e.g. `shareUrl(base, panel)` → `base?panel=…`. */
export function shareUrl(base: string, panel: Panel, param = "panel"): string {
  const url = new URL(base)
  url.searchParams.set(param, encodePanel(panel))
  return url.toString()
}
