import { eq, type Row } from "@collate/core"
import { expiresIn } from "@collate/core/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { formatEther, isAddress, type Hex } from "viem"
import { collate, deployment, nameOf } from "../lib/collate"
import { CardTitle, Skeleton } from "../components/ui"
import { DEFAULT_PARTIES, figures, useElection } from "../lib/data"
import { sha256File } from "../lib/hash"
import { href } from "../lib/router"
import { errorMessage, useWallet, type Wallet } from "../lib/wallet"
import { sandboxQuery, setupQuery } from "../model/panels"
import { checkFigures, correctionEntity, resultEntity, sandboxRegistrationEntity, type ResultFigures } from "../model/schema"

type Accreditation = { coordinator: string; group: string; row: Row }
/** `demo`: the demo election and its two groups, where the Open sandbox is offered. */
type Scope = { election: string; coordinators: string[]; demo: boolean }

const FAUCET = "https://hub.arkiv.network/faucet"
const groupA = deployment.coordinators[0]!

/**
 * Which election and coordinators this page checks. A link from the coordinator console names
 * both (`?election=…&coordinator=…`); without one, it is the demo election and its two groups.
 */
function scopeFrom(params?: URLSearchParams): Scope {
  const election = params?.get("election")?.trim()
  const coordinator = params?.get("coordinator")?.trim().toLowerCase()
  if (election && coordinator && isAddress(coordinator)) return { election, coordinators: [coordinator], demo: false }
  const chosen = election || deployment.election
  return { election: chosen, coordinators: deployment.coordinators.map((c) => c.address), demo: chosen === deployment.election }
}

/** A public, synthetic alias derived from the address, e.g. "Tester 4f2a". Never a real name. */
const syntheticAlias = (address: string) => `Tester ${address.slice(2, 6).toLowerCase()}`

/** The wallet's own Open sandbox registration, if it has one: created by it and naming it. */
const ownRegistration = (rows: Row[], address: string) =>
  rows.find((r) => r.attrs.type === "sandbox_registration" && r.creator === address && String(r.attrs.observer).toLowerCase() === address)

const groupName = (address: string) =>
  deployment.coordinators.find((c) => c.address === address)?.name ?? `coordinator ${address.slice(0, 10)}…`
const EMPTY: Record<keyof ResultFigures, string> = { votes_a: "", votes_b: "", votes_c: "", rejected: "", accredited: "" }

export function Observe({ params }: { params?: URLSearchParams }) {
  const scope = useMemo(() => scopeFrom(params), [params])
  const { election, coordinators } = scope
  const { wallet, connect, error: walletError, hasProvider } = useWallet()
  const [accreditations, setAccreditations] = useState<Accreditation[] | undefined>()
  const [mine, setMine] = useState<Row[]>([])
  const [registration, setRegistration] = useState<Row | undefined>()
  const [block, setBlock] = useState<bigint | undefined>()

  /** `fresh` after posting or joining, so the new entity shows instead of a cached list. */
  const load = useCallback(async (w: Wallet, fresh = false) => {
    setAccreditations(undefined)
    // The setup read (election, units, accreditations of every coordinator) is what the form needs
    // anyway; started first, it also answers Q9 below in the browser, so this page costs 2 queries.
    void collate.fetchAll({ where: setupQuery(election), creators: coordinators, payload: true }).catch(() => undefined)
    const [acc, own] = await Promise.all([
      // Accreditations naming this wallet, but only those a known coordinator created.
      collate.fetchAll({ where: [eq("type", "accreditation"), eq("election", election), eq("observer", w.address)], creators: coordinators }),
      // Everything this wallet created for the election: its results, and its sandbox registration if any.
      collate.fetchAll({ where: [eq("election", election)], creators: [w.address], payload: true, fresh }),
    ])
    setBlock(own.block > acc.block ? own.block : acc.block)
    setAccreditations(
      acc.rows.map((row) => {
        const coordinator = row.creator.toLowerCase()
        return { coordinator, group: groupName(coordinator), row }
      }),
    )
    setMine(own.rows.filter((r) => r.attrs.type === "unit_result" || r.attrs.type === "correction"))
    setRegistration(ownRegistration(own.rows, w.address))
  }, [election, coordinators])

  const joined = useCallback(
    (w: Wallet) => {
      // Refresh the session cache's registration list too, so the results page counts this wallet at once.
      void collate.fetchAll({ where: sandboxQuery(election), payload: true, fresh: true }).catch(() => undefined)
      void load(w, true)
    },
    [election, load],
  )

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
          {scope.demo ? " Not accredited? Connect any wallet and join the Open sandbox to try it." : ""}
        </p>
      </section>

      {!wallet ? (
        <section className="card">
          <CardTitle icon="lock">{scope.demo ? "Connect your wallet" : "Connect the wallet your coordinator accredited"}</CardTitle>
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
        <AccreditationStatus
          wallet={wallet}
          election={election}
          accreditations={accreditations}
          registration={scope.demo ? registration : undefined}
          block={block}
        />
      )}

      {wallet && accreditations && accreditations.length === 0 && scope.demo && !registration && (
        <SandboxJoin wallet={wallet} scope={scope} onJoined={() => joined(wallet)} />
      )}

      {wallet && accreditations && (accreditations.length > 0 || (scope.demo && registration)) && (
        <SubmitForm
          wallet={wallet}
          scope={scope}
          coordinator={accreditations[0]?.coordinator ?? groupA.address}
          sandbox={accreditations.length === 0}
          mine={mine}
          onPosted={() => void load(wallet, true)}
        />
      )}
    </div>
  )
}

