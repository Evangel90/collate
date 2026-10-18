import type { Transport } from "viem"
import { describeError } from "./errors.js"

/**
 * What this tab has spent of Tiramisu's anonymous read budget. Every `arkiv_query` costs a flat
 * 100 units whatever it returns, and a connection gets 10,000 units a window (about an hour), so
 * the number of queries, not rows, is what runs out.
 */
export type ReadBudget = {
  /** `arkiv_query` requests sent from this tab, every page of a paginated walk counted. */
  readonly queries: number
  /** Unix ms before which Tiramisu said the budget is spent; `undefined` when it has not. */
  readonly limitedUntil: number | undefined
  /** Calls `listener` whenever either value changes. */
  subscribe: (listener: () => void) => () => void
}

/** A query refused in the browser because Tiramisu already said the budget is spent. */
export class RateLimitedError extends Error {
  readonly status = 429
  constructor(readonly retryAfterSeconds: number) {
    super(`Arkiv's anonymous query budget is spent; retry in ${retryAfterSeconds} s`)
    this.name = "RateLimitedError"
  }
}

type HttpLike = { status?: number; name?: string; code?: unknown; cause?: unknown }

/** A network failure or a 5xx, worth one more try; never a 429 or a JSON-RPC error. */
function transient(error: unknown): boolean {
  for (let e = error as HttpLike | undefined, depth = 0; e && depth < 12; e = e.cause as HttpLike, depth++) {
    if (e.status === 429 || typeof e.code === "number") return false
    if ((e.status ?? 0) >= 500 || e.name === "TimeoutError") return true
    if (e.name === "HttpRequestError" && e.status === undefined) return true
  }
  return false
}

const RETRY_DELAY = 500

/**
 * Wraps an RPC transport to count every `arkiv_query`, remember a 429 and its `Retry-After`, and
 * refuse further queries locally until then, so a spent budget shows as one clear message rather
 * than a page of failing requests. Pass the inner transport with `retryCount: 0`: viem's own retry
 * honours `Retry-After`, which turns a 429 into a silent wait of up to 15 minutes.
 */
export function meter(transport: Transport, onQuery?: (query: string) => void): { transport: Transport; budget: ReadBudget } {
  let queries = 0
  let limitedUntil: number | undefined
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of listeners) l()
  }

  const budget: ReadBudget = {
    get queries() {
      return queries
    },
    get limitedUntil() {
      return limitedUntil
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  const wrapped: Transport = (params) => {
    const inner = transport(params)
    const send = async (args: { method: string; params?: unknown }, options?: unknown) => {
      const call = () => (inner.request as (a: unknown, o?: unknown) => Promise<unknown>)(args, options)
      try {
        return await call()
      } catch (error) {
        if (!transient(error)) throw error
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
        return call()
      }
    }
    const request = async (args: { method: string; params?: unknown }, options?: unknown) => {
      if (args.method !== "arkiv_query") return send(args, options)
      if (limitedUntil !== undefined) {
        const left = limitedUntil - Date.now()
        if (left > 0) throw new RateLimitedError(Math.ceil(left / 1000))
        limitedUntil = undefined
      }
      queries += 1
      onQuery?.(String((args.params as unknown[] | undefined)?.[0] ?? ""))
      notify()
      try {
        return await send(args, options)
      } catch (error) {
        const { retryAfterSeconds } = describeError(error)
        if (retryAfterSeconds !== undefined) {
          limitedUntil = Date.now() + retryAfterSeconds * 1000
          notify()
        }
        throw error
      }
    }
    return { ...inner, request: request as typeof inner.request }
  }

  return { transport: wrapped, budget }
}
