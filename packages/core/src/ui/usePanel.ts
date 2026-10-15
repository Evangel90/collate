import { useEffect, useState } from "react"
import type { Collate } from "../index"
import type { PanelHandle } from "../panel"
import type { Panel, PanelState } from "../types"

/**
 * Creates a live panel for `config` and re-renders on every change. A new config (compared by its
 * JSON) tears down the old panel and starts a new one. The panel is created inside the effect, so
 * React's mount-unmount-mount in development never leaves a destroyed panel behind.
 */
export function usePanel(collate: Collate, config: Panel | undefined): { state: PanelState | undefined; handle: PanelHandle | undefined } {
  const key = config ? JSON.stringify(config) : ""
  const [state, setState] = useState<PanelState | undefined>()
  const [handle, setHandle] = useState<PanelHandle | undefined>()

  useEffect(() => {
    if (!key) {
      setState(undefined)
      setHandle(undefined)
      return
    }
    const next = collate.panel(JSON.parse(key) as Panel)
    setHandle(next)
    const unsubscribe = next.subscribe(setState)
    return () => {
      unsubscribe()
      next.destroy()
    }
  }, [collate, key])

  return { state, handle }
}
