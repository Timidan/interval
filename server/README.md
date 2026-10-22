# Interval API and probe handoff

Node 22.23+; no new runtime dependencies.

```sh
npm run server       # 127.0.0.1:4191
npm run dev:all      # API + Vite on 4190
npm run test:server  # six tests: solver, grounding, local allowance and scoring gate
```

The Vite owner must add a proxy: `/api` → `http://127.0.0.1:4191`.
Use `api` from `src/lib/api.ts`; all request/response types live in `shared/api.ts`.
No UI files or Vite configuration were changed by this implementation.

## Hermes and live/recorded answers

All model calls go through the shared Hermes service; there is no direct provider
client. Node 22 fetch is sufficient. Development with the existing localhost SSH
tunnel:

```sh
HERMES_URL=http://127.0.0.1:18080 QLOO_OFFLINE=1 npm run server
# For an isolated verification server alongside the UI owner's server:
PORT=4192 HERMES_URL=http://127.0.0.1:18080 QLOO_OFFLINE=1 npm run server
```

`HERMES_URL` is required outside `NODE_ENV=development`; development alone may
use the tunnel address as its default. Missing configuration means unavailable.
Never publish the unauthenticated Hermes port or put its URL in browser code.
The API binds to `HOST`, defaulting to `127.0.0.1`, including with `PORT` set.
Set `HOST=0.0.0.0` for container binding. Same-host POST origins accept both HTTP
and HTTPS. The tunnel must
already exist; this code does not alter the VPS or network configuration.

`GET /api/agent` first checks Interval’s work budget, UTC daily allowance and
per-visitor allowance (using the session cookie). Exhaustion returns `limited`
with a plain reason before contacting Hermes; daily/visitor limits include the
next UTC midnight as `retry_at`, while the work budget has no automatic retry.
Otherwise it reads Hermes `/healthz` without spending a model call and returns
only status, model, effort and `retry_at` (Unix seconds), plus a safe reason when
available. Hermes requests are single turn `{system,user}` with a 180-second
timeout. An atomic private SQLite lease permits only one Interval completion at
a time across this API and local scripts. Concurrent work gets an unavailable
response rather than issuing a second completion. A transport failure retains
the lease for its remaining four-minute lifetime; there is no transport retry.
429 persists a shared limited state until `retry_at`; an absent retry time stays
limited. Other errors become unavailable and do not expose upstream bodies.

`llm_calls` in `cache/qloo.sqlite` records each actual request start separately
from Qloo, including prompt hash, model, effort, recorded time and response text.
Failures and correction calls count. Defaults: 18 calls per visitor/day, 60 per
UTC day, and a work-budget cap set by `HERMES_BUDGET_CALLS` (default 60).
`LLM_VISITOR_LIMIT` and `LLM_DAILY_LIMIT` retain their defaults of 18 and 60;
`HERMES_BUDGET_ID` identifies a separate authorized work budget. For judging,
set `HERMES_BUDGET_CALLS=300` with a fresh `HERMES_BUDGET_ID`. Both completions
and `GET /api/agent` enforce the same setting. Health reads, tool steps and replays spend no model calls. Work-budget exhaustion
has no automatic retry time; a daily/visitor limit resets at the next UTC day.

## Evidence status

Read the research folder's `PROBES.md` before presenting results. Full-seed
identity gates failed. Saved snapshots are real but partial. The optional `pair`
guard finds no improvement on the three saved days. The default `net` guard
finds improvements on all three, with no increase in total unknown overlap.
The selected policy for new runs is `net`; `pair` remains available on request.

The LLM comparison is a retrospective follow-up: coverage and earlier affinity
results were already known when these prompts were frozen. Baseline prompts
contain no Qloo data, warnings or repair examples. Independent genre metadata
exists for ACL only; a III Points genre comparison is unavailable. The original
pre-score genre experiment remains preserved separately. Programmer review is
still pending; these measurements do not demonstrate audience or revenue gains.
City conditioning remains disabled.

## UI contract

