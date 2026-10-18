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
| `sandbox_registration` | Anyone, for their own wallet (Observer page, "Join the Open sandbox") | `type`, `election`, `observer` (str, lowercase address of the creating wallet) | `alias` (synthetic, e.g. "Tester 4f2a") | readonly | `closes_at` + 7 days (`ExpirationTime.atDate`) | None; the wallet joins again if needed |
| `unit_result` | Observer | `type`, `election`, `unit_code`, `ward`, `lga`, `state` (str); `votes_a`, `votes_b`, `votes_c`, `rejected`, `accredited`, `submitted_at` (u64) | `photo_sha256` (hex or null), `note` | readonly **+ permissionless extension** | 30 days | **Anyone** (Extend button on the results page) |
| `correction` | Observer | as `unit_result`, plus `corrects` (str, lowercase entity key of the original) | `photo_sha256`, `reason` | readonly + permissionless extension | 30 days | Anyone |

Parties are fictional and fixed to three slots (`votes_a`, `votes_b`, `votes_c`); their names live in the election payload.

### Rules the reader applies (in `@collate/core`, client-side)

1. **Trust:** the trusted wallets are the `observer` values of `accreditation` entities created by the coordinator the viewer chose (Q3). Results are fetched only from those creators (Q4/Q8).
   - **Open sandbox** (a third option on the results page, `?group=sandbox`, demo election only): Group A's accredited observers plus every wallet with a `sandbox_registration` for the election (Q10) **whose `$creator` equals its `observer`**. A registration naming any other wallet is ignored, so nobody can register someone else. Registrations come from any wallet, so the sandbox's totals are not vetted, and the page says so. Group A and B never count them.
2. **Corrections:** a `correction` replaces the entity named in `corrects` **only if both have the same `$creator`**. A correction aimed at someone else's result is dropped. The latest of several corrections wins. Originals stay visible.
3. **Consensus:** results are grouped by `unit_code`; the latest entry per creator is kept. Creators whose entries match on all of `votes_a`, `votes_b`, `votes_c`, `rejected`, `accredited` agree. With `top` the largest agreeing set and `sources` the number of creators who reported the unit:
   - **certified** when `top` has at least `quorum` creators and is a strict majority (`top > sources / 2`). The unit counts once; creators outside `top` are shown as **outliers**.
   - **pending** when not certified and fewer than `quorum` creators have reported. Not counted.
   - **contested** otherwise. Shown with every version, not counted.

   `quorum` defaults to 1, so one report counts, one against one is contested and two against one counts with one outlier. The election payload's optional `quorum` sets the starting value; each viewer can raise or lower it on the results page (from 1 up to the most observers that reported any one unit, at most 9), which recomputes in the browser without new queries. One bad observer can no longer block a unit that a majority agrees on.
4. **Totals** by state, LGA and ward are summed in the browser from certified units only.

## Not stored, computed in the browser

Totals by ward, LGA and state; each unit's consensus status (certified, contested, pending) and outliers; missing units (Q2 units minus reported units); "ignored" writes from untrusted wallets.

## Queries the app runs

Rendered exactly as the SDK sends them (`renderWhere` in `@collate/core`). `$E` = the election id in [`deployment.json`](../apps/web/src/deployment.json), currently `collate-demo-ng` (the demo election: synthetic results, real Nigerian state and LGA names), or the `election` URL parameter.

