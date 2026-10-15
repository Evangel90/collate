import { eq, type Row } from "@collate/core"
import { expiresIn } from "@collate/core/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { Hex } from "viem"
import { collate, deployment, nameOf } from "../lib/collate"
import { DEFAULT_PARTIES, figures, useElection } from "../lib/data"
import { sha256File } from "../lib/hash"
import { href } from "../lib/router"
import { errorMessage, useWallet, type Wallet } from "../lib/wallet"
import { checkFigures, correctionEntity, resultEntity, type ResultFigures } from "../model/schema"

type Accreditation = { coordinator: string; group: string; row: Row }
const EMPTY: Record<keyof ResultFigures, string> = { votes_a: "", votes_b: "", votes_c: "", rejected: "", accredited: "" }

export function Observe() {
  const election = deployment.election
  const { wallet, connect, error: walletError, hasProvider } = useWallet()
  const [accreditations, setAccreditations] = useState<Accreditation[] | undefined>()
  const [mine, setMine] = useState<Row[]>([])
  const [block, setBlock] = useState<bigint | undefined>()

  const load = useCallback(async (w: Wallet) => {
    setAccreditations(undefined)
    const coordinators = deployment.coordinators.map((c) => c.address)
    const [acc, results] = await Promise.all([
      // Accreditations naming this wallet, but only those a known coordinator created.
      collate.fetchAll({ where: [eq("type", "accreditation"), eq("election", election), eq("observer", w.address)], creators: coordinators }),
      collate.fetchAll({ where: [eq("election", election)], creators: [w.address] }),
    ])
    setBlock(acc.block)
    setAccreditations(
      acc.rows.map((row) => {
        const c = deployment.coordinators.find((x) => x.address === row.creator)!
        return { coordinator: c.address, group: c.name, row }
      }),
    )
    setMine(results.rows.filter((r) => r.attrs.type === "unit_result" || r.attrs.type === "correction"))
  }, [election])

  useEffect(() => {
    if (wallet) void load(wallet)
  }, [wallet, load])

  return (
    <div className="grid">
      <section className="hero">
        <h1>Post a polling-unit result</h1>
        <p>
          For accredited observers. Your result becomes a public Arkiv entity, created by your wallet, that nobody can edit. Mistakes
          are fixed with a correction that sits beside the original.
        </p>
      </section>

      {!wallet ? (
        <section className="card">
          <h2>1. Connect the wallet your coordinator accredited</h2>
          <p className="muted">Collate asks your wallet to switch to the Arkiv Tiramisu testnet (chain 7738577).</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void connect()}>
              Connect wallet
            </button>
            {!hasProvider && <span className="muted">No browser wallet detected.</span>}
          </div>
          {walletError && <p className="notice notice-error">{walletError}</p>}
        </section>
      ) : (
        <AccreditationStatus wallet={wallet} accreditations={accreditations} block={block} />
      )}

      {wallet && accreditations && accreditations.length > 0 && (
        <SubmitForm
          wallet={wallet}
          coordinator={accreditations[0]!.coordinator}
          mine={mine}
          onPosted={() => void load(wallet)}
        />
      )}
    </div>
  )
}

