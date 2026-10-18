import { useMemo } from "react"
import { DEFAULT_PARTIES } from "../../lib/data"
import { href } from "../../lib/router"
import type { Wallet } from "../../lib/wallet"
import type { Mine } from "../../pages/Coordinate"
import { useRateLimited } from "../Budget"
import { Icon, Skeleton } from "../ui"
import { ElectionStep } from "./ElectionStep"
import { ObserversStep } from "./ObserversStep"
import { checkDraft, checkUnits, draftId, emptyUnit, randomSuffix, type Draft } from "./plan"
import { go, metaOf, setupOf, StatusLine, type Status, type StepId } from "./shared"
import { ShareStep } from "./ShareStep"
import { UnitsStep } from "./UnitsStep"
import { useSetupWriter } from "./useSetupWriter"

export function newDraft(): Draft {
  const closes = new Date(Date.now() + 14 * 86400_000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    name: "",
    description: "Synthetic test election created in the Collate coordinator console. Not a real election.",
    closes: `${closes.getFullYear()}-${pad(closes.getMonth() + 1)}-${pad(closes.getDate())}`,
    quorum: 1,
    parties: DEFAULT_PARTIES.map((p) => p.name) as [string, string, string],
    suffix: randomSuffix(),
    units: [emptyUnit()],
  }
}

type Props = {
  wallet: Wallet
  mine: Mine
  myIds: ReadonlySet<string>
  /** The election to manage, or undefined for a new draft. */
  election: string | undefined
  step: StepId | undefined
  draft: Draft
  setDraft: (update: (d: Draft) => Draft) => void
  /** The new election landed; `status` is its last write, shown again on the election page. */
  onCreated: (status: Status, election: string) => void
  /** A status to show above the steps, e.g. the create that just finished. */
  flash?: Status
}

const TITLES: Record<StepId, string> = { election: "Election", units: "Polling units", observers: "Observers", share: "Share" }

/** One election, as four steps. Every step reads from the same setup rows: no query per step. */
export function Workspace({ wallet, mine, myIds, election, step, draft, setDraft, onCreated, flash }: Props) {
  const limited = useRateLimited()
  const isDraft = election === undefined
  const id = isDraft ? draftId(draft) : election
  // A draft has nothing on Arkiv until its first create; after that it is matched by its frozen id.
  const rows = useMemo(() => (isDraft && !draft.frozen ? [] : (mine.rows ?? []).filter((r) => r.attrs.election === id)), [mine.rows, id, isDraft, draft.frozen])
  const setup = useMemo(() => setupOf(rows), [rows])
  const meta = metaOf(setup.election, id)
  const taken = useMemo(() => (setup.election ? new Set([...myIds].filter((x) => x !== id)) : myIds), [myIds, setup.election, id])
  const draftProblems = isDraft ? checkDraft(draft, taken) : []
  const draftUnits = isDraft ? checkUnits(draft.units, id, new Set(setup.units.map((u) => String(u.attrs.unit_code)))) : undefined
  const refresh = () => mine.refresh(id)
  const writer = useSetupWriter(wallet, refresh)

  if (!isDraft && mine.rows === undefined) {
    return (
      <section className="card">
        <BackLink />
        <Skeleton lines={4} height={18} />
        {limited ? (
          <p className="muted">Waiting for Arkiv's read budget to reset (see the notice above). This loads by itself.</p>
        ) : mine.error ? (
          <p className="notice notice-error">Could not read this election from Arkiv: {mine.error}</p>
        ) : null}
      </section>
    )
  }

  if (!isDraft && !setup.election) {
    return (
      <section className="card">
        <BackLink />
        <p className="notice notice-warn">
          This wallet has not created an election with the id <span className="mono">{id}</span> on Arkiv, or it has expired. Only the
          wallet that created an election can manage it.
        </p>
        <div className="row">
          <a className="btn" href={href("/coordinate")}>
            Your elections
          </a>
          <a className="btn btn-primary" href={href("/coordinate", { new: "1" })}>
            <Icon name="plus" size={16} /> New election
          </a>
        </div>
      </section>
    )
  }

  const steps: { id: StepId; done: boolean; detail: string }[] = [
    { id: "election", done: Boolean(setup.election), detail: setup.election ? "On Arkiv" : draftProblems.length ? "Draft" : "Draft, complete" },
    {
      id: "units",
      done: setup.units.length > 0,
      detail: setup.units.length ? `${setup.units.length} on Arkiv` : draftUnits ? `${draftUnits.units.length} in draft` : "None yet",
    },
    { id: "observers", done: setup.accreditations.length > 0, detail: setup.election ? `${setup.accreditations.length} accredited` : "After creating" },
    { id: "share", done: false, detail: setup.election ? "Links and progress" : "After creating" },
  ]
  // With no step in the URL, open the first one still to do.
  const fallback: StepId = !setup.election ? "election" : !setup.units.length ? "units" : !setup.accreditations.length ? "observers" : "share"
  const current = step ?? fallback
  const goStep = (s: StepId) => go(isDraft ? { new: "1", step: s } : { election: id, step: s })
  const index = steps.findIndex((s) => s.id === current)

  return (
    <>
      <section className="card coord-head">
        <BackLink />
        <div className="coord-title">
          <h2>{isDraft && !setup.election ? draft.name.trim() || "New election" : meta.name}</h2>
          <span className="row">
            <span className="mono muted coord-id">{id}</span>
            {setup.election ? <span className="pill pill-good">On Arkiv</span> : <span className="pill pill-warn">Draft, not on Arkiv yet</span>}
          </span>
        </div>
        <nav aria-label="Setup steps">
          <ol className="coord-steps">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`coord-step${s.done ? " is-done" : ""}`}
                  aria-current={s.id === current ? "step" : undefined}
                  onClick={() => goStep(s.id)}
                >
                  <span className="coord-num" aria-hidden="true">
                    {s.done ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  <span className="coord-step-text">
                    <b>
                      {i + 1}. {TITLES[s.id]}
                    </b>
                    <span>{s.done ? `Done · ${s.detail}` : s.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <StatusLine status={flash} />
      </section>

      {current === "election" && (
        <ElectionStep election={setup.election} meta={meta} id={id} block={mine.block} draft={isDraft && !setup.election ? draft : undefined} setDraft={setDraft} problems={draftProblems} onNext={() => goStep("units")} />
      )}
      {current === "units" && (
        <UnitsStep
          wallet={wallet}
          id={id}
          setup={setup}
          writer={writer}
          draft={isDraft ? draft : undefined}
          setDraft={setDraft}
          draftProblems={draftProblems}
          onCreated={(status) => {
            onCreated(status, id)
            go({ election: id, step: "observers" })
          }}
          onBack={() => goStep("election")}
        />
      )}
      {current === "observers" && (
        <ObserversStep wallet={wallet} id={id} setup={setup} closesAt={meta.closesAt} block={mine.block} refresh={refresh} onNext={() => goStep("share")} />
      )}
      {current === "share" && <ShareStep wallet={wallet} id={id} setup={setup} meta={meta} onObservers={() => goStep("observers")} />}

      {index > 0 && current !== "units" && (
        <p className="muted coord-prev">
          <button type="button" className="link-btn" onClick={() => goStep(steps[index - 1]!.id)}>
            ← Back to {TITLES[steps[index - 1]!.id].toLowerCase()}
          </button>
        </p>
      )}
    </>
  )
}

function BackLink() {
  return (
    <a className="coord-back small" href={href("/coordinate")}>
      ← Your elections
    </a>
  )
}
