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
