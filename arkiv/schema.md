# Collate on Arkiv: schema

Network: **Tiramisu** testnet, chain ID `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network` (HTTP) and `wss://rpc.tiramisu.db-chain.testnet.arkiv.network` (WebSocket). SDK: `@arkiv-network/sdk` **0.8.1** (pinned exactly).

Source of truth in code: [`apps/web/src/model/schema.ts`](../apps/web/src/model/schema.ts) (entity builders) and [`apps/web/src/model/panels.ts`](../apps/web/src/model/panels.ts) (queries). This file is kept in step with both.

## Principles

- **Everything Collate filters on is a typed attribute; everything it only displays is payload** (JSON, `application/json`).
- **Trust comes from `$creator`, never from an attribute.** `$creator` is set by the chain and never changes; `$owner` can be transferred and only controls writes. A result counts only because an accredited wallet *created* it.
- **Numbers are `u64`** (vote counts, `registered`, unix-second timestamps), so range queries work. Strings are `str`. Attribute names are lowercase snake_case (Tiramisu rejects uppercase names).
- **All data is synthetic.** No personal data is stored, in plaintext or hashed.

## Entity types

| Type | Created by | Attributes (type) | Payload | Flags | Entity Expiration | Lifetime Extension |
| --- | --- | --- | --- | --- | --- | --- |
| `election` | Coordinator | `type`, `election` (str); `opens_at`, `closes_at` (u64, unix s) | `name`, `description`, `parties[]` (`field`, `name`, `short`), optional `quorum` (agreeing observers the coordinator recommends per unit) | readonly | 90 days | Coordinator, if the count runs long |
| `unit` | Coordinator | `type`, `election`, `unit_code`, `ward`, `lga`, `state` (str); `registered` (u64) | `name` (display name) | readonly | 90 days | Coordinator, with the election |
| `accreditation` | Coordinator | `type`, `election`, `observer` (str, lowercase address) | `alias` (synthetic, e.g. "Observer 07") | readonly | `closes_at` + 7 days (`ExpirationTime.atDate`) | Coordinator extends the lease 7 days at a time; **revoked by deleting it** (readonly does not block delete) |
| `unit_result` | Observer | `type`, `election`, `unit_code`, `ward`, `lga`, `state` (str); `votes_a`, `votes_b`, `votes_c`, `rejected`, `accredited`, `submitted_at` (u64) | `photo_sha256` (hex or null), `note` | readonly **+ permissionless extension** | 30 days | **Anyone** (Extend button on the results page) |
| `correction` | Observer | as `unit_result`, plus `corrects` (str, lowercase entity key of the original) | `photo_sha256`, `reason` | readonly + permissionless extension | 30 days | Anyone |

Parties are fictional and fixed to three slots (`votes_a`, `votes_b`, `votes_c`); their names live in the election payload.

### Rules the reader applies (in `@collate/core`, client-side)

1. **Trust:** the trusted wallets are the `observer` values of `accreditation` entities created by the coordinator the viewer chose (Q3). Results are fetched only from those creators (Q4/Q8).
2. **Corrections:** a `correction` replaces the entity named in `corrects` **only if both have the same `$creator`**. A correction aimed at someone else's result is dropped. The latest of several corrections wins. Originals stay visible.
3. **Consensus:** results are grouped by `unit_code`; the latest entry per creator is kept. Creators whose entries match on all of `votes_a`, `votes_b`, `votes_c`, `rejected`, `accredited` agree. With `top` the largest agreeing set and `sources` the number of creators who reported the unit:
   - **certified** when `top` has at least `quorum` creators and is a strict majority (`top > sources / 2`). The unit counts once; creators outside `top` are shown as **outliers**.
   - **pending** when not certified and fewer than `quorum` creators have reported. Not counted.
   - **contested** otherwise. Shown with every version, not counted.

   `quorum` defaults to 1, so one report counts, one against one is contested and two against one counts with one outlier. The election payload's optional `quorum` sets the starting value; each viewer can raise or lower it (1–3) on the results page, which recomputes in the browser without new queries. One bad observer can no longer block a unit that a majority agrees on.
4. **Totals** by state, LGA and ward are summed in the browser from certified units only.

## Not stored, computed in the browser

Totals by ward, LGA and state; each unit's consensus status (certified, contested, pending) and outliers; missing units (Q2 units minus reported units); "ignored" writes from untrusted wallets.

## Queries the app runs

Rendered exactly as the SDK sends them (`renderWhere` in `@collate/core`). `$E` = `demo-2027`.

