# Arkiv friction log

Kept during the build, newest last. Smooth paths are logged with the same detail as problems. Environment unless noted: `@arkiv-network/sdk` 0.8.1, viem 2.57.7, Node 26.3.0, npm 11.16.0, macOS (Darwin 25.6), Tiramisu chain 7738577.

### 1. SDK ships its TypeScript source: API names verifiable on day one (smooth)
- Surface: TypeScript SDK `@arkiv-network/sdk` 0.8.1
- Expected: to have to guess between the 0.6 names (`buildQuery`, `watchEntities`) seen in older material and the 0.8 names.
- Actual: the package includes `src/` alongside `dist/`, with JSDoc on every action. `select().where().createdBy().atBlock().limit().fetch()`, `QueryResult.next()`, `extendEntity`, `executeBatch`, `watchEntityEvents` and `ExpirationTime` were all confirmed by reading `node_modules/@arkiv-network/sdk/src` before any code was written.
- Steps to reproduce: `npm install --save-exact @arkiv-network/sdk@0.8.1 viem`, then `ls node_modules/@arkiv-network/sdk/src/actions`.
- Workaround: none needed.
- Suggested fix: keep shipping `src/`; it made the version check trivial.

### 2. One query can filter by several creators (smooth)
- Surface: TypeScript SDK 0.8.1 query builder, JSON-RPC `arkiv_query`
- Expected: unsure whether `$creator` could appear inside an `OR`; `createdBy()` takes a single address and replaces any earlier call.
- Actual: `where(eq("type", "unit_result"), or(eq("$creator", addr(a)), eq("$creator", addr(b))))` renders as `type = str('unit_result') AND ($creator = addr(0x…01) OR $creator = addr(0x…02))` and the node accepts it (0 rows, no error) at block 615439.
- Steps to reproduce: see the query above with any two addresses; `await client.select({ key: true }).where(...).limit(5).fetch()`.
- Workaround: none needed. collate-core OR-s up to 25 creators per query and runs the chunks in parallel at one pinned block.
- Suggested fix: mention multi-creator `OR` in the `createdBy()` JSDoc, since its "calling it again replaces the filter" note suggests a single creator is the only option.

### 3. `addr()` checksums addresses in rendered query text
- Surface: TypeScript SDK 0.8.1 (`@arkiv-network/sdk/query`, `Expression.toString()`)
- Expected: `eq("$creator", addr("0x…aa"))` to render the address as given (lowercase).
- Actual: it renders the EIP-55 checksummed form, e.g. `addr(0x00…00AA)`. A unit test comparing rendered text to a lowercase string failed.
- Steps to reproduce: `import { addr } from "@arkiv-network/sdk/attr"; import { eq } from "@arkiv-network/sdk/query"; eq("$creator", addr("0x00000000000000000000000000000000000000aa")).toString()`.
- Workaround: compare rendered queries case-insensitively.
- Suggested fix: note the normalisation in the `addr` JSDoc. Not a bug; matching is by value either way.

### 4. SDK logger touches `globalThis.localStorage` in Node, which Node 26 warns about
- Surface: TypeScript SDK 0.8.1, `src/utils/logger.ts`
- Expected: a Node script that runs a query to print nothing but its own output.
- Actual: the first query prints `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.` Importing the SDK alone does not trigger it; `getLogger` → `getDebugEnv()` does, when `DEBUG` is unset, because Node ≥ 25 defines `localStorage` on `globalThis` and warns on access.
- Steps to reproduce: Node 26.3.0, no `DEBUG` env; run `await createPublicClient({ chain: tiramisu, transport: http() }).select({ key: true }).where(eq("type", "x")).fetch()`.
- Workaround (both verified): `NODE_OPTIONS=--no-experimental-webstorage`, or set `DEBUG` to any non-empty value (e.g. `DEBUG=none`) so the logger never reaches the `localStorage` branch.
- Suggested fix: check `typeof window !== "undefined"` (or `typeof process === "undefined"`) before reading `localStorage` in `getDebugEnv()`.

### 5. Entity events carry keys, not attributes: a read per event (smooth, documented)
- Surface: TypeScript SDK 0.8.1 `watchEntityEvents`
- Expected: to filter live events by attribute (e.g. `type = unit_result`).
- Actual: `EntityCreated` carries `entityKey`, `owner`, `expiresAt` and `creationFlags` only; the JSDoc says so plainly. collate-core re-reads each candidate with `$key = key(k) AND <panel query>`, so the node itself decides whether it belongs to the panel, then re-checks `$creator`.
- Steps to reproduce: in a Node ESM script with `@arkiv-network/sdk@0.8.1` and `viem@2.57.7` installed, run
  ```ts
  import { createPublicClient } from "@arkiv-network/sdk"
  import { tiramisu } from "@arkiv-network/sdk/chains"
  import { webSocket } from "viem"
  const client = createPublicClient({ chain: tiramisu, transport: webSocket("wss://rpc.tiramisu.db-chain.testnet.arkiv.network") })
  client.watchEntityEvents({ onEntityCreated: (e) => console.log(Object.keys(e), e) })
  ```
  and wait for another app's write: each logged event has `entityKey`, `owner`, `expiresAt` and `creationFlags`, and no attributes.
