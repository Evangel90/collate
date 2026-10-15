import { ExpirationTime } from "@arkiv-network/sdk"
import { eq, type Row } from "@collate/core"
import { expiresIn, usePanel } from "@collate/core/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isAddress } from "viem"
import { collate, deployment, nameOf } from "../lib/collate"
import { DEFAULT_PARTIES } from "../lib/data"
import { errorMessage, useWallet, type Wallet } from "../lib/wallet"
import { resultsPanel } from "../model/panels"
import { accreditationEntity, electionEntity, unitEntity, type UnitInput } from "../model/schema"

const LEASE_DAYS = 7
const BLOCKS_PER_DAY = 43_200n

type Status = { kind: "busy" | "error" | "done"; text: string; link?: string } | undefined

export function Coordinate() {
  const { wallet, connect, error } = useWallet()
  const [election, setElection] = useState(deployment.election)

  return (
    <div className="grid">
      <section className="hero">
        <h1>Coordinator console</h1>
        <p>
          For observer groups. Register an election and its polling units, accredit observer wallets, and revoke them. Viewers who
          trust your group count only results created by wallets you accredited.
        </p>
      </section>
      {!wallet ? (
        <section className="card">
          <h2>Connect your coordinator wallet</h2>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void connect()}>
              Connect wallet
            </button>
          </div>
          {error && <p className="notice notice-error">{error}</p>}
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <h2>Election</h2>
              <label className="field" style={{ minWidth: 220 }}>
                <span className="sr-only">Election id</span>
                <input value={election} onChange={(e) => setElection(e.target.value.trim())} aria-label="Election id" />
              </label>
            </div>
            <p className="small">
              Signed in as <span className="mono">{wallet.address}</span>
              {nameOf(wallet.address) ? ` (${nameOf(wallet.address)})` : ""}
            </p>
          </section>
          <Console wallet={wallet} election={election} />
        </>
      )}
    </div>
  )
}

function Console({ wallet, election }: { wallet: Wallet; election: string }) {
  const [electionRow, setElectionRow] = useState<Row | null | undefined>()
  const [accreditations, setAccreditations] = useState<Row[]>([])
  const [units, setUnits] = useState<Row[]>([])
  const [block, setBlock] = useState<bigint | undefined>()

  const load = useCallback(async () => {
    const mine = [wallet.address]
    const [e, a, u] = await Promise.all([
      collate.fetchAll({ where: [eq("type", "election"), eq("election", election)], creators: mine }),
      collate.fetchAll({ where: [eq("type", "accreditation"), eq("election", election)], creators: mine }),
      collate.fetchAll({ where: [eq("type", "unit"), eq("election", election)], creators: mine }),
    ])
    setElectionRow(e.rows[0] ?? null)
    setAccreditations(a.rows)
    setUnits(u.rows)
    setBlock(e.block)
  }, [wallet.address, election])

  useEffect(() => {
    void load()
  }, [load])

  if (electionRow === undefined) return <p className="muted">Reading your election from Arkiv…</p>
  if (electionRow === null) return <CreateElection wallet={wallet} election={election} onCreated={load} />

  const closesAt = Number(electionRow.attrs.closes_at ?? 0)
  return (
    <>
      <Accreditations wallet={wallet} election={election} closesAt={closesAt} rows={accreditations} block={block} onChange={load} />
      <MissingUnits wallet={wallet} election={election} units={units} />
    </>
  )
}

function CreateElection({ wallet, election, onCreated }: { wallet: Wallet; election: string; onCreated: () => void }) {
  const [name, setName] = useState("My election (synthetic)")
  const [closes, setCloses] = useState(() => new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10))
  const [csv, setCsv] = useState("unit_code,ward,lga,state,registered,name\nXX-01-01,Ward One,Area North,Lagos,800,Unit 1 (Town Hall)\nXX-01-02,Ward One,Area North,Lagos,650,Unit 2 (School)")
  const [status, setStatus] = useState<Status>()

  const parsed = useMemo(() => parseUnits(csv, election), [csv, election])

  async function create() {
    if ("error" in parsed) return
    setStatus({ kind: "busy", text: "Confirm the batch in your wallet…" })
    const now = Math.floor(Date.now() / 1000)
    try {
      // One batch: the election and all its units land together, or none of them do.
      const res = await wallet.client.executeBatch({
        creates: [
          electionEntity({ election, name, description: "Created in the Collate coordinator console.", parties: DEFAULT_PARTIES, opensAt: now, closesAt: Math.floor(new Date(closes).getTime() / 1000) }),
          ...parsed.units.map(unitEntity),
        ],
      })
      setStatus({ kind: "done", text: `Created the election and ${parsed.units.length} units in one transaction.`, link: collate.explorer.tx(res.txHash) })
      onCreated()
    } catch (e) {
      setStatus({ kind: "error", text: errorMessage(e) })
    }
  }

  return (
    <section className="card">
      <h2>Create election “{election}”</h2>
      <p className="muted">You have no election with this id yet. It will be created by your wallet together with its units, in one batch.</p>
      <div className="form">
        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Counting closes</span>
            <input type="date" value={closes} onChange={(e) => setCloses(e.target.value)} />
            <small>Accreditations lapse 7 days after this unless extended.</small>
          </label>
        </div>
        <label className="field">
          <span>Polling units (CSV)</span>
          <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <small>{"error" in parsed ? parsed.error : `${parsed.units.length} units`}. Synthetic data only.</small>
        </label>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={"error" in parsed || status?.kind === "busy"} onClick={() => void create()}>
            Create election and units
          </button>
        </div>
        <StatusLine status={status} />
      </div>
    </section>
  )
}

