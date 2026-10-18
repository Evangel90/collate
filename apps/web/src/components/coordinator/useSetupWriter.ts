import type { CreateEntityParameters } from "@arkiv-network/sdk"
import type { Row } from "@collate/core"
import { useCallback, useRef, useState } from "react"
import { collate } from "../../lib/collate"
import { errorMessage, type Wallet } from "../../lib/wallet"
import { electionEntity, unitEntity, type ElectionInput } from "../../model/schema"
import { CHUNK_SIZE, classifyWriteError, existingFrom, planSize, remaining, toBatches, withLanded, type Existing, type SetupPlan } from "./plan"
import type { Status } from "./shared"

export type BatchLog = { label: string; state: "waiting" | "signing" | "done" | "failed" | "unknown"; txHash?: string; note?: string }

export type WriterState = {
  phase: "idle" | "sending" | "done" | "stopped"
  status: Status
  /** The single all-in-one attempt, then one entry per chunk. */
  log: BatchLog[]
  /** After a stop: continuing re-reads Arkiv (one query) and sends only what is missing. */
  canResume: boolean
  /** The stop followed a transaction with an unknown outcome: check the explorer before continuing. */
  mustCheck?: string
}

const IDLE: WriterState = { phase: "idle", status: undefined, log: [], canResume: false }

const createsFor = (plan: SetupPlan, election: ElectionInput | undefined): CreateEntityParameters[] => [
  ...(plan.election && election ? [electionEntity(election)] : []),
  ...plan.units.map(unitEntity),
]

const describe = (plan: SetupPlan) => {
  const units = `${plan.units.length} ${plan.units.length === 1 ? "unit" : "units"}`
  return plan.election ? (plan.units.length ? `election + ${units}` : "election") : units
}

/**
 * Creates an election's setup (the election and its units, or units added later) the way
 * scripts/seed.ts does: one atomic batch first; if the chain refuses it, re-read what exists and
 * send the rest in atomic batches of 15, the election first. A transaction whose outcome is
 * unknown is never resent: the run stops with its link, and continuing re-reads Arkiv first.
 *
 * `refresh` re-reads this election's setup from Arkiv (one query) and returns its rows.
 */
