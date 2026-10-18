const nf = new Intl.NumberFormat("en")

export function formatNumber(n: number): string {
  return nf.format(n)
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Approximate time until a block, given the current block and seconds per block. */
export function expiresIn(expiresAt: bigint, currentBlock: bigint | undefined, blockSeconds = 2): string {
  if (currentBlock === undefined) return `block ${expiresAt}`
  const seconds = Number(expiresAt - currentBlock) * blockSeconds
  if (seconds <= 0) return "expired"
  const days = Math.floor(seconds / 86400)
  if (days >= 2) return `${days} days`
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) return `${hours} h`
  return `${Math.max(1, Math.floor(seconds / 60))} min`
}

/** `drug_name` → "Drug name", `lga` stays readable via a caller label. */
export function humanizeKey(key: string): string {
  const words = key.replace(/^\$/, "").replace(/[_-]+/g, " ").trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : key
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

/**
 * One attribute value for people: dates for timestamp-like fields (unix seconds or ms), grouped
 * digits for other numbers, short addresses, Yes/No for booleans.
 */
export function formatAttr(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    const looksLikeTime = /(^|_)(at|time|timestamp|date)$|_at$/i.test(key)
    if (looksLikeTime && value > 1e9 && value < 1e11) return dateFormat.format(new Date(value * 1000))
    if (looksLikeTime && value > 1e12 && value < 1e14) return dateFormat.format(new Date(value))
    return formatNumber(value)
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return shortAddress(value)
  return value
}