- Workaround: the re-read above; events from untrusted owners are skipped before any read.
- Suggested fix: optional attribute filter on the subscription, or include attributes in the event, to save one round trip per event.

### 6. Faucet needs a browser wallet: no scripted funding for seed wallets
- Surface: Hub faucet, https://hub.arkiv.network/faucet
- Expected: a way to fund a freshly generated seed wallet from a script or by pasting an address.
- Actual: the page connects a browser wallet and allows "one claim per wallet, per cooldown window"; the cooldown length is not stated on the page. A seed script with 15 fresh wallets can't fund itself.
- Steps to reproduce: (1) open https://hub.arkiv.network/faucet in a browser profile with no wallet extension: there is no field to paste an address, only a connect-wallet button; (2) read the claim rules on the page: "one claim per wallet, per cooldown window", with no length given for the window.
- Workaround: fund one wallet (Coordinator A) by hand; `scripts/seed.ts` sends a share of its GLM to the other 14 wallets with plain value transfers.
- Suggested fix: allow pasting an address, and state the amount and cooldown.

### 7. Explorer returns HTTP 200 for every path
- Surface: Block explorer, https://tiramisu.explorer.arkiv.network
- Expected: a 404 for a malformed entity or transaction route, so link checks can validate the links Collate generates.
- Actual: `/entity/0x01`, `/tx/0x01` and `/address/<addr>` all return 200 (a single-page app shell); validity is only visible after JavaScript runs.
- Steps to reproduce: `curl -s -o /dev/null -w "%{http_code}" https://tiramisu.explorer.arkiv.network/entity/0x01`.
- Workaround: check links by eye in a browser.
- Suggested fix: server-side 404 for malformed keys and hashes.

### 8. Live entity events over WebSocket work out of the box (smooth)
- Surface: WebSocket events, `wss://rpc.tiramisu.db-chain.testnet.arkiv.network`, SDK 0.8.1 `watchEntityEvents`
- Expected: to need a polling fallback, since some EVM RPCs do not support `eth_subscribe` for logs.
- Actual: `createPublicClient({ chain: tiramisu, transport: webSocket(url) }).watchEntityEvents({ onEvent })` with no `fromBlock` delivered 35 decoded events (mostly `EntityCreated` from other apps) in 40 seconds, starting at block 616110, with no errors.
- Steps to reproduce: the snippet above; log `e.type`, `e.entityKey`, `e.blockNumber` and count for 40 s.
- Workaround: none needed. Because the chain is shared and busy, collate-core skips events from untrusted owners and batches re-reads of the rest into one `$key = … OR $key = …` query per flush.
- Suggested fix: none; an optional server-side owner filter on the subscription would save clients the skipping.