export function useSetupWriter(wallet: Wallet, refresh: () => Promise<Row[]>) {
  const [state, setState] = useState<WriterState>(IDLE)
  // What the last start asked for, so Continue sends the same intent even if the editor changed.
  const intent = useRef<{ plan: SetupPlan; election?: ElectionInput }>()

  const run = useCallback(
    async (known: Existing | undefined, onDone: (status: Status) => void) => {
      const target = intent.current
      if (!target) return
      const log: BatchLog[] = []
      const update = (patch: Partial<WriterState>) => setState((s) => ({ ...s, ...patch, log: [...log] }))
      const stop = (status: Status, canResume: boolean, mustCheck?: string) => update({ phase: "stopped", status, canResume, mustCheck })
      update({ phase: "sending", status: undefined, canResume: false, mustCheck: undefined })

      const reread = async (why: string) => {
        update({ status: { kind: "busy", text: `${why} Re-reading what exists on Arkiv…` } })
        return existingFrom(await refresh())
      }

      const finish = async (text: string, link?: string) => {
        const status: Status = { kind: "done", text, link }
        update({ phase: "done", status, canResume: false })
        // The setup was just written: read it back so the console shows it. One query.
        await refresh().catch(() => undefined)
        onDone(status)
      }

      try {
        // Continuing after a stop always starts from a fresh read: something may have landed.
        let existing = known ?? (await reread("Continuing."))
        let plan = remaining(target.plan, existing)
        if (planSize(plan) === 0) return await finish("Everything is already on Arkiv.")

        // A first attempt tries one atomic batch; a resume goes straight to chunks.
        if (known) {
          const total = planSize(plan)
          const entry: BatchLog = { label: `One batch: ${describe(plan)}`, state: "signing" }
          log.push(entry)
          update({ status: { kind: "busy", text: `Confirm one transaction with ${total} ${total === 1 ? "create" : "creates"} in your wallet…` } })
          try {
            const res = await wallet.client.executeBatch({ creates: createsFor(plan, target.election) })
            Object.assign(entry, { state: "done", txHash: res.txHash })
            return await finish(`Created ${describe(plan)} in one transaction.`, collate.explorer.tx(res.txHash))
          } catch (e) {
            const outcome = classifyWriteError(e)
            if (outcome.kind === "applied") {
              Object.assign(entry, { state: "done", txHash: outcome.txHash })
              return await finish(`Created ${describe(plan)} in one transaction.`, outcome.txHash && collate.explorer.tx(outcome.txHash))
            }
            if (outcome.kind === "rejected") {
              Object.assign(entry, { state: "failed", note: "rejected in your wallet" })
              return stop({ kind: "error", text: "You rejected the request in your wallet. Nothing was sent." }, false)
            }
            if (outcome.kind === "unknown") {
              Object.assign(entry, { state: "unknown", txHash: outcome.txHash })
              return stop(unknownStatus(outcome.txHash), true, outcome.txHash)
            }
            Object.assign(entry, { state: "failed", txHash: outcome.txHash, note: errorMessage(e) })
            if (total <= CHUNK_SIZE) return stop({ kind: "error", text: `The transaction was refused: ${sentence(errorMessage(e))} Nothing was applied.` }, true)
            // Never split after a send that may have landed: re-check before writing again.
            existing = await reread(`Arkiv refused one batch of ${total} creates; it will go in batches of up to ${CHUNK_SIZE}.`)
            plan = remaining(target.plan, existing)
            if (planSize(plan) === 0) return await finish("The batch had landed after all: everything is on Arkiv.")
          }
        }

        const batches = toBatches(plan)
        const start = log.length
        for (const b of batches) log.push({ label: describe(b), state: "waiting" })
        for (const [i, b] of batches.entries()) {
          const entry = log[start + i]!
          entry.state = "signing"
          update({ status: { kind: "busy", text: `Batch ${i + 1} of ${batches.length} (${describe(b)}): confirm in your wallet…` } })
          try {
            const res = await wallet.client.executeBatch({ creates: createsFor(b, target.election) })
            Object.assign(entry, { state: "done", txHash: res.txHash })
            existing = withLanded(existing, b)
          } catch (e) {
            const outcome = classifyWriteError(e)
            if (outcome.kind === "applied") {
              Object.assign(entry, { state: "done", txHash: outcome.txHash })
              existing = withLanded(existing, b)
              continue
            }
            const landed = i === 0 ? "Nothing from these batches landed." : `Batches 1 to ${i} are on Arkiv.`
            if (outcome.kind === "unknown") {
              Object.assign(entry, { state: "unknown", txHash: outcome.txHash })
              return stop(unknownStatus(outcome.txHash), true, outcome.txHash)
            }
            Object.assign(entry, { state: "failed", txHash: outcome.txHash, note: outcome.kind === "rejected" ? "rejected in your wallet" : errorMessage(e) })
            const why = outcome.kind === "rejected" ? `You rejected batch ${i + 1} of ${batches.length}.` : `Batch ${i + 1} of ${batches.length} was refused: ${sentence(errorMessage(e))}`
            return stop({ kind: "error", text: `${why} ${landed} Continue re-reads Arkiv and sends only what is missing.` }, true)
          }
        }
        const last = log[log.length - 1]?.txHash
        await finish(
          batches.length === 1 ? `Created ${describe(plan)}.` : `Created ${describe(plan)} in ${batches.length} atomic batches.`,
          last && collate.explorer.tx(last),
        )
      } catch (e) {
        // Only the re-read can land here (every send is caught above).
        stop({ kind: "error", text: `Could not re-read Arkiv: ${sentence(errorMessage(e))} Nothing more was sent.` }, true)
      }
    },
    [wallet, refresh],
  )

  /** Starts a create from what the console last read. */
  const start = useCallback(
    (plan: SetupPlan, election: ElectionInput | undefined, existing: Existing, onDone: (status: Status) => void) => {
      intent.current = { plan, election }
      void run(existing, onDone)
    },
    [run],
  )

  /** Continues after a stop: re-reads Arkiv, then sends only what is missing, in batches of 15. */
  const resume = useCallback((onDone: (status: Status) => void) => void run(undefined, onDone), [run])
  const reset = useCallback(() => setState(IDLE), [])

  return { state, start, resume, reset }
}

export type SetupWriter = ReturnType<typeof useSetupWriter>

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

function unknownStatus(txHash?: string): Status {
  return {
    kind: "warn",
    text:
      "The outcome of this transaction is unknown, so it will not be sent again. Check it on the explorer; once it shows as " +
      "succeeded or failed, continue: Collate re-reads Arkiv and sends only what is missing.",
    link: txHash && collate.explorer.tx(txHash),
  }
}
