# Interval

Interval helps festival programmers fix draft running orders: Qloo’s taste graph flags linked acts that clash, and Interval proposes a few tested changes that keep every hold.

Two sets on different stages at the same time are normal. The overlaps that cost a festival are the ones between acts whose audiences overlap too, because those fans have to pick one. Interval finds those pairs with Qloo, then searches for at most four moved sets that remove them without breaking a single hold, and shows the evidence behind every warning.

**Live demo:** https://interval.timidan.xyz (no sign-in). **Built for** the Qloo Agentic Hackathon, 2026.

## Try it in 30 seconds

1. Open the running order. Austin City Limits 2026, Weekend 1, Friday: 32 sets on 8 stages, drawn as stages by time. One strong clash is marked: Paris Paloma and CMAT overlap for 15 minutes, and Qloo links them strongly.
2. Select **Repair running order**. Moving Paris Paloma 15 minutes later clears the clash, from 14 Qloo-weighted clash minutes to 0, with every hold kept. Interval also offers a second change when it finds one.
3. The tested change is drawn on the grid before you apply it, with dashed outlines where the moved sets play now. Apply it, then undo it.
4. Select **Evidence** on the clash: both directed Qloo scores, the request behind them and the row they came from. Below, one table compares the published timetable, three LLM-only repairs, a genre-only repair and Interval on the same metric.
5. Switch to III Points (two days, 13 stages), or **Import a draft**: paste your own running order as CSV, confirm the artist matches, see how many Qloo calls scoring needs, and run it.

## How it works

**Identity.** Each act is looked up with Qloo `/search` (artists only). A person confirms the match, because Qloo often has several artists with one name: ACL’s Leon Thomas is “Leon Thomas III”, not the jazz singer of the same name. b2b sets and acts with no match stay unknown.

**Affinity.** For each confirmed act, one request scores it against every other act on the bill:

```
GET /v2/insights
  filter.type=urn:entity:artist
  signal.interests.entities={act}
  filter.results.entities={every other act}
```

Qloo’s scores are normalised per request, so Interval ranks each act’s row as percentiles, keeps a row only if it separates at least ten other acts, and weights a pair by the mean of its two directed percentiles. A pair at 0.9 or above is strongly linked. A pair Qloo can’t score is unknown, never zero. These are affinity-based clash warnings, not measured shared fans.

**Repair.** A bounded search moves at most four sets. Every proposal is validated before it is shown: holds, stage overlaps, stage hours and billing bands. Two rules protect acts Qloo can’t identify. The looser rule (the default) stops their total overlap from growing. The strict rule rejects any change that adds overlap to any single pair with an unknown act; on ACL Friday it allows no change at all, and the page offers it with one click. Proposals are calculated on request, never prepared ahead.

**Agent.** The Comms panel takes plain requests such as “Keep both headliners where they are.” A model (gpt-5.6-luna, through a self-hosted Hermes gateway) answers with strict JSON tool calls: find clashes, add or change constraints such as holds and availability, propose repairs, explain a change. The server runs the tools and writes every name and number from their results; the model can’t add a claim of its own. It never applies a change or relaxes a hold silently: when a request can’t be met, it asks. Recorded answers replay with the date they were recorded.

**Proof.** The comparison table was prepared before the demo: three independent LLM-only repairs per day, given the act names, set times and the same rules but no Qloo scores, and a genre-only repair using genre labels gathered before any Qloo data. All are measured with the same Qloo-weighted clash minutes. On ACL Friday, only Interval under the looser rule lowers them (14 to 0). On III Points, the looser rule takes Friday from 137 to 100 and Saturday from 168 to 98.

## Honest limits

- The seeds are published timetables, so they are retrospective scenarios with inferred holds, loosened to billing bands and labelled as such. Nothing here claims an organiser made a mistake.
- Qloo identifies 18 of 31 ACL Friday acts and fewer of the III Points undercard. Unknown pairs stay unknown.
- Changeovers, artist availability and production needs aren’t in a published timetable; an imported draft enforces what its CSV states.

## Who pays

The promoter, per festival edition: a planning tool for the programming team in the weeks before set times are announced. That is a hypothesis, so no price is set until a programmer has reacted to real warnings on their own draft.

## Run it locally

Node 22.13 or later. The API uses only Node built-ins.

```bash
npm install
npm run dev:all
```

Then open http://127.0.0.1:4190. The API needs a Qloo hackathon key in `~/.config/interval/qloo.env` (`QLOO_BASE_URL=https://hackathon.api.qloo.com` and `QLOO_API_KEY=…`). Qloo responses are cached in `cache/`, which is never committed; set `QLOO_OFFLINE=1` to serve only cached evidence. The agent needs `HERMES_URL`; without it, the panel says live answers are unavailable. `server/README.md` documents the API, budgets and guard rules, and `deploy/` holds the container setup for the hosted demo.

CSV import columns: `day, stage, act, start, end`, with optional `hold` (day, stage, start or exact), `band` (opener, middle, sub-headline or headline) and `tier` (1–100). Up to 150 sets and 60 acts.

## Data and credits

- `seeds/` holds two public timetables, each verified against its official source on Oct 12, 2026; see `seeds/README.md`. No Qloo response data is committed.
- Stage footage: “Colored spotlights in a stage” from Mixkit, under the Mixkit Stock Video Free License. Re-encoded to a 960px loop in `public/media/`.
- The shader engine and Blur Reveal are React ports of Inspira UI components (MIT). The background and display headlines run on it.
- Type: Panchang and General Sans from Fontshare (ITF Free Font License), Barlow Condensed and JetBrains Mono from Google Fonts (SIL Open Font License).
- Animated tabs, AI task list and rolling number come from SmoothUI (MIT). Icons are Phosphor.

## Licence

MIT for the code; see `LICENSE`. The stage footage in `public/media/` stays under the Mixkit Stock Video Free License.
