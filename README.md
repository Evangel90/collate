# Collate

**Election results nobody can quietly edit or switch off.**

Collate is a public, tamper-evident election results board built on [Arkiv](https://arkiv.network), the Web3 database. Accredited observers post polling-unit results as Arkiv entities; anyone can watch totals by ward, LGA and state update live, straight from Arkiv, with no Collate server in the path.

Built for **Arkiv: Global Tour Stop** (9–18 Oct 2026). Tracks: **Censorship Resistance** and **Open Source**. All data is synthetic: a fictional election, fictional parties and units, and observers known only by wallet and alias.

- **Live app:** _added after deployment_
- **Schema (data contract):** [`arkiv/schema.md`](arkiv/schema.md)
- **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Seed transactions on the explorer:** [`arkiv/seed-transactions.md`](arkiv/seed-transactions.md)
- **Engine:** [`packages/core`](packages/core) (`@collate/core`)

## The problem

When an official results portal stalls, the public loses sight of the count exactly when trust matters most. In Nigeria's February 2023 presidential election, less than 30% of polling-unit results were on the official IReV portal by 6 pm the day after the vote; by 9:30 pm on 28 February, 79,927 of 176,846 (45.19%) were up. Independent observer groups collect their own unit results but publish them on websites and social accounts that can be throttled, taken down or dismissed as unverifiable, and journalists have no way to prove a figure was not changed later.

## What Collate does

- **Observers** post each unit's result from the wallet their group accredited. It lands as a readonly Arkiv entity: nobody, including Collate, can edit it. A mistake is fixed with a correction that names the original; both stay public.
- **Viewers** (no wallet needed) pick which observer group to trust. Collate reads that group's accreditations, then only results *created* by those wallets, and recomputes every total in the browser. Units where two trusted observers disagree are flagged, shown side by side, and left out of totals. Writes from unaccredited wallets are listed and ignored.
- **Every number** opens a proof dialog: the creator wallet, the entity on the explorer and its expiry. Results are created with permissionless extension, so **anyone** can keep them alive.
- **No backend.** The app is a static build that talks only to Arkiv's public RPC. Take our site down and anyone can serve the same page, or query the entities directly, and see the same numbers.

Honest limit: Arkiv's block production is still centralised during testnet, so the claim is "readable and verifiable by anyone without our backend", not "impossible to stop".

## What stays off Arkiv

| Kept off Arkiv | Why | Where it lives instead |
| --- | --- | --- |
| Voter and observer identities | Personal data is never stored, even hashed; observers are exposed to pressure if named | Nowhere; observers are wallet addresses plus a synthetic alias |
| Result-sheet photos | Large, and can expose people at the unit | With the observer group; only a SHA-256 hash (computed in the browser) is stored |
| Computed totals | A stored "official total" is one more thing that can be wrong or forged | Recomputed by every viewer from raw results |
| Disputes | Derived; storing them would let one party declare a dispute settled | Computed client-side by collate-core |
| Keys and secrets | Dangerous and disqualifying | `.env` (git-ignored) and the user's wallet |
| Viewer preferences | Personal, per device | Browser `localStorage` |

## Repository

```
collate/
├── packages/core/     @collate/core: live, trust-filtered Arkiv panels (+ optional React UI)
├── apps/web/          Collate: public results, observer, coordinator and collate-core pages
├── scripts/           wallets.ts, seed.ts (synthetic election), verify.ts (reproduce totals)
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

The seed is idempotent: each step queries Arkiv first and skips what is already there. A write with an unknown outcome stops the run with its transaction hash instead of being resent.

## Reproduce every claim

1. Open the live app, keep **Observer Group A** selected, and note the totals.
2. Run `npm run verify`. It prints the exact queries (Q3, then Q4 + Q8), the trusted observers, how many writes were ignored, the disputes and the totals by state, read straight from Tiramisu. They match the page.
3. Switch to Group B on the page and run `npm run verify -- --coordinator <Group B address>`.
4. Or skip our code entirely: query `type = "unit_result" AND election = "demo-2027"` with any Arkiv client and filter by the creators listed below.

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

1 election (`demo-2027`), 2 observer groups, 12 observers, 48 polling units across 2 states, 4 LGAs and 8 wards, 3 fictional parties. Deliberate cases: two disputed units in Group A's view and one in Group B's, one confirmation (two observers agree), one correction, one unit left for the live demo, and one inflated result from an unaccredited wallet. Generated deterministically by [`scripts/demo-data.ts`](scripts/demo-data.ts).

## Built with

TypeScript, React, Vite, viem and `@arkiv-network/sdk` 0.8.1. AI coding assistant: Claude Code (Claude Opus 5.5). Everything in this repository was written during the hackathon (9–18 Oct 2026); there is no pre-existing work.

## Licence

MIT, see [LICENSE](LICENSE).
