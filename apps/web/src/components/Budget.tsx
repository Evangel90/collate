import { useEffect, useState, useSyncExternalStore } from "react"
import { collate } from "../lib/collate"

const budget = collate.budget
const COUNT_KEY = "collate:queries"

/** Queries counted before this page load, so the dev badge spans reloads in one tab. */
const before = (() => {
  try {
    return Number(sessionStorage.getItem(COUNT_KEY) ?? 0) || 0
  } catch {
    return 0
  }
})()

budget.subscribe(() => {
  try {
    sessionStorage.setItem(COUNT_KEY, String(before + budget.queries))
  } catch {
    /* blocked storage: the badge counts this page load only */
  }
})

let snapshot = { queries: budget.queries, limitedUntil: budget.limitedUntil }
const subscribe = (listener: () => void) =>
  budget.subscribe(() => {
    snapshot = { queries: budget.queries, limitedUntil: budget.limitedUntil }
    listener()
  })

/** Queries sent and the rate-limit state of collate's public Arkiv clients. */
export function useBudget() {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** When the spent read budget resets (unix ms), or `undefined` while it is not spent; re-renders as time passes. */
export function useRateLimited(): number | undefined {
  const { limitedUntil } = useBudget()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!limitedUntil || limitedUntil <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [limitedUntil])
  return limitedUntil && limitedUntil > now ? limitedUntil : undefined
}

/**
 * One friendly message for the whole page when the read budget is spent, instead of a card per
 * failed read. Panels retry by themselves once the budget resets.
 */
export function BudgetNotice() {
  const until = useRateLimited()
  if (!until) return null
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000))
  const at = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return (
    <p className="notice notice-warn budget-notice" role="status">
      <b>Arkiv's free read budget for this connection is used up.</b> Tiramisu allows about 100 queries an hour without an API
      key. Collate will read again at {at} (about {minutes} min); nothing is wrong with the results themselves.
    </p>
  )
}

const debug = () => {
  try {
    return import.meta.env.DEV || /[?&]debug\b/.test(window.location.search + window.location.hash)
  } catch {
    return false
  }
}

/** Development aid (or `?debug`): how many metered Arkiv queries this tab has sent. */
export function QueryBadge() {
  const { queries } = useBudget()
  if (!debug()) return null
  return (
    <span className="query-badge" title="Each arkiv_query costs 100 of Tiramisu's 10,000 anonymous units per window; pages of a walk count separately">
      Arkiv queries this session: {before + queries}
    </span>
  )
}
