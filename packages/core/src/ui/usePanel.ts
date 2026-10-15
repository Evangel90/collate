import { useEffect, useMemo, useState } from "react"
import type { Collate } from "../index"
import type { PanelHandle } from "../panel"
import type { Panel, PanelState } from "../types"

/**
 * Creates a live panel for `config` and re-renders on every change. A new config (compared by its
 * JSON) tears down the old panel and starts a new one.
 */
export function usePanel(collate: Collate, config: Panel | undefined): { state: PanelState | undefined; handle: PanelHandle | undefined } {
  const key = config ? JSON.stringify(config) : ""
  const handle = useMemo(() => (config ? collate.panel(config) : undefined), [collate, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<PanelState | undefined>(handle?.getState())

  useEffect(() => {
    if (!handle) {
      setState(undefined)
      return
    }
    const unsubscribe = handle.subscribe(setState)
    return () => {
      unsubscribe()
      handle.destroy()
    }
  }, [handle])

  return { state, handle }
}
