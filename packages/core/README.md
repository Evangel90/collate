# @collate/core

**Turn any Arkiv query into live, trust-filtered tables and charts in the browser. No indexer, no backend.**

Arkiv, the Web3 database, has no server-side ordering or aggregation and returns at most 200 entities per page, so every app that reads from it re-solves the same problems. collate-core solves them once:

| Module | What it does | Arkiv feature it relies on |
| --- | --- | --- |
| `query` | Runs a query and follows cursors past the 200-per-page cap, all pages at one pinned block | Queries, cursor pagination, `atBlock` |
| `trust` | Resolves trusted wallets from list entities created by root wallets ("wallets named in entities created by X"), then keeps only entities those wallets created | `$creator` (immutable), OR over `$creator` |
| `supersede` | Lets an entity replace an earlier one by the **same** creator; originals stay visible | `$creator`, entity keys |
| `disputes` | Committee consensus: groups rows by a key and counts a group only when at least `quorum` trusted sources agree and they are a strict majority; the rest are pending or contested | Attributes as the group key, `$creator` as the source |
| `aggregate` | Group-by, sum, count, min, max and sort in the browser | Typed numeric attributes |
| `live` | Subscribes to entity events over WebSocket and patches results in place, re-checking each new entity against the query on the node | `watchEntityEvents`, no `fromBlock` |
| `share` | Encodes a whole panel config into a URL and back | — |
| `ui` | Optional React: `usePanel`, `BarChart`, `GroupTable`, `RowTable`, `Provenance` | `$creator`, entity key, Entity Expiration |

It knows nothing about elections. [Collate](../../README.md) is its first user.

## Install

```bash
npm install @collate/core @arkiv-network/sdk@0.8.1 viem
```

Works against `@arkiv-network/sdk` 0.8.1 on Tiramisu by default; pass `chain`, `rpcHttp`, `rpcWs` and `explorer` for another Arkiv network.

## Use

```ts
import { createCollate, eq, or } from "@collate/core"

const collate = createCollate() // Tiramisu, public RPC, no keys

const panel = collate.panel({
  title: "Votes by state",
  query: [or(eq("type", "unit_result"), eq("type", "correction")), eq("election", "demo-2027")],
  trust: {
    rootCreators: ["0x86d0886835480cfee3a0dbfb7814434dab851381"], // whom the viewer trusts
    listQuery: [eq("type", "accreditation"), eq("election", "demo-2027")],
    addressField: "observer", // attribute on the list entities naming a trusted wallet
  },
  supersedeField: "corrects",
  disputeKey: "unit_code",
  quorum: 2, // a unit counts once two trusted observers agree
  groupBy: "state",
  sum: ["votes_a", "votes_b", "votes_c"],
  view: "bar",
  live: true,
})

const stop = panel.subscribe((state) => {
  // state.groups, state.total, state.consensus, state.disputes, state.superseded, state.ignored, state.block, state.live
  render(state)
})
```

With React:

```tsx
import { BarChart, collateCss, usePanel } from "@collate/core/ui"

function Totals() {
  const { state } = usePanel(collate, config)
  return (
    <div className="collate-root">
      <style>{collateCss}</style>
      {state && <BarChart title="Votes by state" groups={state.groups} series={[{ field: "votes_a", label: "Party A" }]} />}
    </div>
  )
}
```

## The panel config is the public contract

```ts
type Panel = {
  title: string
  query: Where[]            // every predicate must hold
  trust?: { rootCreators: Address[]; listQuery: Where[]; addressField: string; labelField?: string }
  supersedeField?: string   // attribute naming an earlier entity (same creator) this one replaces
  groupBy?: string          // attribute, or $creator / $owner / $key
  sum?: string[]
  disputeKey?: string       // rows sharing this attribute are one group…
  compareFields?: string[]  // …whose sources must agree on these fields (default: sum)…
  quorum?: number           // …at least this many of them, and a strict majority (default 1)
  view: "table" | "bar"
  live?: boolean
  includeIgnored?: boolean  // also list matching entities from untrusted creators
  labels?: Record<string, string>
}

type Where =
  | { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: string | number | boolean | TypedValue }
  | { op: "startsWith"; field: string; value: string }
  | { op: "or"; any: Where[] }
  | { op: "and"; all: Where[] }
```

## Consensus

With `disputeKey` set, each group keeps the latest row per source (`$creator`) and sorts sources into buckets of identical `compareFields`. With `top` the largest bucket and `sources` the number that reported:

| Status | When | Counted |
| --- | --- | --- |
| `certified` | `top >= quorum` and `top > sources / 2` | Once: the latest row in `top`. Other buckets are `outliers` |
| `pending` | not certified and `sources < quorum` | No |
| `contested` | otherwise | No; every version is in `disputes` |

So at the default quorum of 1, a lone report counts, one against one is contested, and two against one counts with one outlier. At quorum 2, a lone report is pending. One bad source can no longer veto a group that a majority agrees on.

```ts
type Consensus = {
  key: string
  status: "certified" | "contested" | "pending"
  quorum: number
  sources: number
  agreeing: Row[]  // empty unless certified
  outliers: Row[]  // certified only: sources that said something else
  entries: Row[]   // latest row per source
}
```

`state.consensus` lists every group, sorted by key; `state.disputes` is the contested ones; `state.resolved` (unkeyed rows plus one row per certified group) is what gets aggregated.

`Where` is plain JSON, so a panel fits in a URL (`encodePanel` / `decodePanel`). Numbers encode as `u64`, the Arkiv convention for counts and timestamps; use `v.i32(n)`, `v.addr(a)` and friends to pick another type.

## Pure functions

Everything after the fetch is pure and unit-tested, so you can use it on rows from anywhere:

```ts
import { aggregate, buildTrust, computePanel, findConsensus, supersede } from "@collate/core"

const { resolved, consensus, disputes } = findConsensus(rows, "unit_code", ["votes_a", "votes_b"], 2)
```

## Licence

MIT.