- `GET /api/seeds` lists `acl-friday`, `iii-friday`, `iii-saturday`, `iii-points`.
- `GET /api/comparisons/:seedId` requires no session and reads only the frozen
  `cache/baselines/comparison.json` for `acl-friday`, `iii-friday`, or `iii-saturday`.
  It returns `{seedId, frozenAt, rows}`; each row has label, kind, optional
  unknownGuard/reason/diagnostic, available, moved, acts, minutesShifted, metrics
  (cost, strongClashes, unknownClashes, unknownMinutes) or null, and boolean
  logistics/pairGuard/netGuard pass indicators. Each row also has
  `changes: {act, setId, before: {day, stage, start, duration}, after: {day, stage, start, duration}}[]`,
  containing only moved sets compared by set ID with that seed's frozen original
  row. Unchanged and unavailable rows return `changes: []`. Label these changes
  as prepared. Unavailable rows have false pass indicators; moved/minutesShifted
  may be null. No full slot lists, raw model text or Qloo
  payloads are exposed. Unsupported seeds or missing prepared data return 404
  with a plain reason. Nothing is regenerated. Use `api.comparison(seedId)`.
- `POST /api/runs` accepts `{seedId, unknownGuard?}` or `{csv, timezone, unknownGuard?}` and establishes an
  HttpOnly session cookie. Every later operation must retain the same cookie.
- `GET /api/runs/:id` returns the working timetable, original anchor and holds,
  identity candidates, coverage, snapshot provenance, warnings and proposals.
  `metrics: null` means unavailable. An unknown weight is `null`, never zero.
  Identity-gate denominators exclude b2b sets; run pair coverage includes their
  unknown pairs. Two sets by the same act are separate scheduling units.
- `/identities` supports `resolve`, `confirm`, `unresolve`. A confirmation uses
  a server-issued `candidateRef`. Resolution never confirms by name alone.
  POST `{operation:'resolve', mode:'estimate', expectedVersion}` first to obtain
  `{estimatedCalls, maximumCalls, live}`: uncached search requests and their three-start
  retry reservation. This makes no Qloo call, reserves nothing, and changes no
  state or version. `live` is false when `QLOO_OFFLINE=1`; the counts still
  describe missing requests, not permission to fetch them. In live mode, resolve
  with `maxNewCalls: maximumCalls` after approval. Offline, use `maxNewCalls: 0`:
  resolve looks up all saved searches without reserving quota and leaves misses
  unresolved with no candidates and `note: 'Not in the saved Qloo data'`.
  Imported identities may include `suggestedRef` (a returned candidate ref) and
  `suggestedFrom` (the seed display name) when the exact act name and candidate
  entity match a confirmed entry in a seed snapshot's `identityReview`. These
  are suggestions only: the person must still save a confirmation.
- `/score` supports `estimate` and `fetch`, global only. `maximumCalls` reserves
  up to two retries in addition to `estimatedCalls`; pass that as `maxNewCalls`
  when the operator chooses to score. Both modes return 409 with
  `Scoring needs at least 11 confirmed acts` when fewer than 11 identities are
  confirmed, before any reservation or Qloo call. Existing snapshots need zero
  calls. Score responses also include `live`, false when `QLOO_OFFLINE=1`,
  including estimates satisfied by an existing snapshot. After a scoring job, the run includes optional `callsUsed`.
- `/actions` supports `constraint`, `repair`, `apply`, `undo`, `baseline`.
  All mutations carry `expectedVersion`; constraints also carry
  `expectedConstraintVersion`. Apply needs a returned `repairId`.
- Repair and live scoring return 202. Poll the run while `searching` or `scoring`.
  Render steps only from actual state. `none_found` is a completed search with no
  suitable proposal. A lost mutation response must be reconciled by GET.
- `/evidence/:ref` resolves a clash or ledger evidence reference into the two
  directed observations, safe request parameters and frozen source rows.
- Apply/undo retain the session's original four-move anchor. A new exact lock
  captures the current placement. Undo can be refused if later constraints
  make the previous placement invalid.

### Agent messages, polling and grounding

`POST /api/runs/:id/messages` accepts:

```json
{"message":"Keep both headliners where they are.","expectedVersion":1}
```

Retain the session cookie and use the latest run version. It returns **202** with
the run, `status: "thinking"` and `agent.turns[]`. Poll `GET /api/runs/:id` while
thinking; concurrent mutations return 409. Constraints may advance the version
during the turn. Never retry a lost mutation response blindly: GET the run first.
The server retains placements throughout the turn; applying a proposed repair
still requires the explicit `/actions` apply operation.

Each turn has `id`, `message`, `mode`, `startedAt`, `completedAt`, `modelCalls`,
`toolCalls`, `repairSearches`, `steps`, `facts`, `segments` and optional `reason`,
`retry_at`, `recordingId`. Terminal turn statuses are `complete`, `question`,
`limited`, `unavailable`, `failed`; during work it is `thinking`. The containing
run returns to `ready` when a turn ends, including failures: inspect the turn's
status to show the agent state. A server interruption marks the run and turn
failed. A limited turn must display its retry time; unavailable must say the
agent is unavailable. Partial constraint changes remain visible for review;
there is no claim that a failed turn completed the request.