| # | Purpose | Query | Sent to Arkiv? | Code |
| --- | --- | --- | --- | --- |
| Q1+Q2+Q3 | The election, its polling units and the accreditations, for every coordinator on the page, in one query, cursor-paginated | `(type = str('election') OR type = str('unit') OR type = str('accreditation')) AND election = str($E) AND ($creator = addr($coordA) OR $creator = addr($coordB))` | Yes | `setupQuery` in [`model/panels.ts`](../apps/web/src/model/panels.ts), [`lib/data.ts`](../apps/web/src/lib/data.ts) |
| Q3 | Resolve trusted observers for the chosen coordinator | `type = str('accreditation') AND election = str($E) AND $creator = addr($coordinator)` → set of `observer` | Only if Q1+Q2+Q3 is not in the session cache; otherwise answered from it | [`core/trust.ts`](../packages/core/src/trust.ts) |
| Q4′ | Results and corrections from any creator, split by trust in the browser (trusted ones counted, the rest listed as not counted) | `(type = str('unit_result') OR type = str('correction')) AND election = str($E)` | Yes | `resultsQuery`, `includeIgnored` in [`core/panel.ts`](../packages/core/src/panel.ts) |
| Q4+Q8 | Same, trusted creators only (coordinator console) | Q4′ `AND ($creator = addr($o1) OR …)` (25 creators per query, in parallel) | Only if Q4′ is not cached | [`core/query.ts`](../packages/core/src/query.ts) |
| Q5 | One state | Q4 `AND state = str($S)` | Not run by the pages (`statePanel`, for Studio and the API) | [`model/panels.ts`](../apps/web/src/model/panels.ts) |
| Q6 | Latest submissions | Q4 `AND submitted_at > u64($since)` (1 h, 24 h, 7 d or since polls opened; by default the narrowest window that shows the newest result) | No: the same range is applied in the browser to Q4′'s trusted rows. Shown under the card; "Open in Studio" runs it on Arkiv | `latestPanel` |
| Q7 | High rejected ballots | Q4′ `AND rejected > u64(5)`, narrowed to 8 or 10 in the browser | Yes, a genuine range query, once, when the card scrolls into view; shared by both observer groups | `suspiciousPanel` |
| Q9 | Observer's own accreditations | `type = str('accreditation') AND election = str($E) AND observer = str($me) AND ($creator = addr($coordA) OR $creator = addr($coordB))` | Answered from Q1+Q2+Q3, which the observer page starts first | [`pages/Observe.tsx`](../apps/web/src/pages/Observe.tsx) |
| Q10 | Open sandbox registrations, from any wallet | `type = str('sandbox_registration') AND election = str($E)` → `observer` values that equal `$creator` | Yes, once, when the Open sandbox is chosen (pinned to Q3's block when Q3 was read just then); also read fresh by the observer page right after joining, which leaves it in the session cache | `trustFor(…, sandbox)` in [`model/panels.ts`](../apps/web/src/model/panels.ts), `selfRegistration` in [`core/trust.ts`](../packages/core/src/trust.ts) |
| Live | New results, corrections, deletions, extensions | `watchEntityEvents` on a WebSocket transport, no `fromBlock`. Each burst of `EntityCreated` from trusted owners is re-read in one `($key = key(…) OR …) AND <panel query>` at the block they landed in, and each `$creator` re-checked before it is applied | One query per burst | [`core/live.ts`](../packages/core/src/live.ts), [`core/panel.ts`](../packages/core/src/panel.ts) |

### Read budget

Tiramisu prices every anonymous `arkiv_query` at a flat 100 cost units however many rows it returns, against 10,000 units per window (about an hour) per connection: about 100 queries an hour. `eth_blockNumber` and `eth_getLogs` sit under a separate, larger request limit. So the app prefers few broad queries and does everything else in the browser:

| Page or action | Queries before | Queries now |
| --- | --- | --- |
| Landing (live stat) | 1 | 1 (Q4′, which the results page then reuses) |
| Results, first load | 5, up to 8 when the two secondary panels re-ran after the main one loaded | 2 (Q1+Q2+Q3, Q4′), 3 once the high-rejected card is in view; 1 right after the landing page |
| Results, switch Group A ↔ B | 5 to 8 | 0 within 90 s (both groups' setup, Q4′ and Q7 are shared); 2 or 3 after that |
| Results, switch to the Open sandbox | — | 1 within 90 s (Q10; Group A's accreditations and Q4′ come from the cache), then 0 for switching back and forth; 3 when opened directly with `?group=sandbox` |
| Results (sandbox), a new wallet writes anything | — | its first entity is checked against Q10: 1 query per batch of up to 25 new wallets, at most once a minute; a valid registration then re-reads trust and results (3) |
| Results, change quorum, grouping (state/LGA/ward) or chart/table | 0 / 2 / 0 | 0 |
| Results, change the latest-submissions window or rejected threshold | 2 | 0 |
| Results, idle | 0 | 0 |
| Results, a trusted observer posts | 1 + 3 (secondary panels re-ran) | 1 |
| Results, the coordinator accredits or revokes | 2 + 3 | 2 (trust and results, read fresh) |
| Results → "Open in Studio" | 2 | 0 within 90 s |
| Observer page (after connecting) | 3 | 2 (the wallet's own read also finds its sandbox registration); after posting, 1; after joining the sandbox, 2 (own entities and Q10, both fresh). The GLM balance check is `eth_getBalance`, not a metered query |
| Coordinator console | 5 | 1 to list your elections (elections, units and accreditations you created, in one read; it also answers each election's setup); 0 to open an election or move between steps 1–3; 1 for the Share step's progress (0 if the results page read it within 90 s); 1 fresh read after each write |
| Studio, shared link or preset | 2 per panel with a trust list, 1 without | the same for a new query, 0 for any query the session already read (including narrower ones such as "Polling units" after the results page); a dashboard of N panels costs one read per distinct query |
| Reload within 90 s | as first load | 0 (snapshots persist in `sessionStorage`) |

How collate-core keeps it there ([`core/query.ts`](../packages/core/src/query.ts), [`core/cache.ts`](../packages/core/src/cache.ts)):

- **One request per read in flight.** Identical concurrent reads, including React StrictMode's double mount, share one request.
- **A 90-second session cache.** A head read finished within the TTL answers the same read, or a narrower one: fewer creators, one value of an OR over types, or an extra equality (e.g. `observer = $me`), filtered in the browser. Range predicates are never evaluated locally, so a range query always reaches Arkiv. Finished reads persist in `sessionStorage` (bigints tagged) with the same TTL, so a reload does not re-query. Reads after a write (`fresh`), trust changes and live re-reads bypass it.
- **Cached snapshots catch up through the event log.** A live panel served from the cache replays entity events since that snapshot with one `eth_getLogs` and re-reads only new entities from trusted wallets. So a cached snapshot never hides a newer write from a live panel; non-live reads (the landing stat, the election and units) can be up to 90 s old. That is the trade-off: a stale count for at most the TTL on non-live views, in exchange for a session that fits the anonymous budget.
- **Fail fast on 429.** The first `HTTP 429 ANON_COST_LIMITED` is recorded with its `Retry-After`; later queries are refused in the browser until then, the page shows one notice with the reset time, and panels retry once when it passes. viem's own retries are off because viem waits out `Retry-After` before failing.

In development the app shows "Arkiv queries this session: N" in the corner (or add `?debug` to the URL), counted from every `arkiv_query` page the transport sends.

Every paginated walk reads one block (`.atBlock(n)`) and follows `QueryResult.next()` until there is no cursor, so totals are a consistent snapshot even past 200 entities.

## Writes

| Who | What | How |
| --- | --- | --- |
| Coordinator | Election + all its units (+ accreditations in the seed) | One `executeBatch` of creates, so the election appears complete or not at all. Tiramisu refused an 81-create batch without a reason ([friction #11](friction.md)), so the seed and the coordinator console both fall back to atomic chunks of 15: they re-read what exists and send only what is missing, and stop with the transaction link if an outcome is unknown instead of resending. The 72-unit demo landed that way |
| Coordinator | Accredit (one, or several in one `executeBatch`) / extend lease / revoke | `createEntity` or `executeBatch` / `extendEntity` (`ExpirationTime.atBlock(expiresAt + 7 days)`) / `deleteEntity` |
| Anyone | Join the Open sandbox | `createEntity` of a `sandbox_registration` from their own wallet, `flags: { readonly: true }` |
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
| Batch writes | Election setup | Election and units land atomically (in chunks of 15 when a batch is too large) |

**Deliberately not used:** ownership transfer and `ownedBy()` (no product need), patches (results are immutable by design).

## Known limits

- An accreditation's expiry or deletion stops its observer's results counting for that group, including results posted while accredited. Coordinators extend leases while counting continues.
