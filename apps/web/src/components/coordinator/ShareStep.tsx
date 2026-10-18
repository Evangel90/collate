import { usePanel } from "collate-core/ui"
import { useMemo } from "react"
import { collate } from "../../lib/collate"
import { href } from "../../lib/router"
import type { Wallet } from "../../lib/wallet"
import { resultsPanel } from "../../model/panels"
import { useRateLimited } from "../Budget"
import { CardTitle, Icon, Skeleton } from "../ui"
import { absoluteHref, aliasOf, CopyButton, shortAddress, type ElectionMeta, type Setup } from "./shared"

type Props = { wallet: Wallet; id: string; setup: Setup; meta: ElectionMeta; onObservers: () => void }

export function ShareStep({ wallet, id, setup, meta, onObservers }: Props) {
  if (!setup.election) {
    return (
      <section className="card">
        <CardTitle icon="link">4. Share</CardTitle>
        <p className="notice">Create the election first (steps 1 and 2). The links below only work once it exists on Arkiv.</p>
      </section>
    )
  }
  const params = { election: id, coordinator: wallet.address }
  const results = absoluteHref("/results", params)
  const observe = absoluteHref("/observe", params)
  const instructions = [
    `To post results for "${meta.name}":`,
    `1. Open ${observe}`,
    "2. Connect the wallet the coordinator accredited (Collate switches it to the Arkiv Tiramisu testnet; get test GLM for gas at https://hub.arkiv.network/faucet).",
    "3. Pick your polling unit, enter the figures from the result sheet, review and sign.",
  ].join("\n")

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <CardTitle icon="link">4. Share</CardTitle>
            <p>Two links: one for anyone who wants to watch the count, one for your observers.</p>
          </div>
        </div>

        <div className="coord-share">
          <h3 className="subhead">Results link</h3>
          <p className="muted">Anyone who opens it counts only results from the observers you accredited, recomputed in their own browser.</p>
          <div className="coord-link">
            <input className="mono" readOnly value={results} aria-label="Results link" onFocus={(e) => e.target.select()} />
            <CopyButton text={results} label="Copy link" />
            <a className="btn btn-small" href={href("/results", params)}>
              Open →
            </a>
          </div>
        </div>

        <div className="coord-share">
          <h3 className="subhead">For observers</h3>
          <ol className="coord-howto">
            <li>
              Open <a href={href("/observe", params)}>#/observe</a>.
            </li>
            <li>Connect the wallet you accredited in step 3. It needs a little test GLM for gas from the faucet.</li>
            <li>Pick the unit, enter the figures from the result sheet, review and sign.</li>
          </ol>
          <div className="row">
            <CopyButton text={instructions} label="Copy instructions" />
            <CopyButton text={observe} label="Copy observer link" />
          </div>
        </div>
      </section>
      <Progress wallet={wallet} id={id} setup={setup} meta={meta} onObservers={onObservers} />
    </>
  )
}

/** One results panel, as on the results page: every number below is computed in this browser. */
function Progress({ wallet, id, setup, meta, onObservers }: Props) {
  const limited = useRateLimited()
  const hasObservers = setup.accreditations.length > 0
  const panel = useMemo(
    () => (hasObservers ? { ...resultsPanel(id, wallet.address, "state", meta.quorum), includeIgnored: false } : undefined),
    [hasObservers, id, wallet.address, meta.quorum],
  )
  const { state } = usePanel(collate, panel)

  const summary = useMemo(() => {
    if (!state || state.status !== "ready") return undefined
    const codes = new Set(setup.units.map((u) => String(u.attrs.unit_code)))
    const groups = state.consensus.filter((c) => codes.has(c.key))
    const reported = new Set(groups.map((c) => c.key))
    const perObserver = new Map<string, Set<string>>()
    for (const r of state.current) {
      const set = perObserver.get(r.creator) ?? new Set<string>()
      set.add(String(r.attrs.unit_code))
      perObserver.set(r.creator, set)
    }
    return {
      reported: reported.size,
      certified: groups.filter((c) => c.status === "certified").length,
      contested: groups.filter((c) => c.status === "contested").length,
      pending: groups.filter((c) => c.status === "pending").length,
      missing: setup.units.filter((u) => !reported.has(String(u.attrs.unit_code))).map((u) => String(u.attrs.unit_code)),
      perObserver,
    }
  }, [state, setup.units])

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <CardTitle icon="chart">Progress</CardTitle>
          <p>
            Counted at your quorum of {meta.quorum}: a unit is certified when at least {meta.quorum} of your observers report the same
            figures and they are a majority of those who reported.
          </p>
        </div>
        {state?.live === "live" && <span className="pill pill-live">Live</span>}
      </div>

      {!hasObservers ? (
        <p className="notice">
          No observers yet, so no results count.{" "}
          <button type="button" className="link-btn" onClick={onObservers}>
            Accredit observers in step 3
          </button>
        </p>
      ) : !summary ? (
        <>
          <Skeleton lines={3} height={18} />
          {state?.status === "error" && !limited && <p className="notice notice-error">Could not read results from Arkiv: {state.error}</p>}
          {limited && <p className="muted">Waiting for Arkiv's read budget to reset (see the notice above).</p>}
        </>
      ) : (
        <>
          <div className="tiles coord-tiles">
            <Tile label="Units reported" value={`${summary.reported} of ${setup.units.length}`} color="var(--accent-2)" />
            <Tile label="Certified" value={summary.certified} color="var(--good)" />
            <Tile label="Contested" value={summary.contested} color="var(--critical)" />
            <Tile label="Pending" value={summary.pending} color="var(--warn-ink)" />
          </div>

          <div className="coord-split">
            <div className="stack">
              <h3 className="subhead">Units reported per observer</h3>
              <ul className="feed">
                {setup.accreditations.map((r) => {
                  const observer = String(r.attrs.observer)
                  const n = summary.perObserver.get(observer)?.size ?? 0
                  return (
                    <li key={r.key}>
                      <span>
                        <b>{aliasOf(r)}</b> <span className="mono muted">{shortAddress(observer)}</span>
                      </span>
                      <span className={n ? "" : "muted"}>
                        {n} {n === 1 ? "unit" : "units"}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="stack">
              <h3 className="subhead">
                Units with no result yet{" "}
                <span className="pill">
                  {summary.missing.length} of {setup.units.length}
                </span>
              </h3>
              {summary.missing.length === 0 ? (
                <p className="small">
                  <Icon name="check" size={14} /> Every unit has at least one result from your observers.
                </p>
              ) : (
                <div className="unit-chips">
                  {summary.missing.slice(0, 80).map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                  {summary.missing.length > 80 && <span>+{summary.missing.length - 80} more</span>}
                </div>
              )}
            </div>
          </div>
          {summary.contested > 0 && (
            <p className="notice notice-warn">
              {summary.contested} {summary.contested === 1 ? "unit is" : "units are"} contested: your observers disagree and no majority
              agrees. The results page shows every version side by side.
            </p>
          )}
          <div className="row">
            <a className="btn" href={href("/results", { election: id, coordinator: wallet.address })}>
              Open the results page →
            </a>
          </div>
        </>
      )}
    </section>
  )
}

function Tile({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="tile" style={{ ["--tile-color" as string]: color }}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
    </div>
  )
}
