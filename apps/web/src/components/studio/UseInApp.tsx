import { useMemo, useState } from "react"
import { CardTitle } from "../ui"
import { reactSnippet, tsSnippet } from "./codegen"
import type { StudioPanel } from "./model"
import { CopyButton } from "./widgets"

/** Generated code for the panel on screen: the same config, in a developer's own app. */
export function UseInApp({ panel }: { panel: StudioPanel }) {
  const [tab, setTab] = useState<"ts" | "react">("ts")
  const code = useMemo(() => (tab === "ts" ? tsSnippet(panel) : reactSnippet(panel)), [tab, panel])
  return (
    <section className="card" aria-labelledby="studio-use-h">
      <div className="card-head">
        <div>
          <CardTitle icon="database" id="studio-use-h">Use in your app</CardTitle>
          <p>This panel as code. It reads Arkiv's public RPC from the browser or Node: no keys, no indexer, no server of ours.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Snippet language">
            <button type="button" aria-pressed={tab === "ts"} onClick={() => setTab("ts")}>
              TypeScript
            </button>
            <button type="button" aria-pressed={tab === "react"} onClick={() => setTab("react")}>
              React
            </button>
          </div>
          <CopyButton text={code} label="Copy code" />
        </div>
      </div>
      <pre className="code studio-snippet">{code}</pre>
    </section>
  )
}