### 9. Anonymous read budget runs out mid-build, and the SDK surfaces it as a bare "HTTP request failed"
- Surface: JSON-RPC `arkiv_query` on `https://rpc.tiramisu.db-chain.testnet.arkiv.network`, TypeScript SDK 0.8.1 over viem `http()`
- Expected: a development day of probes, a seed run and a few verification runs from one machine to stay within the public read limits, or a clear error if not.
- Actual: after a day's development, every query started failing. The SDK error was only `HTTP request failed.`; viem's default retries on 429 made `npm run verify` hang for over two minutes instead of failing. The raw response was `HTTP 429`, headers `ratelimit: limit=10000, remaining=0, reset=883` and `retry-after: 883`, body `{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}`. No `Arkiv-Cost` header is sent on the 429s. Once the window reset, successful `arkiv_query` responses carried `arkiv-cost: 100` for every query measured: 1, 8, 48 and 76 rows, key-only or full selection, all cost 100. The anonymous budget is therefore 100 queries per window (about an hour) per connection, independent of result size. Non-query methods (`eth_blockNumber`) sit under a separate `limit=600` request limit. The budget had been spent by Collate's own live panels re-reading every new entity on the shared chain (about 20 queries a minute), so a single open tab emptied it in minutes.
- Steps to reproduce: from one IP at the start of a fresh window, send 101 queries and count the status codes; expect 100 × `200` then `429`:
  ```sh
  for i in $(seq 101); do curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["type = str(\"x\")",{"includeData":{"key":true}}]}' https://rpc.tiramisu.db-chain.testnet.arkiv.network; done | uniq -c
  ```
  Then see the headers and body of the refusal (and, after the reset, `arkiv-cost: 100` on a success) with `curl -s -D - -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["type = str(\"x\")",{"includeData":{"key":true}}]}' https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
- Workaround: collate-core now (a) turns viem's retries off, because even one viem retry waits out `Retry-After` (883 s here) before failing, and meters its own transport instead: a 429 is recorded once, later queries are refused in the browser until `Retry-After` passes, and the page shows one message and retries then; (b) never re-reads live events from untrusted owners, so an idle trusted panel makes no queries; (c) keeps a session cache, so identical or narrower reads within 90 s cost nothing, and a panel served from it catches up through `eth_getLogs`, which is not metered; and (d) the app merges the election, its units and the accreditations of both observer groups into one OR query and derives secondary panels from the main panel's rows. Because cost is per query, not per row, fewer broader queries beat many narrow ones. A results page load is now 2 queries (3 once the range-query card is scrolled into view). API keys are not an option for a public static page: they belong in server-side headers, and Collate has no server by design.
- Suggested fix: name the limit in the SDK error (map 429 `ANON_COST_LIMITED` to a typed error carrying `retryAfter`), and document the anonymous budget, its window and the flat 100-unit query price next to the query docs, so apps design for "few broad queries" from the start.

### 10. Catching up on entity events from a past block means hard-coding the Arkiv address
- Surface: TypeScript SDK 0.8.1 exports (`ENTITY_EVENTS_ABI` is exported, the address the events come from is not), `watchEntityEvents({ fromBlock })`
- Expected: a cached snapshot read at block N could be brought up to date with one call for the entity events since N, since logs are not metered like `arkiv_query`.
- Actual: with `fromBlock`, viem turns `watchEntityEvents` from a subscription into polling (a request about every second at the SDK default interval), which would spend the separate request limit. A one-off `client.getLogs({ address, events: ENTITY_EVENTS_ABI, fromBlock })` works (the last 300 blocks returned 539 `EntityCreated` logs, decoded, at no query cost), but the address, `0x4400000000000000000000000000000000000044`, is only an internal constant (`ARKIV_ADDRESS` in `dist/expiry-*.js`) and has to be copied into app code.
- Steps to reproduce: `import { ARKIV_ADDRESS } from "@arkiv-network/sdk"` fails to resolve; `grep -rn "ARKIV_ADDRESS =" node_modules/@arkiv-network/sdk/dist` shows the value.
- Workaround: collate-core hard-codes the address in `live.ts` (`replay`).
- Suggested fix: export `ARKIV_ADDRESS`, or add a `getEntityEvents({ fromBlock, toBlock })` action that decodes a range of events once.

### 11. A large `executeBatch` is refused with no reason, so "the election lands whole" breaks past some size
- Surface: TypeScript SDK 0.8.1 `executeBatch` (creates only) on Tiramisu, from `npm run seed` on 18 Oct 2026
- Expected: one batch of 81 creates (an election, 72 units, 8 accreditations, attributes only plus small JSON payloads) lands atomically, as a 57-create setup batch for the earlier demo did, or fails with a reason that says which limit was hit.
- Actual: both coordinators' 81-create batches failed with `Transaction failed: Execution error without revert data`. Nothing from either batch exists afterwards (the seed's re-read at the next block found 0 entities for that coordinator), and the same 81 creates in batches of 15 all landed (12 transactions, links in `seed-transactions.md`). The error does not say whether gas, payload size or an operation count was the limit, and the batch-size limit is not documented next to `executeBatch`.
- Steps to reproduce: `npm run seed` against a fresh election id with the 72-unit demo in `scripts/demo-data.ts`; the coordinator step logs `one batch was refused (...); splitting`.
- Workaround: the seed tries one batch first and falls back to atomic chunks of 15. The cost is that an election is briefly visible with only some of its units; the app tolerates this because it computes "units with no result" from whatever units exist.
- Suggested fix: document the maximum operations or bytes per `executeBatch`, and surface the limit in the error (or let the SDK split a batch and report that it is no longer atomic).

### 12. The Arkiv MCP serves the rules exactly, but its search does not know the hub's "Nobody built this yet" list
- Surface: Arkiv MCP (Claude Code plugin `arkiv`), tools `read_knowledge` and `search_knowledge`, used on 17 Oct 2026
- Expected: the event's rules to be quotable exactly, and a search for unbuilt ideas or wanted tools to surface the gap list the Arkiv team publishes on https://hub.arkiv.network/ecosystem.
- Actual: `read_knowledge("devfolio/rules")`, `devfolio/scoring-rubric` and `devfolio/submission-checklist` returned the canonical files pinned to commit `4f912d1fa595125621962c053a9f36fdcfca5a54`, with a digest, which made the rubric easy to check against (smooth). `search_knowledge("ideas not yet built missing tools gaps wanted Global Tour Stop")` returned 0 results, and `search_knowledge("devfolio ideas tooling wishlist aggregation dashboard")` returned only the rubric and the event README. The hub's "Nobody built this yet" section (five gaps, including "Query-to-Dashboard Studio", which Collate Studio answers) is not in the MCP's knowledge; we found it only through a link shared by a person.
- Steps to reproduce: with the Arkiv MCP connected, call `search_knowledge` with either query above, then open https://hub.arkiv.network/ecosystem and scroll to "Nobody built this yet".
- Workaround: read the hub page directly.
- Suggested fix: index the hub's ecosystem page, or at least its gap list, in the MCP knowledge base, so builders and agents planning an entry find what the Arkiv team wants built.
