import type { Row } from "collate-core"
import { useMemo, useState } from "react"
import { href } from "../../lib/router"
import { useRateLimited } from "../Budget"
import { CardTitle, Icon, Skeleton } from "../ui"
import { ELECTION_ID } from "./plan"
import { formatDate, go, metaOf } from "./shared"

type Item = { id: string; name: string; units: number; observers: number; closesAt: number; createdAt: bigint }

/** The elections this wallet created, newest first, with counts from the same read. */
export function ElectionList({ rows, error }: { rows: Row[] | undefined; error?: string }) {
  const limited = useRateLimited()
  const items = useMemo<Item[] | undefined>(() => {
    if (!rows) return undefined
    const count = (id: string, type: string) => rows.filter((r) => r.attrs.type === type && r.attrs.election === id).length
    return rows
      .filter((r) => r.attrs.type === "election")
      .map((r) => {
        const id = String(r.attrs.election)
        const meta = metaOf(r, id)
        return { id, name: meta.name, units: count(id, "unit"), observers: count(id, "accreditation"), closesAt: meta.closesAt, createdAt: r.createdAt }
      })
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
  }, [rows])

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <CardTitle icon="database">Your elections</CardTitle>
          <p>Elections created by this wallet on Arkiv. Open one to add units, manage observers or share its results.</p>
        </div>
        <a className="btn btn-primary" href={href("/coordinate", { new: "1" })}>
          <Icon name="plus" size={16} /> New election
        </a>
      </div>

      {items === undefined ? (
        <>
          <Skeleton lines={3} height={18} />
          {limited ? (
            <p className="muted">Waiting for Arkiv's read budget to reset (see the notice above). The list loads by itself.</p>
          ) : error ? (
            <p className="notice notice-error">Could not read your elections from Arkiv: {error}</p>
          ) : null}
        </>
      ) : items.length === 0 ? (
        <div className="coord-empty">
          <p>
            <b>No elections from this wallet yet.</b>
          </p>
          <p className="muted">
            A new election takes four steps: its details, its polling units, the observers you accredit, then a link to share.
          </p>
        </div>
      ) : (
        <ul className="coord-elections">
          {items.map((e) => (
            <li key={e.id}>
              <a className="coord-election" href={href("/coordinate", { election: e.id })}>
                <span className="coord-election-main">
                  <b>{e.name}</b>
                  <span className="mono muted">{e.id}</span>
                </span>
                <span className="coord-election-meta">
                  <span className="pill">{e.units} {e.units === 1 ? "unit" : "units"}</span>
                  <span className="pill">{e.observers} {e.observers === 1 ? "observer" : "observers"}</span>
                  <span className="muted">{e.closesAt * 1000 > Date.now() ? `closes ${formatDate(e.closesAt)}` : `closed ${formatDate(e.closesAt)}`}</span>
                </span>
                <span className="btn btn-small coord-election-open">Open →</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <OpenById />
    </section>
  )
}

function OpenById() {
  const [id, setId] = useState("")
  const value = id.trim()
  const valid = ELECTION_ID.test(value)
  return (
    <details className="coord-advanced">
      <summary>Advanced: open an election by id</summary>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) go({ election: value })
        }}
      >
        <label className="field coord-grow">
          <span>Election id</span>
          <input className="mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="ward-3-by-election-k2x9" autoComplete="off" spellCheck={false} />
          <small>Only elections created by this wallet can be managed here.</small>
        </label>
        <button type="submit" className="btn" disabled={!valid}>
          Open
        </button>
      </form>
    </details>
  )
}