function AccreditationStatus({ wallet, election, accreditations, registration, block }: { wallet: Wallet; election: string; accreditations: Accreditation[] | undefined; registration?: Row; block?: bigint }) {
  const alias = (registration?.payload as { alias?: unknown } | undefined)?.alias
  return (
    <section className="card">
      <CardTitle icon="shield">Accreditation</CardTitle>
      <p className="small">
        Connected as <span className="mono">{wallet.address}</span>
        {nameOf(wallet.address) ? ` (${nameOf(wallet.address)})` : ""}
      </p>
      {accreditations === undefined ? (
        <Skeleton lines={2} />
      ) : accreditations.length === 0 && registration ? (
        <div className="stack">
          <p className="notice notice-good">
            <b>Registered in the Open sandbox</b>
            {typeof alias === "string" && alias ? ` as ${alias}` : ""} · expires in {expiresIn(registration.expiresAt, block)}
          </p>
          <p className="muted">
            Your results count in the <a href={href("/results", { group: "sandbox" })}>Open sandbox view</a> only. {groupA.name} and{" "}
            {deployment.coordinators[1]?.name ?? "other groups"} did not accredit this wallet, so their views list your results as
            not counted.
          </p>
        </div>
      ) : accreditations.length === 0 ? (
        <p className="notice notice-warn">
          No live accreditation for this wallet in {election}. Results from unaccredited wallets are ignored in every observer group's
          view. Ask a coordinator to accredit <span className="mono" style={{ overflowWrap: "anywhere" }}>{wallet.address}</span>.
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

type Balance = { status: "loading" } | { status: "ready"; wei: bigint } | { status: "error"; message: string }

/** The wallet's GLM balance. `getBalance` is a plain RPC call, not a metered Arkiv query. */
function useBalance(address: string): [Balance, () => void] {
  const [balance, setBalance] = useState<Balance>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setBalance({ status: "loading" })
    collate.clients.http
      .getBalance({ address: address as Hex })
      .then((wei) => !cancelled && setBalance({ status: "ready", wei }))
      .catch((e) => !cancelled && setBalance({ status: "error", message: errorMessage(e) }))
    return () => {
      cancelled = true
    }
  }, [address, attempt])
  return [balance, () => setAttempt((n) => n + 1)]
}

/**
 * The way in for anyone without an accreditation: a `sandbox_registration` created by the wallet
 * itself. Viewers who pick the Open sandbox count it; Group A and B never do.
 */
function SandboxJoin({ wallet, scope, onJoined }: { wallet: Wallet; scope: Scope; onJoined: () => void }) {
  const { election } = scope
  // Same scope as the page's setup read, so the session cache answers it: the close date sets the expiry.
  const info = useElection(election, groupA.address, scope.coordinators)
  const [alias, setAlias] = useState(() => syntheticAlias(wallet.address))
  const [balance, recheck] = useBalance(wallet.address)
  const [status, setStatus] = useState<{ kind: "busy" | "error" | "done"; text: string; link?: string } | undefined>()
  const closesAt = Number(info.row?.attrs.closes_at ?? 0)
  const expires = new Date(Math.max(closesAt + 7 * 86_400, Math.floor(Date.now() / 1000) + 86_400) * 1000)
  const empty = balance.status === "ready" && balance.wei === 0n
  const name = alias.trim()
  // Say why the button is disabled instead of leaving a dead button.
  const blocked =
    status?.kind === "busy" ? "Waiting for your wallet…" :
    status?.kind === "done" ? "This wallet has joined." :
    !name ? "Enter an alias first." :
    empty ? "Needs test GLM first (see above)." :
    balance.status === "loading" ? "Checking this wallet's GLM balance…" :
    info.loading ? "Loading the demo election from Arkiv…" :
    undefined

  async function join() {
    setStatus({ kind: "busy", text: "Confirm the transaction in your wallet…" })
    try {
      const res = await wallet.client.createEntity(sandboxRegistrationEntity(election, wallet.address, name, closesAt))
      setStatus({ kind: "done", text: `Joined. Registration ${res.entityKey.slice(0, 10)}… is on Arkiv.`, link: collate.explorer.tx(res.txHash) })
      onJoined()
    } catch (e) {
      setStatus({ kind: "error", text: errorMessage(e) })
    }
  }

  return (
    <section className="card" aria-labelledby="sandbox-h">
      <CardTitle icon="users" id="sandbox-h">Try it: join the Open sandbox as an observer</CardTitle>
      <p>
        {groupA.name} and {deployment.coordinators[1]?.name ?? "Group B"} count only observers they accredited, so a result from this
        wallet would be listed as not counted. The Open sandbox is a third view on the results page: {groupA.name}'s observers plus
        anyone who joins. Join, and you can post results for any unit, agreeing or disagreeing with what is there.
      </p>
      <p className="muted">
        Your results then count in the Open sandbox view only, not in {groupA.name} or {deployment.coordinators[1]?.name ?? "Group B"}.
        Joining creates one readonly entity from your wallet (<span className="mono">sandbox_registration</span>, naming your address)
        that expires on {expires.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. It counts only
        because your wallet created it, so nobody can join on your behalf.
      </p>
      {balance.status === "ready" && !empty && <p className="small">Balance: {Number(formatEther(balance.wei)).toLocaleString("en", { maximumFractionDigits: 4 })} GLM on Tiramisu</p>}
      {empty && (
        <p className="notice notice-warn">
          Writes on Arkiv need test GLM, and this wallet has none on Tiramisu. Get some free from the{" "}
          <a href={FAUCET} target="_blank" rel="noreferrer">Arkiv faucet</a>, then{" "}
          <button type="button" className="link-btn" onClick={recheck}>check again</button>.
        </p>
      )}
      {balance.status === "error" && <p className="muted">Could not read this wallet's balance ({balance.message}). You can still try to join.</p>}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void join() }}>
        <label className="field">
          <span>Alias</span>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} required />
          <small>Public, and shown next to your results. Use a made-up name, never your real one.</small>
        </label>
        <div className="row">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={blocked !== undefined}
          >
            Join the Open sandbox
          </button>
          {blocked && <span className="muted">{blocked}</span>}
          {info.error && <span className="muted">Could not load the election: {info.error}</span>}
        </div>
      </form>
      {status && (
        <p className={`notice ${status.kind === "error" ? "notice-error" : status.kind === "done" ? "notice-good" : ""}`}>
          {status.text} {status.link && <a href={status.link} target="_blank" rel="noreferrer">View transaction ↗</a>}
        </p>
      )}
    </section>
  )
}

function SubmitForm({ wallet, scope, coordinator, sandbox, mine, onPosted }: { wallet: Wallet; scope: Scope; coordinator: string; sandbox: boolean; mine: Row[]; onPosted: () => void }) {
  const { election } = scope
  // Same scope as the page's setup read, so the session cache answers it.
  const info = useElection(election, coordinator, scope.coordinators)
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
  const resultsLink = sandbox ? href("/results", { group: "sandbox" }) : href("/results", { election, coordinator })

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
        <CardTitle icon={corrects ? "edit" : "upload"}>{corrects ? `Correct your result for ${unitCode}` : "Enter the unit's result"}</CardTitle>
        {sandbox && (
          <p className="small">
            Posting in the <b>Open sandbox</b>: this result counts in the{" "}
            <a href={resultsLink}>Open sandbox view</a> only. To see consensus at work, pick a unit that already has a result and
            enter the same figures (it becomes certified by two observers) or different ones (it becomes contested).
          </p>
        )}
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
          <CardTitle icon="eye">Review and sign</CardTitle>
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
              <a href={status.link} target="_blank" rel="noreferrer">View transaction ↗</a> · <a href={resultsLink}>See it on the results page</a>
            </>
          )}
        </p>
      )}

      <section className="card">
        <CardTitle icon="clock">Your posted results</CardTitle>
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