function AccreditationStatus({ wallet, accreditations, block }: { wallet: Wallet; accreditations: Accreditation[] | undefined; block?: bigint }) {
  return (
    <section className="card">
      <h2>1. Accreditation</h2>
      <p className="small">
        Connected as <span className="mono">{wallet.address}</span>
        {nameOf(wallet.address) ? ` (${nameOf(wallet.address)})` : ""}
      </p>
      {accreditations === undefined ? (
        <p className="muted">Checking for a live accreditation on Arkiv…</p>
      ) : accreditations.length === 0 ? (
        <p className="notice notice-warn">
          No live accreditation for this wallet in {deployment.election}. Submitting is disabled: results from unaccredited wallets
          are ignored by every viewer. Ask a coordinator to accredit <span className="mono">{wallet.address}</span>.
        </p>
      ) : (
        <ul className="list-plain">
          {accreditations.map((a) => (
            <li key={a.row.key}>
              Accredited by <b>{a.group}</b> · lease expires in {expiresIn(a.row.expiresAt, block)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SubmitForm({ wallet, coordinator, mine, onPosted }: { wallet: Wallet; coordinator: string; mine: Row[]; onPosted: () => void }) {
  const election = deployment.election
  const info = useElection(election, coordinator)
  const parties = info.parties.length ? info.parties : DEFAULT_PARTIES
  const [unitCode, setUnitCode] = useState("")
  const [values, setValues] = useState(EMPTY)
  const [photo, setPhoto] = useState<{ name: string; hash: string } | undefined>()
  const [note, setNote] = useState("")
  const [corrects, setCorrects] = useState<Row | undefined>()
  const [reviewing, setReviewing] = useState(false)
  const [status, setStatus] = useState<{ kind: "busy" | "error" | "done"; text: string; link?: string } | undefined>()

  const units = useMemo(() => [...info.units].sort((a, b) => String(a.attrs.unit_code).localeCompare(String(b.attrs.unit_code))), [info.units])
  const unit = units.find((u) => u.attrs.unit_code === unitCode)
  const registered = Number(unit?.attrs.registered ?? 0)
  const numbers = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? NaN : Number(v)])) as unknown as ResultFigures
  const complete = Object.values(values).every((v) => v !== "")
  const problems = unit && complete ? checkFigures(numbers, registered) : []
  const postedUnits = new Set(mine.map((r) => String(r.attrs.unit_code)))

  function startCorrection(row: Row) {
    setCorrects(row)
    setUnitCode(String(row.attrs.unit_code))
    setValues(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, String(row.attrs[k] ?? "")])) as typeof EMPTY)
    setReviewing(false)
    setStatus(undefined)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function submit() {
    if (!unit) return
    setStatus({ kind: "busy", text: "Confirm the transaction in your wallet…" })
    const input = {
      ...numbers,
      election,
      unitCode,
      ward: String(unit.attrs.ward),
      lga: String(unit.attrs.lga),
      state: String(unit.attrs.state),
      submittedAt: Math.floor(Date.now() / 1000),
      photoSha256: photo?.hash,
      note,
    }
    try {
      const params = corrects ? correctionEntity(input, corrects.key as Hex, note || "Correction") : resultEntity(input)
      const res = await wallet.client.createEntity(params)
      setStatus({ kind: "done", text: `Posted. Entity ${res.entityKey.slice(0, 10)}… is live on Arkiv.`, link: collate.explorer.tx(res.txHash) })
      setValues(EMPTY)
      setPhoto(undefined)
      setNote("")
      setCorrects(undefined)
      setReviewing(false)
      onPosted()
    } catch (e) {
      setStatus({ kind: "error", text: errorMessage(e) })
    }
  }

  return (
    <>
      <section className="card">
        <h2>2. {corrects ? `Correct your result for ${unitCode}` : "Enter the unit's result"}</h2>
        {corrects && (
          <p className="notice notice-warn">
            Posting a correction for entity <span className="mono">{corrects.key.slice(0, 12)}…</span>. The original stays public;
            viewers count the correction instead.{" "}
            <button type="button" className="link-btn" onClick={() => { setCorrects(undefined); setValues(EMPTY) }}>
              Cancel
            </button>
          </p>
        )}
        <form className="form" onSubmit={(e) => { e.preventDefault(); if (!problems.length) setReviewing(true) }}>
          <label className="field">
            <span>Polling unit</span>
            <select value={unitCode} onChange={(e) => setUnitCode(e.target.value)} required disabled={Boolean(corrects)}>
              <option value="">{info.loading ? "Loading units from Arkiv…" : "Choose a unit"}</option>
              {units.map((u) => (
                <option key={u.key} value={String(u.attrs.unit_code)}>
                  {String(u.attrs.unit_code)} · {String(u.attrs.ward)}, {String(u.attrs.lga)}
                  {postedUnits.has(String(u.attrs.unit_code)) ? " (you posted)" : ""}
                </option>
              ))}
            </select>
            {unit && <small>{String((unit.payload as { name?: string })?.name ?? "")} · {registered.toLocaleString("en")} registered voters</small>}
          </label>
          <div className="field-row">
            <NumberField label="Accredited voters" value={values.accredited} onChange={(v) => setValues({ ...values, accredited: v })} />
            {parties.map((p) => (
              <NumberField key={p.field} label={p.name} value={values[p.field]} onChange={(v) => setValues({ ...values, [p.field]: v })} />
            ))}
            <NumberField label="Rejected ballots" value={values.rejected} onChange={(v) => setValues({ ...values, rejected: v })} />
          </div>
          <label className="field">
            <span>Result-sheet photo (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                setPhoto(file ? { name: file.name, hash: await sha256File(file) } : undefined)
              }}
            />
            <small>
              Hashed with SHA-256 in your browser; only the hash goes on Arkiv. Keep the photo with your group: anyone holding it can
              prove it matches.
            </small>
            {photo && <small className="mono">sha256 {photo.hash}</small>}
          </label>
          <label className="field">
            <span>{corrects ? "Reason for the correction" : "Note (optional)"}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder={corrects ? "e.g. Typed 418 instead of 148" : ""} />
            <small>Public. Do not include names, phone numbers or other personal data.</small>
          </label>
          {problems.map((p) => (
            <p key={p} className="notice notice-error">{p}</p>
          ))}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={!unit || !complete || problems.length > 0}>
              Review
            </button>
          </div>
        </form>
      </section>

      {reviewing && unit && (
        <section className="card">
          <h2>3. Review and sign</h2>
          <p className="small">
            {corrects ? "Correction" : "Result"} for <b>{unitCode}</b> ({String(unit.attrs.ward)}, {String(unit.attrs.lga)}, {String(unit.attrs.state)})
          </p>
          <p className="small mono">
            {parties.map((p) => `${p.short} ${numbers[p.field]}`).join(" · ")} · rejected {numbers.rejected} · accredited {numbers.accredited}
          </p>
          <p className="muted">
            This creates a readonly Arkiv entity from your wallet. It cannot be edited or deleted by anyone else, and anyone can extend
            its lifetime. It expires in 30 days unless extended.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={status?.kind === "busy"}>
              Sign and post to Arkiv
            </button>
            <button type="button" className="btn" onClick={() => setReviewing(false)}>
              Edit
            </button>
          </div>
        </section>
      )}

      {status && (
        <p className={`notice ${status.kind === "error" ? "notice-error" : status.kind === "done" ? "notice-good" : ""}`}>
          {status.text}{" "}
          {status.link && (
            <>
              <a href={status.link} target="_blank" rel="noreferrer">View transaction ↗</a> · <a href={href("/")}>See it on the results page</a>
            </>
          )}
        </p>
      )}

      <section className="card">
        <h2>Your posted results</h2>
        {mine.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="feed">
            {[...mine].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => (
              <li key={r.key}>
                <span>
                  <b>{String(r.attrs.unit_code)}</b> {r.attrs.type === "correction" ? <span className="pill">correction</span> : null}
                </span>
                <span className="row">
                  <a className="small" href={collate.explorer.entity(r.key)} target="_blank" rel="noreferrer">entity ↗</a>
                  <button type="button" className="btn btn-small" onClick={() => startCorrection(r)}>
                    Correct
                  </button>
                </span>
                <span className="meta" style={{ flexBasis: "100%" }}>{figures(r, parties)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} required />
    </label>
  )
}