Each actual step has an ID, kind (`model` or `tool`), timestamps and status
(`running`, `complete`, `invalid`, `rejected`, `failed`). Model steps expose only
the completion reference, model and effort. Tool steps expose name, validated
arguments, result and fact references. Use these records for progress; do not
animate imaginary tool calls. Raw completion text and transcripts stay private.

The model emits strict JSON tool calls or final `{templateId,factRefs}` segments.
Extra fields, unknown tools and invalid typed values are rejected. There is one
JSON/schema correction attempt; six model calls, twelve tool steps and two repair
searches are hard per-turn limits. Parse failures fail closed. All tools check
run ownership through the route and turn-local reference `r1`; `s1` identifies the
saved snapshot and `m1` the current message. Facts and proposals use short
turn-local references too. Mutating tools check versions.
The agent's Qloo-facing tools reuse saved data only; a missing snapshot or lookup
cannot start new Qloo work. Baseline generation also stays outside this context.

Render `segments[].text`, already filled by the server from tool-issued facts.
Unsupported references/templates are dropped. Question templates contain no
invented artist-pair or numerical claims. Proposal summaries and no-repair
questions are included by the server if omitted by the model (`serverAdded`).
`facts` holds the typed provenance for each segment. Proposals remain in the
normal `repairs` array, including validity, exact changes and unknown-pair deltas.

For a crowd-spreading request, ask the operator to confirm the two major draws.
Send the subsequent message with `majorDrawSetIds: [setId, setId]`; these must be
two distinct acts. Only this coordinator input can set major-draw flags. The
agent can then choose `objective: concurrent`. Fixed lambda values are affinity
0, balanced 0.5, concurrent 1. Both affinity cost and major-draw minutes without
an alternative are reported, so an increase in affinity clashes stays visible.
This is a programming preference, not a crowd-size estimate or safety model.

`GET /api/runs/:id/messages` lists matching owned answers or explicitly prepared
seeded demos as
`{recordings:[{id,message,recordedAt,label}]}`. To replay, POST the same message,
latest `expectedVersion`, and `replayId`. A matching timetable, original anchor,
constraints, evidence snapshot, guard and request are required; mismatch is 409.
Replay returns 200, `mode: recorded`, `recordedAt`, `replayedAt` and the literal
label `Recorded on <timestamp>`. Historical steps are completed historical
records, not live work. Replay does not apply constraints or create applicable
proposals, and does not fall back automatically after a live error. Raw model
texts are never returned by replay. Preserve the label wherever an answer is shown.
Known constraint and proposal templates are re-rendered at replay time from
stored facts/tool results using the same wording as live answers. Stored recording
text remains intact; all six prepared demo replays were checked for the updated
wording without model calls.

### Unknown-overlap guard modes

`unknownGuard: 'pair' | 'net'` is accepted on creation, on a repair action, or as
`{kind:'unknown_guard',value:'net'}` in a typed constraint action. New runs default to
`net`; older saved runs without this field retain the `pair` fallback. The agent cannot change the guard itself.
Validation, solver candidates, proposal validation, apply and undo use the same
selected guard and original session anchor.

- `pair`: no unknown set pair can gain buffered overlap minutes.
- `net`: the sum across unknown set pairs cannot grow; individual pairs may gain
  overlap if other pairs lose at least as much. This is weaker protection.

Every proposal carries `unknownGuard` and `unknownChanges` with set IDs, act
names, before/after minutes and delta for **every** changed unknown pair, including
pairs whose overlap becomes zero. Metrics include `unknownMinutes` as well as
`unknownClashes`. Keep this tradeoff visible alongside the proposed changes.
Repeated sets remain separate scheduling units; excluded occupancy and pairs of
the same act are excluded from unknown totals. Same-act overlap is still invalid.

Times are **local-calendar minutes encoded using UTC arithmetic**, not actual UTC
instants. Format using UTC getters and the supplied programme day/timezone label;
do not shift to the viewer's timezone. `availability.notBefore`/`notAfter` are
minutes from programme-day midnight (19:00 = 1140, next-day 01:00 = 1500).
The combined `iii-points` seed exposes both days for typed availability edits.
Changing a day does not promise that a feasible repair exists. The bounded
feasibility pass currently relocates one affected set at a time; it may miss a
solution that requires multiple simultaneous relocations.

