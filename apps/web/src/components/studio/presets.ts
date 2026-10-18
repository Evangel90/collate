/**
 * Studio's starting points. Two are Collate's own election panels; the rest read other hackathon
 * teams' public entities on Tiramisu, found by querying Arkiv, to show the engine is not about
 * elections. Nobody was asked: Arkiv data is public, and reading it needs no permission.
 */
import { eq } from "collate-core"
import { deployment } from "../../lib/collate"
import { resultsPanel, unitsPanel } from "../../model/panels"
import { normalize, type StudioPanel } from "./model"

export type Preset = {
  id: string
  label: string
  description: string
  /** Whose entities these are. */
  source: "collate" | "other"
  /** For other teams' data: what we know about it, all read from the entities themselves. */
  about?: string
  panel: StudioPanel
}

const [groupA, groupB] = deployment.coordinators

/** The five wallets in Asli's on-chain registry (each `asli.registry` entity names its own wallet). */
const ASLI_REGISTRY = [
  "0x7a46f05085a1105ff0278ca014fe128c1eb23ce9", // Aushadh Labs, manufacturer
  "0x17b13fb1c55b021c6902d78eb1ee077252cb2444", // MedRoute Logistics, distributor
  "0xfbc4a6e55e1d57f55a5d65fc1ad0ce2f5b99c3b7", // Reliant Pharmacy
  "0x5c83c5c56407f9e5996cb9a44215d72141b71c54", // QuickMeds Hub, pharmacy
  "0x618c38714e62dc0b18d5951e1cc78fb6980a1cc5", // Asli Public Scan Relay
] as `0x${string}`[]

const asliBatches: StudioPanel = {
  title: "Asli: drug units per product",
  query: [eq("type", "asli.batch")],
  disputeKey: "batch_code",
  compareFields: ["units"],
  groupBy: "drug_name",
  sum: ["units"],
  view: "bar",
}

const ASLI_ABOUT =
  "Asli is another team's drug-batch provenance project on Tiramisu: manufacturers register batches (asli.batch), custody hops follow them (asli.custody) and the public files flags. All of it is synthetic test data in their public entities."

const PRESETS_RAW: Preset[] = [
  {
    id: "asli-registry",
    label: "Asli batches, registered wallets only",
    description: "Same query, trusting only wallets in Asli's own registry. The clone comes from an unregistered wallet and is ignored.",
    source: "other",
    about: ASLI_ABOUT,
    panel: {
      ...asliBatches,
      title: "Asli: units per drug, registry wallets",
      trust: { rootCreators: ASLI_REGISTRY, listQuery: [eq("type", "asli.registry")], addressField: "wallet_addr", labelField: "name" },
      includeIgnored: true,
      // Live is cheap with a trust list: only new entities from trusted wallets are re-read.
      live: true,
    },
  },
  {
    id: "asli-any",
    label: "Asli drug batches, any wallet",
    description: "Another team's data. Two wallets claim batch GF5-26A-0142 with different unit counts, so consensus holds it back.",
    source: "other",
    about: ASLI_ABOUT,
    panel: { ...asliBatches, title: "Asli: units per drug, any wallet" },
  },
  {
    id: "haqclock",
    label: "haqclock right-to-information outcomes",
    description: "Another team's data: historical RTI appeal cases, counted by Information Commission outcome.",
    source: "other",
    about:
      "haqclock is another team's project tracking India's right-to-information deadlines. Its case entities carry the authority, reply and appeal deadlines, and for historical cases the Central Information Commission's outcome.",
    panel: {
      title: "haqclock: RTI cases by outcome",
      query: [eq("type", "case"), eq("app", "haqclock"), eq("historical", true)],
      groupBy: "cic_outcome",
      view: "bar",
    },
  },
  {
    id: "collate-a",
    label: "Collate results, Group A",
    description: "Our election demo: trust from accreditations, corrections, disputes, ignored writes.",
    source: "collate",
    panel: resultsPanel(deployment.election, groupA!.address, "state"),
  },
  {
    id: "collate-b",
    label: "Collate results, Group B by ward",
    description: "Same results through another observer group's accreditations.",
    source: "collate",
    panel: resultsPanel(deployment.election, groupB!.address, "ward"),
  },
  {
    id: "collate-units",
    label: "Collate polling units",
    description: "Registered voters per state, from one coordinator wallet.",
    source: "collate",
    panel: unitsPanel(deployment.election, groupA!.address),
  },
]

/** Presets in the form's canonical shape, so the picker recognises a preset after a round trip. */
export const PRESETS: Preset[] = PRESETS_RAW.map((p) => ({ ...p, panel: normalize(p.panel) }))
