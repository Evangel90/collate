# Collate

**Election results nobody can quietly edit or switch off.**

Collate is a public, tamper-evident election results board for low-trust elections, built on [Arkiv](https://arkiv.network), the Web3 database. A committee of fairly trusted observers posts polling-unit results as Arkiv entities; a unit's result counts only when a majority of the committee members who reported agree. Anyone can watch totals by ward, LGA and state update live, straight from Arkiv, with no Collate server in the path.

The engine underneath, [`collate-core`](packages/core), knows nothing about elections. **Collate Studio** uses it to turn any Arkiv query, including other projects' data, into a live, trust-filtered, shareable dashboard.

Built for **Arkiv: Global Tour Stop** (9–18 Oct 2026). Tracks: **Censorship Resistance**, **Open Source** and **Security**. All results are synthetic: a demo election with fictional parties, polling units and observers (known only by wallet and alias), set in real Nigerian states and LGAs. It is not a real election and its figures reflect no real vote.

- **Live app:** https://collate-arkiv.vercel.app (static, no login, reads straight from Arkiv): [results](https://collate-arkiv.vercel.app/#/results) · [Studio](https://collate-arkiv.vercel.app/#/studio)
- **Schema (data contract):** [`arkiv/schema.md`](arkiv/schema.md)
- **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Seed transactions on the explorer:** [`arkiv/seed-transactions.md`](arkiv/seed-transactions.md)
- **Engine:** [`packages/core`](packages/core) (`collate-core`)

## Three ways in

- **For the public: watch and verify the count.** Pick which observer group you trust, follow totals by state, LGA and ward live, see which units are certified, contested or pending, and open any number to find the wallet that posted it. No wallet or login needed.
- **For observer groups: run a committee.** Create an election and its polling units, accredit your observers' wallets and share one link. Observers post from their own wallets; mistakes become public corrections, never silent edits.
- **For builders: turn any Arkiv data into a live dashboard.** Collate Studio works on any project's entities, not just elections, and the same engine, `collate-core`, drops into your own app.

What makes it different: no single party, including us, can edit, hide or switch off what observers reported. Results are readonly on Arkiv, a unit counts only when the observers who reported it agree, and every viewer recomputes the totals from Arkiv in their own browser.

## The problem

When an official results portal stalls, the public loses sight of the count exactly when trust matters most. In Nigeria's February 2023 presidential election, less than 30% of polling-unit results were on the official IReV portal by 6 pm the day after the vote; by 9:30 pm on 28 February, 79,927 of 176,846 (45.19%) were up. Independent observer groups collect their own unit results but publish them on websites and social accounts that can be throttled, taken down or dismissed as unverifiable, and journalists have no way to prove a figure was not changed later.

## What Collate does

- **Observers** post each unit's result from the wallet their group accredited. It lands as a readonly Arkiv entity: nobody, including Collate, can edit it. A mistake is fixed with a correction that names the original; both stay public.
- **Viewers** (no wallet needed) pick which observer group to trust. Collate reads that group's accreditations, then only results *created* by those wallets, and recomputes every total in the browser. Writes from unaccredited wallets are listed and ignored.
- **Committee consensus decides each unit.** Collate keeps each observer's latest result for a unit and groups identical ones. The unit is **certified** when the largest group is a strict majority of the observers who reported and has at least *N* members (the quorum; the coordinator suggests it, the viewer can raise it). Otherwise it is **pending** (too few reports) or **contested** (no majority). Only certified units count; contested ones show every version side by side, and observers who disagree with a certified result are named as outliers, by wallet. One careless or compromised observer can no longer veto a unit, and cannot push a result through alone either.
- **Every number** opens a proof dialog: the creator wallet, the entity on the explorer and its expiry. Results are created with permissionless extension, so **anyone** can keep them alive.
- **No backend.** The app is a static build that talks only to Arkiv's public RPC. Take our site down and anyone can serve the same page, or query the entities directly, and see the same numbers.

## Collate Studio: the read side for Arkiv

Arkiv's [ecosystem page](https://hub.arkiv.network/ecosystem) lists gaps across 116 projects under "Nobody built this yet". One of them is a **Query-to-Dashboard Studio**: "Every project here writes entities in — nobody ships the read side." Studio is that read side:

- Build a panel with a form (filters, ranges, `$creator`, trust list, group-by, sums, consensus and quorum) or as JSON. Studio shows the exact Arkiv query it runs.
- Results update live over WebSocket entity events and page past Arkiv's 200-entity limit at one pinned block.
- Every panel is a link. Pin up to six panels to a dashboard that is also one link.
- "Use in your app" generates the TypeScript or React code for the current panel with `collate-core`.
- Presets include **other teams' public data, read without asking**: Asli's drug-batch provenance entities (with a cloned batch from an unregistered wallet flagged and then ignored by a trust list) and haqclock's right-to-information cases.

The same consensus rule also speaks to the "Multi-Writer Collaborative State" gap on that page: many single-owner entities from different wallets resolve to one agreed result, with authorship checked against `$creator`.

## What stays off Arkiv

| Kept off Arkiv | Why | Where it lives instead |
| --- | --- | --- |
| Voter and observer identities | Personal data is never stored, even hashed; observers are exposed to pressure if named | Nowhere; observers are wallet addresses plus a synthetic alias |
| Result-sheet photos | Large, and can expose people at the unit | With the observer group; only a SHA-256 hash (computed in the browser) is stored |
| Computed totals | A stored "official total" is one more thing that can be wrong or forged | Recomputed by every viewer from raw results |
| Disputes | Derived; storing them would let one party declare a dispute settled | Computed client-side by collate-core |
| Real wards, polling units and results | Made-up figures under real polling-unit names could pass for real results ahead of Nigeria's 2027 elections | Nowhere. The demo uses real state and LGA names only; wards are numbered, units are generic, parties are fictional, and the election's id, name and description say it is synthetic |
| Keys and secrets | Dangerous and disqualifying | `.env` (git-ignored) and the user's wallet |
| Viewer preferences | Personal, per device | Browser `localStorage` |

## Repository

```
collate/
├── packages/core/     collate-core: live, trust-filtered Arkiv panels (+ optional React UI)
├── apps/web/          Collate: landing, results, observer, coordinator and Studio pages
├── scripts/           wallets.ts, seed.ts (synthetic election), verify.ts (reproduce totals), replay.ts (offline)
├── arkiv/             schema.md, friction.md, seed-transactions.md
└── LICENSE            MIT
```

Stack: npm workspaces, TypeScript, Vite + React (static build), `@arkiv-network/sdk` **0.8.1** pinned exactly, viem, Vitest.

## Run it

Requires Node 20 or later.

```bash
git clone https://github.com/Evangel90/collate.git
cd collate
npm install
npm test            # collate-core unit tests
npm run dev         # http://localhost:5173, reads live from Tiramisu
npm run build       # static site in apps/web/dist
```

The web app needs no configuration: the public addresses it trusts are in [`apps/web/src/deployment.json`](apps/web/src/deployment.json). Posting results or using the coordinator console needs a browser wallet (MetaMask, Rabby); Collate asks it to add or switch to Tiramisu (chain 7738577).

### Seed your own copy of the demo

```bash
npm run wallets     # creates fresh wallets in .env (git-ignored), prints public addresses only
# fund Coordinator A at https://hub.arkiv.network/faucet
npm run seed -- --dry   # shows the plan, writes nothing
npm run seed            # funds the other wallets from Coordinator A, then writes everything
```

The seed is idempotent: it first reads everything the election already has from the seed wallets, in one paginated query, and writes only what is missing. Tiramisu meters every query (100 cost units each), so a full run makes at most a few, and prints how many. A write with an unknown outcome stops the run with its transaction hash instead of being resent.

## Reproduce every claim

1. Open the live app, keep **Observer Group A** selected, and note the totals.
2. Run `npm run verify`. It prints the exact queries (Q3, then Q4′, split by trust in memory: two metered queries in all), the trusted observers, how many writes were ignored, the certified, contested and pending units (with outliers) and the totals by state, read straight from Tiramisu. They match the page. Add `--quorum 2` to match the page with "Require at least 2 agreeing observers" selected.
3. Switch to Group B on the page and run `npm run verify -- --coordinator <Group B address>`.
4. Or skip our code entirely: query `type = "unit_result" AND election = "collate-demo-ng"` with any Arkiv client and filter by the creators listed below.

### Try it yourself

Groups A and B only count observers they accredited, so you can post through the **Open sandbox** instead:

1. Install a browser wallet (MetaMask or Rabby) and get test GLM for it at the [Arkiv faucet](https://hub.arkiv.network/faucet).
2. Open the [Observer page](https://collate-arkiv.vercel.app/#/observe) and connect. Collate switches the wallet to Tiramisu.
3. Under "Try it: join the Open sandbox as an observer", keep the synthetic alias (e.g. "Tester 4f2a") and press **Join the Open sandbox**. Your wallet signs one `sandbox_registration` entity naming its own address.
4. Post a result for a unit that already has one: the same figures make it **Certified 2/2**, different ones make it **Contested**.
5. Open [Results → Open sandbox](https://collate-arkiv.vercel.app/#/results?group=sandbox). Your result is there under your alias, marked self-registered. In the Group A and Group B views it is listed as not counted.

A registration is valid only when it was created by the wallet it names (`$creator` equals `observer`), which is what keeps anyone from forging one for another wallet. The sandbox still lets anyone in, so its totals are not vetted.

## Wallets that create Collate's entities (Tiramisu)

All are fresh testnet wallets created for this project and hold no real funds.

| Role | Address |
| --- | --- |
| Coordinator, Observer Group A (also funds the other seed wallets) | `0x86d0886835480cfEe3a0dBFb7814434dAB851381` |
| Coordinator, Observer Group B | `0xB926A5eeefbdE3dCb4AC648a76031C69d815D6FD` |
| Observer 01 (accredited by A) | `0x4381E820AA2064B8069a40B28275e9D7c75a23cD` |
| Observer 02 (A) | `0x7Acbb116475e811d0852351c339eF81742a8B17d` |
| Observer 03 (A) | `0xC8cDac4475EbBaA526ed2336abCb0745B7a929cc` |
| Observer 04 (A) | `0x46B9B7290cBe5AeC90Bc7926EA761b618aE489cC` |
| Observer 05 (A and B) | `0x4C186952a28be10EE3eC54c95c992219F514E26f` |
| Observer 06 (A and B) | `0x7442ebc8Ab204017d4eE2eDA57Ae11e695728574` |
| Observer 07 (A and B) | `0x932A2F8a2fD6185Ae9baC7840d0257C30ea03EAe` |
| Observer 08 (A and B) | `0x107B4fAcBFd36CB9E30a181b4ba04448b217aa5A` |
| Observer 09 (B) | `0xF2b9d24527198b447eEa8891e85fff6a551cF6e5` |
| Observer 10 (B) | `0x86C853e970c882DD78b026F5135B0782B360BB0D` |
| Observer 11 (B) | `0x4563504c13E20b9d635783eD4A61ABC17903ecf8` |
| Observer 12 (B) | `0xE99912B464D3C01Cd680Bdc6EF4bc6f5555f4a87` |
| Unaccredited wallet (posts one inflated result to show it is ignored) | `0xaAE64908f5c22a8327764a93907Aafd4e7C3AB97` |

## The demo dataset

1 election, `collate-demo-ng` ("Collate demo election (synthetic results, real Nigerian geography)"), 2 observer groups, 12 seeded observers (plus Observer 13, accredited by Group A later with `npm run accredit` for live testing), 72 polling units across 6 states (Lagos, Kano, Rivers, FCT, Enugu, Oyo), 12 LGAs (two per state, e.g. Ikeja and Surulere in Lagos) and 24 numbered wards, 3 fictional parties (Unity Party, Progress Alliance, Green Coalition). **Only the state and LGA names are real.** Every result, party, observer, ward and polling unit is synthetic: wards are numbered ("Ikeja Ward 03"), units are generic ("Unit 002, Civic Centre", code `LA-IKJ-03-002`), and the election's description says so.

Group A's observers cover every unit; Group B's own observers count Rivers, FCT and Enugu a second time. Deliberate cases: in Group A's view, `LA-IKJ-03-002` certified 2 to 1 with Observer 04 the outlier and `KN-NAS-09-002` contested (1 against 1); `FC-AMC-10-002` contested in Group B's view; six second counts that agree with the first observer, so at quorum 2 Group A still certifies six units; one correction (`KN-FAG-06-003`); one unit left for the live demo (`OY-OGN-07-003`, Observer 08's); and one inflated result for `LA-IKJ-03-001` from an unaccredited wallet. Results are timestamped across the 12 hours before seeding. Generated deterministically by [`scripts/demo-data.ts`](scripts/demo-data.ts); `npm run replay` runs it through `collate-core` offline, with no Arkiv reads:

| View | Certified | Contested | Pending |
| --- | --- | --- | --- |
| Group A, quorum 1 | 70 | 1 | 0 |
| Group A, quorum 2 | 6 | 1 | 64 |
| Group B, quorum 1 | 47 | 1 | 0 |
| Group B, quorum 2 | 24 | 1 | 23 |

An earlier version of the demo used election id `demo-2027` with invented place names; its entities stay on Tiramisu until they expire, but the app no longer reads them.

## Built with

TypeScript, React, Vite, viem and `@arkiv-network/sdk` 0.8.1. AI coding assistant: Claude Code (Claude Opus 5.5). Everything in this repository was written during the hackathon (9–18 Oct 2026); there is no pre-existing work.

## Licence

MIT, see [LICENSE](LICENSE).