| # | Purpose | Query | Code |
| --- | --- | --- | --- |
| Q1+Q2 | Load the election and its polling units in one query, cursor-paginated | `(type = str('election') OR type = str('unit')) AND election = str($E) AND $creator = addr($coordinator)` | [`lib/data.ts`](../apps/web/src/lib/data.ts) |
| Q3 | Resolve trusted observers | `type = str('accreditation') AND election = str($E) AND $creator = addr($coordinator)` → set of `observer` | [`core/trust.ts`](../packages/core/src/trust.ts) |
| Q4+Q8 | Results and corrections, cursor-paginated | `(type = str('unit_result') OR type = str('correction')) AND election = str($E) AND ($creator = addr($o1) OR $creator = addr($o2) OR …)` (25 creators per query, in parallel) | [`model/panels.ts`](../apps/web/src/model/panels.ts), [`core/query.ts`](../packages/core/src/query.ts) |
| Q4′ | Same, any creator, to list ignored writes | Q4 without the `$creator` clause; split by trust in the browser | `includeIgnored` in [`core/panel.ts`](../packages/core/src/panel.ts) |
| Q5 | One state | Q4 `AND state = str($S)` | `statePanel` |
| Q6 | Latest submissions | Q4 `AND submitted_at > u64($now - window)` (window 1, 6 or 24 h) | `latestPanel` |
| Q7 | High rejected ballots | Q4 `AND rejected > u64($threshold)` | `suspiciousPanel` |
| Q9 | Observer's own accreditations | `type = str('accreditation') AND election = str($E) AND observer = str($me) AND ($creator = addr($coordA) OR $creator = addr($coordB))` | [`pages/Observe.tsx`](../apps/web/src/pages/Observe.tsx) |
| Live | New results, corrections, deletions, extensions | `watchEntityEvents` on a WebSocket transport, no `fromBlock`. Each `EntityCreated` from a trusted owner is re-read with `$key = key(...) AND <panel query>` and its `$creator` re-checked before it is applied | [`core/live.ts`](../packages/core/src/live.ts), [`core/panel.ts`](../packages/core/src/panel.ts) |

Tiramisu prices every anonymous query at a flat 100 cost units (100 queries per window per connection), so the app prefers few broad queries: Q1 and Q2 are merged, panels share one head block and identical walks, and live updates re-read only entities from trusted wallets. A results page load is about 5 queries.

Every paginated walk reads one block (`.atBlock(n)`) and follows `QueryResult.next()` until there is no cursor, so totals are a consistent snapshot even past 200 entities.

## Writes

| Who | What | How |
| --- | --- | --- |
| Coordinator | Election + all its units (+ accreditations in the seed) | One `executeBatch` of creates: the election appears complete or not at all |
| Coordinator | Accredit / extend lease / revoke | `createEntity` / `extendEntity` (`ExpirationTime.atBlock(expiresAt + 7 days)`) / `deleteEntity` |
| Observer | Result or correction | `createEntity` with `flags: { readonly: true, permissionlessExtension: true }` |
| Anyone | Keep a result alive | `extendEntity` (`ExpirationTime.atBlock(expiresAt + 30 days)`) |

## Arkiv features used, and what the user sees

| Feature | Where | What the user sees |
| --- | --- | --- |
| Typed attributes vs payload | All types | Range filters work; photo hash and notes appear only in the proof dialog |
| Compound and range queries | Q5–Q7 | State filter, "latest submissions" window, high-rejected panel |
| `$creator` / `createdBy` | Q1–Q4, Q8, Q9, live re-check | Only accredited observers count; every number shows who posted it; the trust toggle |
| OR over `$creator` | Q4 | One query per 25 observers instead of one per observer |
| Cursor pagination at a pinned block | Q2, Q4 | Complete totals beyond 200 entities |
| Per-type Entity Expiration | Table above | "Expires in" badges; accreditations lapse after the count while results outlive them |
| Lifetime Extension | Accreditation lease; results | Extend buttons (coordinator console; any viewer on results) |
| Creation flags: readonly, permissionless extension | Results, corrections | Results can't be edited by anyone; anyone can keep them alive |
| Delete | Revoking an accreditation | The observer's results stop counting for that group immediately (live) |
| WebSocket entity events | Every live panel | Totals update without refresh |
| Batch writes | Election setup | Election and units land atomically |

**Deliberately not used:** ownership transfer and `ownedBy()` (no product need), patches (results are immutable by design).

## Known limits

- An accreditation's expiry or deletion stops its observer's results counting for that group, including results posted while accredited. Coordinators extend leases while counting continues.
- Block production on Tiramisu is centralised during testnet. The claim is "readable and verifiable by anyone without our backend", not "impossible to stop".