## Search capacity and run expiry

`MAX_SEARCHES` (positive integer, default `3`) caps worker searches running at
once across all runs in this API process, including repair, genre baseline and
agent searches. Further searches wait in a first-in, first-out queue of up to
`MAX_QUEUED_SEARCHES` (positive integer, default `20`); the request is accepted
(202, run status `searching`) and the search starts when a slot frees. When the
queue is full, repair/baseline requests and new live agent turns return 503 with
`Interval is busy with other searches. Nothing changed; try again in a minute.`
before changing run state. A search that waits 45 s without a slot fails the run
with a plain reason and leaves the timetable and constraints unchanged. The 30 s
worker timeout starts when the worker starts, not while it waits. Searches
initiated during an accepted agent turn use the same queue; a failed tool step
retains the existing proposals. Slots remain held until the worker exits,
including after timeout termination.

`POST /api/runs` accepts at most 60 new runs per client IP per clock hour (the
same client IP used for Qloo limits, honouring `TRUST_PROXY`). Further creations
return 429 with the minutes left until the hour resets. The count lives in memory
and resets when the process restarts.

`RUN_TTL_DAYS` (positive number, default `7`) controls run retention by `createdAt`.
Startup and hourly cleanup delete older runs, excluding IDs beginning with `_`
and runs containing agent turns. Each pass logs the number removed. Recorded
answers in their separate table are untouched. Cleanup does not run VACUUM.

## Private storage and quotas

Credentials load only at runtime from the environment or
`~/.config/interval/qloo.env`. Only the hackathon host is accepted.
`cache/qloo.sqlite` holds exact responses, quota ledger and owned runs;
`cache/snapshots/` holds saved private matrices. None belong in public source.
Without these private snapshots, a fresh checkout honestly shows missing evidence.
Copy the cache privately when preparing another local environment; there is no
public fixture with Qloo data.

Requests are serialized with at least 350 ms between starts, at most two retries,
Retry-After handling and a persistent stop on a zero monthly-remaining header.
The session cap is 900 request starts including probes. Anonymous work has a
250-call daily allowance, a 200-call monthly reserve, one uncached scoring job
per session/day and two per IP/day. Estimate reservations are persisted; a crash
can conservatively retain unused reservation until the daily reset.
The server defaults to localhost; `HOST` overrides the bind address.

Set `TRUST_PROXY=1` only behind trusted proxies that supply the forwarding headers
and prevent direct public access to the Node server. With this exact value, the
per-IP scoring allowance uses the first, trimmed address in `X-Forwarded-For`,
falling back to the socket address when absent or empty. Otherwise the header is
ignored and the socket address is used. The proxy chain must preserve the real
client address as the first entry and set `X-Forwarded-Proto` to `https` for HTTPS
requests. When both `TRUST_PROXY=1` and `X-Forwarded-Proto: https` are present,
new `interval_session` cookies include `Secure`; all other cookie attributes stay
unchanged. Plain HTTP development keeps working without `Secure`.

`GET /api/health` returns HTTP 200 with `{ "ok": true }`. It needs no session,
writes nothing to the database, and makes no Qloo or Hermes calls. It is a cheap
container liveness check, not an upstream service availability check.

## Reproducing the probes

Run from the repository root. The scripts preserve private captures and resume
from them; deliberately repeated uncached diagnostics are saved under separate
labels. `prepare` and `genre` must precede every first affinity inspection.

1. `node scripts/probes/prepare.mjs` freezes inputs and runs synthetic Probe 0.
2. `node scripts/probes/identities.mjs` fetches ACL/III Friday identity candidates.
3. `node scripts/probes/review.mjs` performs the three justified alias retries.
4. Curated review decisions belong in `cache/probes/identity-review.json`;
   supplementary preregistered triplets belong in `narrowed-triplets.json`.
   These private reviewed records are required; scripts do not silently approve
   candidates or regenerate decisions from name equality.
5. `node scripts/probes/genre.mjs` freezes the independent genre repair once.
6. `node scripts/probes/score.mjs` runs transport, ACL matrix, repeats and cities.
7. `node scripts/probes/analyze.mjs` calculates gate results and Probe 4.
8. `node scripts/probes/narrow.mjs` records the smaller-scope follow-up.
   `node scripts/probes/city-fallback.mjs` tests the explicit Tokyo point control.
9. `node scripts/probes/saturday.mjs`, then a curated `saturday-review.json`,
   prepare the remaining identities; `node scripts/snapshots.mjs` saves matrices.