function parseUnits(csv: string, election: string): { units: UnitInput[] } | { error: string } {
  const lines = csv.trim().split("\n").map((l) => l.split(",").map((c) => c.trim()))
  const header = lines.shift()?.join(",")
  if (header !== "unit_code,ward,lga,state,registered,name") return { error: "The first line must be: unit_code,ward,lga,state,registered,name" }
  const units: UnitInput[] = []
  for (const [i, cells] of lines.entries()) {
    const [unitCode, ward, lga, state, registered, ...rest] = cells
    const n = Number(registered)
    if (!unitCode || !ward || !lga || !state || !Number.isInteger(n) || n < 0) return { error: `Line ${i + 2} is incomplete or has a bad registered count.` }
    units.push({ election, unitCode, ward, lga, state, registered: n, name: rest.join(",") || unitCode })
  }
  if (units.length === 0) return { error: "Add at least one unit." }
  return { units }
}

function Accreditations({ wallet, election, closesAt, rows, block, onChange }: { wallet: Wallet; election: string; closesAt: number; rows: Row[]; block?: bigint; onChange: () => void }) {
  const [address, setAddress] = useState("")
  const [alias, setAlias] = useState("")
  const [status, setStatus] = useState<Status>()

  async function run(label: string, action: () => Promise<{ txHash: string }>): Promise<boolean> {
    setStatus({ kind: "busy", text: `${label}: confirm in your wallet…` })
    try {
      const res = await action()
      setStatus({ kind: "done", text: `${label}: done.`, link: collate.explorer.tx(res.txHash) })
      onChange()
      return true
    } catch (e) {
      setStatus({ kind: "error", text: errorMessage(e) })
      return false
    }
  }

  const valid = isAddress(address) && alias.trim().length > 0
  return (
    <section className="card">
      <div className="card-head">
        <h2>Accredited observers</h2>
        <span className="pill">{rows.length}</span>
      </div>
      <p className="muted">An accreditation is a lease: it expires {LEASE_DAYS} days after counting closes unless you extend it. Revoking deletes it.</p>
      <ul className="feed">
        {rows.map((r) => {
          const observer = String(r.attrs.observer)
          const label = (r.payload as { alias?: string })?.alias ?? nameOf(observer) ?? "Observer"
          return (
            <li key={r.key}>
              <span>
                <b>{label}</b> <span className="mono muted">{observer.slice(0, 10)}…</span>
              </span>
              <span className="row">
                <span className="collate-badge">expires in {expiresIn(r.expiresAt, block)}</span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => void run(`Extend ${label}`, () => wallet.client.extendEntity({ entityKey: r.key, expires: ExpirationTime.atBlock(r.expiresAt + BLOCKS_PER_DAY * BigInt(LEASE_DAYS)) }))}
                >
                  Extend {LEASE_DAYS} days
                </button>
                <button type="button" className="btn btn-small" onClick={() => void run(`Revoke ${label}`, () => wallet.client.deleteEntity({ entityKey: r.key }))}>
                  Revoke
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (valid) void run(`Accredit ${alias}`, () => wallet.client.createEntity(accreditationEntity(election, address, alias.trim(), closesAt))).then((ok) => { if (ok) { setAddress(""); setAlias("") } }) }}>
        <div className="field-row">
          <label className="field">
            <span>Observer wallet</span>
            <input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" />
          </label>
          <label className="field">
            <span>Alias</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Observer 13" maxLength={40} />
            <small>Public. Use a synthetic alias, never a real name.</small>
          </label>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            Accredit
          </button>
        </div>
      </form>
      <StatusLine status={status} />
    </section>
  )
}

function MissingUnits({ wallet, election, units }: { wallet: Wallet; election: string; units: Row[] }) {
  const panel = useMemo(() => ({ ...resultsPanel(election, wallet.address, "state"), includeIgnored: false }), [election, wallet.address])
  const { state } = usePanel(collate, panel)
  const reported = new Set((state?.current ?? []).map((r) => String(r.attrs.unit_code)))
  const missing = units.filter((u) => !reported.has(String(u.attrs.unit_code)))
  return (
    <section className="card">
      <div className="card-head">
        <h2>Units with no result from your observers</h2>
        <span className="pill">{state?.status === "ready" ? `${missing.length} of ${units.length}` : "…"}</span>
      </div>
      <p className="small">{missing.map((u) => String(u.attrs.unit_code)).join(", ") || "Every unit has a result."}</p>
      {state?.disputes.length ? <p className="notice notice-warn">{state.disputes.length} of your units are disputed between your own observers.</p> : null}
    </section>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null
  return (
    <p className={`notice ${status.kind === "error" ? "notice-error" : status.kind === "done" ? "notice-good" : ""}`}>
      {status.text}{" "}
      {status.link && (
        <a href={status.link} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
    </p>
  )
}
