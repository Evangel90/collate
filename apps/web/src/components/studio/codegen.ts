/** Turns a panel config into code a developer can paste: plain TypeScript and a React component. */
import type { Where, WhereValue } from "@collate/core"
import type { StudioPanel } from "./model"

const IDENT = /^[A-Za-z_$][\w$]*$/
const str = (s: string) => JSON.stringify(s)

/** Collects which helpers a config uses, so the import line lists exactly those. */
function helpersIn(where: Where[], used: Set<string>) {
  for (const w of where) {
    used.add(w.op)
    if (w.op === "or") helpersIn(w.any, used)
    else if (w.op === "and") helpersIn(w.all, used)
    else if (w.op !== "startsWith" && typeof w.value === "object") used.add("v")
  }
}

function valueCode(value: WhereValue): string {
  if (typeof value === "string") return str(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value.type === "u64") return `v.u64(${str(value.value)})`
  if (value.type === "str" || value.type === "addr" || value.type === "key") return `v.${value.type}(${str(value.value)})`
  return `v.${value.type}(${String(value.value)})`
}

/** One predicate as helper calls, e.g. `or(eq("type", "a"), eq("type", "b"))`. */
export function whereCode(w: Where): string {
  switch (w.op) {
    case "or":
      return `or(${w.any.map(whereCode).join(", ")})`
    case "and":
      return `and(${w.all.map(whereCode).join(", ")})`
    case "startsWith":
      return `startsWith(${str(w.field)}, ${str(w.value)})`
    default:
      return `${w.op}(${str(w.field)}, ${valueCode(w.value)})`
  }
}

function literal(value: unknown, indent: string): string {
  const inner = indent + "  "
  if (Array.isArray(value)) {
    const items = value.map((x) => literal(x, inner))
    const flat = `[${items.join(", ")}]`
    return flat.length + indent.length < 96 ? flat : `[\n${items.map((x) => inner + x).join(",\n")},\n${indent}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, x]) => x !== undefined)
    return `{\n${entries.map(([k, x]) => `${inner}${IDENT.test(k) ? k : str(k)}: ${literal(x, inner)}`).join(",\n")},\n${indent}}`
  }
  return typeof value === "string" ? str(value) : String(value)
}

/** The config as an object literal, with predicates written as helper calls. */
function configCode(panel: StudioPanel, indent = ""): string {
  const inner = indent + "  "
  const lines = Object.entries(panel)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => {
      if (k === "query") return `${inner}query: ${whereList(x as Where[], inner)}`
      if (k === "trust" && x && typeof x === "object") {
        const { listQuery, ...rest } = x as { listQuery: Where[] }
        const body = Object.entries(rest)
          .filter(([, y]) => y !== undefined)
          .map(([tk, y]) => `${inner}  ${tk}: ${literal(y, inner + "  ")}`)
        body.push(`${inner}  listQuery: ${whereList(listQuery, inner + "  ")}`)
        return `${inner}trust: {\n${body.join(",\n")},\n${inner}}`
      }
      return `${inner}${k}: ${literal(x, inner)}`
    })
  return `{\n${lines.join(",\n")},\n${indent}}`
}

function whereList(where: Where[], indent: string): string {
  const items = where.map(whereCode)
  const flat = `[${items.join(", ")}]`
  if (flat.length + indent.length < 96) return flat
  return `[\n${items.map((x) => `${indent}  ${x}`).join(",\n")},\n${indent}]`
}

function importLine(panel: StudioPanel, withPanelType: boolean): string {
  const used = new Set<string>(["createCollate"])
  helpersIn(panel.query, used)
  if (panel.trust) helpersIn(panel.trust.listQuery, used)
  const names = [...used].sort((a, b) => a.localeCompare(b))
  return `import { ${withPanelType ? "type Panel, " : ""}${names.join(", ")} } from "@collate/core"`
}

const INSTALL = "// npm install @collate/core @arkiv-network/sdk@0.8.1 viem   (source: packages/core in github.com/Evangel90/collate, MIT)"

/** Framework-free: subscribe to the panel and render however you like. */
export function tsSnippet(panel: StudioPanel): string {
  return `${INSTALL}
${importLine(panel, false)}

const collate = createCollate() // Tiramisu, public RPC, no keys, no backend

const panel = collate.panel(${configCode(panel)})

// Called now and on every change (new entities arrive over WebSocket when live is on).
const stop = panel.subscribe((state) => {
  if (state.status !== "ready") return
  console.log(\`block \${state.block}: \${state.rows.length} entities\`)
  console.table(state.groups.map((g) => ({ group: g.group, count: g.count, ...g.sums })))
  // Also: state.disputes, state.ignored, state.superseded, state.trust
})
`
}

/** React, with the optional UI components from @collate/core/ui. */
export function reactSnippet(panel: StudioPanel): string {
  const sum = panel.sum ?? []
  const label = (f: string) => panel.labels?.[f] ?? f
  const series = sum.length
    ? `[${sum.slice(0, 3).map((f) => `{ field: ${str(f)}, label: ${str(label(f))} }`).join(", ")}]`
    : `[{ field: "count", label: "Entities" }]`
  const columns = `[${sum.map((f) => `{ field: ${str(f)}, label: ${str(label(f))} }`).join(", ")}]`
  const groups = sum.length ? "state.groups" : "state.groups.map((g) => ({ ...g, sums: { count: g.count } }))"
  const body = panel.groupBy
    ? panel.view === "bar"
      ? `<BarChart title={config.title} groups={${groups}} series={${series}} />`
      : `<GroupTable groups={state.groups} total={state.total} groupLabel=${str(panel.groupBy)} columns={${columns}} />`
    : `<RowTable rows={state.current} columns={${columns}} label={(r) => r.key.slice(0, 10)} />`
  const ui = panel.groupBy ? (panel.view === "bar" ? "BarChart" : "GroupTable") : "RowTable"
  return `${INSTALL}
${importLine(panel, true)}
import { ${ui}, collateCss, usePanel } from "@collate/core/ui"

const collate = createCollate()

const config: Panel = ${configCode(panel)}

export function Dashboard() {
  const { state } = usePanel(collate, config)
  if (!state || state.status === "loading") return <p>Reading from Arkiv…</p>
  if (state.status === "error") return <p>{state.error}</p>
  return (
    <div className="collate-root">
      <style>{collateCss}</style>
      ${body}
      <p>
        {state.rows.length} entities at block {String(state.block)}
        {state.disputes.length ? \` · \${state.disputes.length} disputed\` : ""}
      </p>
    </div>
  )
}
`
}