10. `node scripts/probes/report.mjs` writes summary-only `PROBES.md` outside the repo.

The original private manifest includes input/source hashes and timestamps.
Runtime solver extensions were added after the initial probe experiment; retain
the original analysis and frozen genre schedule when comparing that experiment.
Do not regenerate those outputs and describe them as the original preregistration.

## Reproducing the Hermes checks and comparison

```sh
# Against the isolated localhost API; saves six owned, unapplied demo runs.
INTERVAL_API=http://127.0.0.1:4192 QLOO_OFFLINE=1 npm run demo:agent
# Sequential single-turn calls; resumes frozen outputs and stops on 429.
HERMES_URL=http://127.0.0.1:18080 QLOO_OFFLINE=1 npm run baseline:llm
# Zero model calls: evaluate only after all nine outputs exist.
QLOO_OFFLINE=1 npm run baseline:llm -- --evaluate-only
```

The baseline manifest freezes original timetable, identical holds (including
fixed unconfirmed acts), independent supplied genres, four-move budget, zero
walking buffer, lambda zero, exact prompts and protocol hash. Temperature and
model random seeds are not exposed by Hermes and are explicitly recorded as
such; the three trials are independent calls, not reproducible seeded samples.
Each receives at most one correction with the same logistical-only validator.
Raw outputs and correction prompts remain under `cache/baselines/`; all nine
final schedules freeze before any Qloo evaluation is performed. Each output,
including invalid ones, is evaluated on the same saved edge set under both
guards. Invalid logistics is separate from unknown-guard failure; guard failures
make that comparison inconclusive. Never select only surviving baselines and
advertise a win. The genre diagnostic uses the same seed and 15,000-candidate
budget as Interval. No operator acceptance has been recorded.

`cache/agent-demos/` contains the public-safe views of the recorded demo runs;
full prompts and raw model replies remain in SQLite. Initial incomplete model
attempts are retained in subfolders and are not described as successful demos.
The scripts and API must share the same repository working directory for SQLite
quota/lease coordination. `QLOO_OFFLINE=1` independently forbids uncached Qloo
requests at the transport layer; a cache hit remains allowed.

### Verification result for this run

60 Hermes request starts: 59 completions and one 180-second timeout; no Hermes
429 and zero new Qloo calls (ledger stayed at 326). Nine baseline schedules were
frozen, all logistically valid; ACL and III Saturday comparisons are inconclusive
under the missing-data fairness rule because some LLM trials fail the unknown
guards. III Friday's three LLM schedules remain unchanged and pass both guards.
The six required programming requests on ACL Friday and III Saturday have saved
answers, ending either in the required clarification or an unapplied proposal.

An additional isolated fixture, `node scripts/agent-draw-check.mjs`, submits
simulated coordinator-confirmed major draws. ACL reached the concurrent objective
and a search with no improving proposal. III Saturday reached the objective but
not a repair before the local 60-call limit; that continuation remains unverified.
Initial schema failures and incomplete workflows are retained privately, not
silently promoted as successful examples. The live model can still fail closed;
recorded demos do not prove that every live request will succeed.

The four tests and TypeScript check pass. No frontend files other than the owned
API helper were edited. Verification used the isolated API on 127.0.0.1:4192;
the pre-existing UI owner's 4191 process was not restarted. Restart that API to
load these files. UI rendering/integration and programmer acceptance remain with
their respective owners; no browser-level agent acceptance is claimed.

### Bounded API follow-up verification

The five server tests pass. Isolated HTTP checks with external fetch disabled
verified all three prepared comparisons, cached/uncached identity estimates with
unchanged run state, work/daily/cookie-based visitor limits, HTTPS origin acceptance,
foreign-origin rejection, `HOST=0.0.0.0`, and all six prepared demo replays.
No frozen data was regenerated and no Qloo or Hermes calls were made. The owned
shared/client API types pass a focused TypeScript check. The full workspace check
reported missing props in concurrently edited `src/pages/sheet-page.tsx`; UI work
remains with its owner. No deployment was performed.

### Prepared changes and scoring gate follow-up

All six server tests pass, including both scoring modes rejecting ten confirmed
acts with no fetches, quota reservations or run mutations. A focused TypeScript
check passes for the shared types and API helper. Direct route checks with
external fetch disabled verified all 22 prepared rows and their 14 moved-set
records against the frozen originals, including empty changes for unchanged and
unavailable rows. Imported-run assumptions were checked against `importSchedule`
and `validate`; seeded-run wording is unchanged. No Qloo or Hermes calls were made.
