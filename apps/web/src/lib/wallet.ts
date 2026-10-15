import { createWalletClient, EntityMutationError, type WalletArkivClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { useCallback, useEffect, useState } from "react"
import { custom, numberToHex, type Address, type EIP1193Provider } from "viem"

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export type Wallet = { address: Address; client: WalletArkivClient }

async function ensureTiramisu(provider: EIP1193Provider) {
  const chainId = numberToHex(tiramisu.id)
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] })
  } catch (error) {
    // 4902: the wallet does not know the chain yet.
    if ((error as { code?: number }).code !== 4902) throw error
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: "Arkiv Tiramisu",
          nativeCurrency: tiramisu.nativeCurrency,
          rpcUrls: [...tiramisu.rpcUrls.default.http],
          blockExplorerUrls: ["https://tiramisu.explorer.arkiv.network"],
        },
      ],
    })
  }
}

function makeWallet(provider: EIP1193Provider, address: Address): Wallet {
  return {
    address: address.toLowerCase() as Address,
    client: createWalletClient({ account: address, chain: tiramisu, transport: custom(provider) }),
  }
}

/** The viewer's injected browser wallet (MetaMask, Rabby…), switched to Tiramisu. */
export function useWallet() {
  const [wallet, setWallet] = useState<Wallet | undefined>()
  const [error, setError] = useState<string | undefined>()
  const provider = typeof window !== "undefined" ? window.ethereum : undefined

  useEffect(() => {
    if (!provider) return
    const onAccounts = (accounts: string[]) => setWallet(accounts[0] ? makeWallet(provider, accounts[0] as Address) : undefined)
    provider.on("accountsChanged", onAccounts as never)
    // Reconnect silently if the site is already authorised.
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => onAccounts(accounts as string[]))
      .catch(() => undefined)
    return () => provider.removeListener("accountsChanged", onAccounts as never)
  }, [provider])

  const connect = useCallback(async () => {
    setError(undefined)
    if (!provider) {
      setError("No browser wallet found. Install MetaMask or Rabby to post or extend results. Reading needs no wallet.")
      return
    }
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[]
      await ensureTiramisu(provider)
      if (accounts[0]) setWallet(makeWallet(provider, accounts[0]))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [provider])

  return { wallet, connect, error, hasProvider: Boolean(provider) }
}

/** A short, honest message for a failed write. An unknown outcome is never reported as failure. */
export function errorMessage(error: unknown): string {
  // The SDK wraps every failure, so look through the cause chain for a wallet rejection.
  for (let e = error as { code?: number; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === 4001) return "You rejected the request in your wallet."
  }
  if (error instanceof EntityMutationError && error.txHash) {
    return `${error.message.split("\n")[0]} Check https://tiramisu.explorer.arkiv.network/tx/${error.txHash} before trying again.`
  }
  const e = error as { shortMessage?: string; message?: string }
  return e.shortMessage ?? e.message?.split("\n")[0] ?? String(error)
}
