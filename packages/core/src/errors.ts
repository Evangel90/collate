/** A read failure, with the wait the RPC asked for when it is a rate limit. */
export type ReadError = { message: string; retryAfterSeconds?: number }

type HttpLike = {
  status?: number
  headers?: Headers
  retryAfterSeconds?: number
  body?: unknown
  cause?: unknown
  shortMessage?: string
  message?: string
}

/**
 * Turns an RPC failure into something a viewer can act on. Tiramisu answers HTTP 429
 * (`ANON_COST_LIMITED`) with a `Retry-After` header when the unauthenticated query budget for a
 * connection is spent; collate-core then refuses queries locally with the time left.
 */
export function describeError(error: unknown): ReadError {
  for (let e = error as HttpLike | undefined, depth = 0; e && depth < 12; e = e.cause as HttpLike, depth++) {
    if (e.status === 429) {
      const retry = Number(e.headers?.get?.("retry-after") ?? e.retryAfterSeconds)
      const retryAfterSeconds = Number.isFinite(retry) && retry > 0 ? retry : 60
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
      return {
        message: `Arkiv's public read budget for this connection is used up; it resets in about ${minutes} min. The page will retry by itself.`,
        retryAfterSeconds,
      }
    }
  }
  const e = error as HttpLike
  return { message: e?.shortMessage ?? e?.message?.split("\n")[0] ?? String(error) }
}
