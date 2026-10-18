import { ExpirationTime } from "@arkiv-network/sdk"
import type { Row } from "@collate/core"
import { expiresIn } from "@collate/core/ui"
import { useMemo, useState } from "react"
import { collate, nameOf } from "../../lib/collate"
import { errorMessage, type Wallet } from "../../lib/wallet"
import { accreditationEntity } from "../../model/schema"
import { CardTitle, Icon } from "../ui"
import { checkObserver, parseObservers } from "./plan"
import { aliasOf, BLOCKS_PER_DAY, CopyButton, LEASE_DAYS, shortAddress, StatusLine, type Setup, type Status } from "./shared"

type Props = {
  wallet: Wallet
  id: string
  setup: Setup
  closesAt: number
  block: bigint | undefined
  refresh: () => Promise<Row[]>
  onNext: () => void
}

export function ObserversStep({ wallet, id, setup, closesAt, block, refresh, onNext }: Props) {
  const [status, setStatus] = useState<Status>()
  const [confirming, setConfirming] = useState<string | undefined>()
  const busy = status?.kind === "busy"
  const accredited = useMemo(() => new Set(setup.accreditations.map((r) => String(r.attrs.observer))), [setup.accreditations])

  /** Every write: wallet prompt, status line with the transaction, then one fresh read of the setup. */
  async function run(label: string, action: () => Promise<{ txHash: string }>): Promise<boolean> {
    setStatus({ kind: "busy", text: `${label}: confirm in your wallet…` })
    try {
      const res = await action()
      setStatus({ kind: "done", text: `${label}: done.`, link: collate.explorer.tx(res.txHash) })
      await refresh().catch(() => undefined)
      return true
    } catch (e) {
      setStatus({ kind: "error", text: `${label}: ${errorMessage(e)}` })
      return false
    }
  }

  if (!setup.election) {
    return (
      <section className="card">
        <CardTitle icon="users">3. Observers</CardTitle>
        <p className="notice">Create the election and its units first (steps 1 and 2). Observers are accredited for an election that exists on Arkiv.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <CardTitle icon="users" tone={setup.accreditations.length ? "good" : undefined}>
            3. Observers
          </CardTitle>
          <p>
            Only results posted by these wallets count for viewers who trust you. Each accreditation is a lease that ends {LEASE_DAYS}{" "}
            days after counting closes unless you extend it.
          </p>
        </div>
        <span className="pill">{setup.accreditations.length} accredited</span>
      </div>

      {setup.accreditations.length === 0 ? (
        <p className="coord-empty muted">No observers yet. Add the wallet of each observer below.</p>
      ) : (
        <ul className="feed coord-observers">
          {setup.accreditations.map((r) => {
            const observer = String(r.attrs.observer)
            const alias = aliasOf(r)
            return (
              <li key={r.key}>
                <span className="coord-observer">
                  <b>{alias}</b>
                  <span className="row">
                    <a className="mono small" href={collate.explorer.address(observer)} target="_blank" rel="noreferrer" title={observer}>
                      {shortAddress(observer)}
                    </a>
                    <CopyButton text={observer} label="Copy" title={`Copy ${alias}'s address`} />
                    {nameOf(observer) && nameOf(observer) !== alias && <span className="muted">({nameOf(observer)})</span>}
                  </span>
                </span>
                <span className="row">
                  <span className="collate-badge">expires in {expiresIn(r.expiresAt, block)}</span>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() =>
                      void run(`Extend ${alias}`, () =>
                        wallet.client.extendEntity({ entityKey: r.key, expires: ExpirationTime.atBlock(r.expiresAt + BLOCKS_PER_DAY * BigInt(LEASE_DAYS)) }),
                      )
                    }
                  >
                    Extend {LEASE_DAYS} days
                  </button>
                  <button type="button" className="btn btn-small coord-danger" disabled={busy} aria-expanded={confirming === r.key} onClick={() => setConfirming(confirming === r.key ? undefined : r.key)}>
                    Revoke
                  </button>
                </span>
                {confirming === r.key && (
                  <div className="coord-confirm" role="alert">
                    <p>
                      <b>Revoke {alias}?</b> This deletes the accreditation from Arkiv. Every result this observer posted, before and after,
                      stops counting for viewers who trust you; the results themselves stay public. You can accredit the wallet again
                      later.
                    </p>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-small coord-danger-solid"
                        disabled={busy}
                        onClick={() => void run(`Revoke ${alias}`, () => wallet.client.deleteEntity({ entityKey: r.key })).then(() => setConfirming(undefined))}
                      >
                        Revoke {alias}
                      </button>
                      <button type="button" className="btn btn-small" onClick={() => setConfirming(undefined)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <StatusLine status={status} />

      <AddObservers
        accredited={accredited}
        next={setup.accreditations.length + 1}
        busy={busy}
        onAdd={(observers) =>
          run(
            observers.length === 1 ? `Accredit ${observers[0]!.alias}` : `Accredit ${observers.length} observers`,
            () =>
              observers.length === 1
                ? wallet.client.createEntity(accreditationEntity(id, observers[0]!.address, observers[0]!.alias, closesAt))
                : wallet.client.executeBatch({ creates: observers.map((o) => accreditationEntity(id, o.address, o.alias, closesAt)) }),
          )
        }
      />

      <div className="row coord-actions">
        <button type="button" className="btn btn-primary" onClick={onNext}>
          Next: share →
        </button>
      </div>
    </section>
  )
}

type AddProps = {
  accredited: ReadonlySet<string>
  next: number
  busy: boolean
  onAdd: (observers: { address: string; alias: string }[]) => Promise<boolean>
}

function AddObservers({ accredited, next, busy, onAdd }: AddProps) {
  const [several, setSeveral] = useState(false)
  const [address, setAddress] = useState("")
  const [alias, setAlias] = useState("")
  const [lines, setLines] = useState("")
  const suggested = `Observer ${String(next).padStart(2, "0")}`
  const one = address || alias ? checkObserver(address.trim(), alias.trim() || suggested, accredited) : "empty"
  const many = useMemo(() => parseObservers(lines, accredited, next), [lines, accredited, next])

  return (
    <div className="coord-add">
      <div className="card-head">
        <h3 className="subhead">Add observers</h3>
        <div className="seg" role="group" aria-label="How to add">
          <button type="button" aria-pressed={!several} onClick={() => setSeveral(false)}>
            One
          </button>
          <button type="button" aria-pressed={several} onClick={() => setSeveral(true)}>
            Several
          </button>
        </div>
      </div>
      <p className="muted">
        Aliases are public and stored on Arkiv: use synthetic ones such as "Observer 07", never a real name. Testing alone? Accredit a
        second wallet of your own, then post from it on the observer page.
      </p>
      {!several ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!one) void onAdd([{ address: address.trim(), alias: alias.trim() || suggested }]).then((ok) => ok && (setAddress(""), setAlias("")))
          }}
        >
          <div className="field-row">
            <label className="field coord-grow-2">
              <span>Observer wallet</span>
              <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span>Alias</span>
              <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={suggested} maxLength={40} />
            </label>
          </div>
          {one && one !== "empty" && (address.trim().length >= 42 || alias) && <p className="small coord-error-text">{one}</p>}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={Boolean(one) || busy}>
              <Icon name="shield" size={15} /> Accredit
            </button>
          </div>
        </form>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (many.observers.length && !many.messages.length) void onAdd(many.observers).then((ok) => ok && setLines(""))
          }}
        >
          <label className="field">
            <span>One observer per line: address, alias</span>
            <textarea rows={5} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"0x4381…23cD, Observer 01\n0x7Acb…7d, Observer 02"} spellCheck={false} />
            <small>Without an alias, the next "Observer NN" is used. All of them are sent in one transaction.</small>
          </label>
          {many.messages.length > 0 && (
            <ul className="notice notice-error coord-problems">
              {many.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {many.observers.length > 0 && (
            <ul className="coord-preview small">
              {many.observers.map((o) => (
                <li key={o.address}>
                  <b>{o.alias}</b> <span className="mono muted">{shortAddress(o.address)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={!many.observers.length || many.messages.length > 0 || busy}>
              <Icon name="shield" size={15} /> Accredit {many.observers.length || ""} {many.observers.length === 1 ? "observer" : "observers"} in one transaction
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
