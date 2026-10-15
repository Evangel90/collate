import { useEffect, useRef, type ReactNode } from "react"
import type { Explorer } from "../client"
import type { Row } from "../types"
import { expiresIn, shortAddress } from "./format"

export type ProvenanceProps = {
  title: string
  rows: Row[]
  explorer: Explorer
  /** Human name for a creator wallet, e.g. an observer alias. */
  nameOf?: (address: string) => string | undefined
  /** One-line summary of a row's figures. */
  describe?: (row: Row) => ReactNode
  currentBlock?: bigint
  onClose: () => void
  /** Extra controls per row, e.g. an Extend button. */
  actions?: (row: Row) => ReactNode
}

/**
 * Who posted each number: creator wallet, entity explorer link and Entity Expiration. Trust is
 * read from `$creator`, which nobody can change after creation.
 */
export function Provenance({ title, rows, explorer, nameOf, describe, currentBlock, onClose, actions }: ProvenanceProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog ref={ref} className="collate-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <header className="collate-dialog-head">
        <h3>{title}</h3>
        <button type="button" className="collate-icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <p className="collate-muted">
        {rows.length} {rows.length === 1 ? "entity" : "entities"} on Arkiv. Each was created by the wallet shown; that creator can never be changed.
      </p>
      <ul className="collate-proof-list">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="collate-proof-main">
              <strong>{String(r.attrs.unit_code ?? r.attrs.type ?? "entity")}</strong>
              {describe && <span className="collate-proof-desc">{describe(r)}</span>}
            </div>
            <div className="collate-proof-meta">
              <span>
                by{" "}
                <a href={explorer.address(r.creator)} target="_blank" rel="noreferrer">
                  {nameOf?.(r.creator) ?? shortAddress(r.creator)}
                </a>
              </span>
              <a href={explorer.entity(r.key)} target="_blank" rel="noreferrer">
                entity {shortAddress(r.key)} ↗
              </a>
              <span className="collate-badge" title={`Expires at block ${r.expiresAt}`}>
                expires in {expiresIn(r.expiresAt, currentBlock)}
              </span>
              {actions?.(r)}
            </div>
          </li>
        ))}
      </ul>
    </dialog>
  )
}
