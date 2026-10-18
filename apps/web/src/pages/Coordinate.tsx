import { describeError, eq, or, type Row, type Where } from "@collate/core"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ElectionList } from "../components/coordinator/ElectionList"
import { newDraft, Workspace } from "../components/coordinator/Workspace"
import { shortAddress, type Status, type StepId, STEP_IDS } from "../components/coordinator/shared"
import type { Draft } from "../components/coordinator/plan"
import { CardTitle } from "../components/ui"
import { collate, nameOf } from "../lib/collate"
import { useRoute } from "../lib/router"
import { useWallet, type Wallet } from "../lib/wallet"
import { setupQuery } from "../model/panels"
import "../coordinator.css"

/**
 * Everything this wallet set up, for every election, in one query: elections, units and
 * accreditations. The list and its counts come from it, and opening an election costs nothing
 * more: the session cache answers `setupQuery(election)` for this creator from these rows.
 */
const MINE: Where[] = [or(eq("type", "election"), eq("type", "unit"), eq("type", "accreditation"))]

export function Coordinate() {
  const { wallet, connect, error, hasProvider } = useWallet()

  return (
    <div className="grid coord">
      <section className="hero">
        <h1>Coordinator console</h1>
        <p>
          For observer groups. Register an election and its polling units, accredit the wallets of your observers, then share one
          link. Viewers who trust your group count only results posted by wallets you accredited.
        </p>
      </section>
      {!wallet ? <Connect connect={connect} error={error} hasProvider={hasProvider} /> : <Console wallet={wallet} />}
    </div>
  )
}

function Connect({ connect, error, hasProvider }: { connect: () => Promise<void>; error?: string; hasProvider: boolean }) {
  return (
    <section className="card coord-connect">
      <CardTitle icon="lock">Connect your coordinator wallet</CardTitle>
      <p className="small">
        The coordinator is the wallet an observer group trusts. It creates the election and its polling units, and accredits the
        observers whose results count. Everything it writes is public and signed by it, so viewers can check who set the election up.
      </p>
      <ol className="coord-howto">
        <li>Use a browser wallet such as MetaMask or Rabby. Collate asks it to switch to the Arkiv Tiramisu testnet (chain 7738577).</li>
        <li>
          Get free test GLM for gas from the{" "}
          <a href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">
            Arkiv faucet ↗
          </a>
          . Creating an election with a few dozen units costs well under 0.01 GLM.
        </li>
        <li>Use a fresh testnet wallet. Everything here is synthetic test data, never a real election.</li>
      </ol>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void connect()}>
          Connect wallet
        </button>
        {!hasProvider && <span className="muted">No browser wallet detected.</span>}
      </div>
      {error && <p className="notice notice-error">{error}</p>}
    </section>
  )
}

export type Mine = {
  rows: Row[] | undefined
  block: bigint | undefined
  error: string | undefined
  /** Re-reads one election straight from Arkiv (one query) and merges it in; returns its rows. */
  refresh: (election: string) => Promise<Row[]>
}

function useMine(address: string): Mine {
  const [rows, setRows] = useState<Row[] | undefined>()
  const [block, setBlock] = useState<bigint | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    setError(undefined)
    collate
      .fetchAll({ where: MINE, creators: [address], payload: true })
      .then((res) => {
        if (cancelled) return
        setRows(res.rows)
        setBlock(res.block)
      })
      .catch((e) => {
        if (cancelled) return
        const { message, retryAfterSeconds } = describeError(e)
        setError(message)
        // A spent read budget says when it resets: try once more then.
        if (retryAfterSeconds) retry = setTimeout(() => setAttempt((n) => n + 1), retryAfterSeconds * 1000)
      })
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [address, attempt])

  // A different account starts from nothing rather than showing the last one's elections.
  useEffect(() => setRows(undefined), [address])

  const refresh = useCallback(
    async (election: string) => {
      const res = await collate.fetchAll({ where: setupQuery(election), creators: [address], payload: true, fresh: true })
      setRows((prev) => [...(prev ?? []).filter((r) => r.attrs.election !== election), ...res.rows])
      setBlock((b) => (b === undefined || res.block > b ? res.block : b))
      return res.rows
    },
    [address],
  )

  return { rows, block, error, refresh }
}

function Console({ wallet }: { wallet: Wallet }) {
  const { params } = useRoute()
  const mine = useMine(wallet.address)
  const [draft, setDraft] = useState<Draft>(newDraft)
  const [flash, setFlash] = useState<{ election: string; status: Status }>()
  const election = params.get("election")?.trim() || undefined
  const isNew = params.has("new")
  const stepParam = params.get("step")
  const step = STEP_IDS.includes(stepParam as StepId) ? (stepParam as StepId) : undefined
  const myIds = useMemo(() => new Set((mine.rows ?? []).filter((r) => r.attrs.type === "election").map((r) => String(r.attrs.election))), [mine.rows])

  return (
    <>
      <p className="coord-account small">
        <span className="coord-dot" aria-hidden="true" />
        Coordinator wallet{" "}
        <a className="mono" href={collate.explorer.address(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
          {shortAddress(wallet.address)}
        </a>
        {nameOf(wallet.address) ? ` (${nameOf(wallet.address)})` : ""}
        <span className="muted"> · switch accounts in your wallet to act as another coordinator</span>
      </p>
      {isNew || election ? (
        <Workspace
          key={isNew ? "new" : election}
          wallet={wallet}
          mine={mine}
          myIds={myIds}
          election={isNew ? undefined : election}
          step={step}
          draft={draft}
          setDraft={setDraft}
          flash={flash && flash.election === election ? flash.status : undefined}
          onCreated={(status, id) => {
            setFlash({ election: id, status })
            setDraft(newDraft())
          }}
        />
      ) : (
        <ElectionList rows={mine.rows} error={mine.error} />
      )}
    </>
  )
}
