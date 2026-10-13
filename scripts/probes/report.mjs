import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { callCount, db, entities } from '../../server/qloo.mjs';
import { solve, metrics, validate } from '../../server/schedule.mjs';
import { weightsFromRows } from '../../server/matrix.mjs';
const read = name => JSON.parse(readFileSync(`cache/probes/${name}.json`));
const a = read('analysis'), zero = read('probe0'), frozen = read('frozen'), narrow = read('narrow-manifest');
const pct = (n, d) => `${n}/${d} (${(100 * n / d).toFixed(2)}%)`;
const passes = list => list.filter(t => t.result === 'pass').length;
const narrowedReturned = narrow.confirmed.reduce((n, _, i) => n + entities(read(`narrow-${i}`)).length, 0);
const schedule = structuredClone(frozen.seeds[0]), selection = read('row-selection'), snapshot = read('acl-snapshot');
for (const s of schedule.slots) if (!selection.confirmed.some(r => r.act === s.act)) s.unresolved = true;
const genreWeights = weightsFromRows(read('genre-baseline').rows).weights;
const adjusted = solve(schedule, genreWeights, { guardWeights: snapshot.weights });
const adjustedSlots = adjusted.repairs[0]?.slots ?? schedule.slots;
const adjustedMetrics = metrics(adjustedSlots, snapshot.weights);
const cityReturned = a.city.reduce((n, r) => n + r.returned, 0), cityRequested = a.city.reduce((n, r) => n + r.requested, 0);
const ledger = db.prepare('SELECT * FROM quota_ledger WHERE session=? ORDER BY started,id').all('interval-g2-2026-10-13');
const spacings = ledger.slice(1).map((r, i) => r.started - ledger[i].started);
const lines = [
  '# Interval G2 probes — 2026-10-13', '',
  '**Decision: full-seed G2 FAIL / product usefulness unresolved. No BRIEF §9 kill condition is conclusively established.** The full lineups miss identity coverage, but a smaller 17-act ACL scope returns every directed pair with stable discrimination. The build can support partial advisory evidence; the requested ACL repair story has not been demonstrated. No LLM comparison or programmer review exists. City conditioning is disabled.', '',
  '| Probe / exact criterion | Observed | Verdict |', '|---|---|---|',
  ...zero.map(z => `| 0 — legal moves under day/headliner/tier/band holds, ${z.seed} | ${z.legalMoves} legal structural neighbours; synthetic weighted-cost reductions ${z.patterns.map(p => `${(100 * (p.before.cost - p.after.cost) / p.before.cost).toFixed(2)}%`).join(', ')} | PASS for encoded scheduling discretion only |`),
  `| 1 — GET, no unexpected IDs/duplicates | HTTP ${a.transport.status}; ${a.transport.unexpected} unexpected; ${a.transport.duplicates} duplicate | PASS |`,
  `| 1 — at least 48/50 finite affinities | Only 17 confirmed candidates available for Skrillex; ${pct(a.transport.returned, a.transport.candidates)} returned; Leon Thomas omitted | Original 50-candidate threshold NOT TESTED; smaller-pool completeness FAIL |`,
  '| 1 — repeated/subset/singleton difference ≤0.0001 | Maximum difference 0 across every returned common candidate | PASS |',
  '| 1 — POST matches GET identities and scores | HTTP 200; 16 identities match; maximum difference 0 | PASS |',
  '| 1 — take=51 | HTTP 400 | Unsupported; not a kill |',
  '| 1 — pages 1–2 reconstruct full result | 16 + 0 results, no duplicates or omissions relative to GET | PASS for this pool; real multi-page transport untested |',
  ...a.identity.flatMap(i => [`| 2 — ≥85% identities, ${i.seed} | First query ${pct(i.firstQuery, i.total)}; after review/retry ${pct(i.confirmed, i.total)} | FAIL |`, `| 2 — ≥85% bottom billing half, ${i.seed} | ${pct(i.bottomConfirmed, i.bottomTotal)} | FAIL |`]),
  `| 3 — ≥95% requested directed pairs | ${pct(a.matrix.returned, a.matrix.requested)} | FAIL on full confirmed ACL scope |`,
  `| 3 — ≥80% rows with ≥10 distinct values and P90–P10 >0.0001 and >5×noise | ${pct(a.matrix.usableRows, a.matrix.totalRows)}; noise ${a.matrix.noise}; usable spreads ${Math.min(...a.matrix.rowStats.filter(r => r.usable).map(r => r.spread)).toFixed(8)}–${Math.max(...a.matrix.rowStats.map(r => r.spread)).toFixed(8)} | PASS |`,
  '| 3 — ten repeated rows rank-correlation ≥0.99, ties preserved | 10/10 at 1.000000; no changed returned identities | PASS |',
  `| 3 — ≥15/20 original frozen genre triplets | ${passes(a.matrix.originalTriplets)}/20 pass; ${a.matrix.originalTriplets.filter(t => t.result === 'unknown').length}/20 unavailable | FAIL |`,
  `| Smaller-scope follow-up — same thresholds, 17 scoreable acts | ${pct(narrowedReturned, 17 * 16)} directed pairs; 17/17 discriminating rows; 16/20 supplementary pre-score triplets pass (4 unavailable) | PASS for narrowed scoring scope; not a full-seed pass |`,
  `| 4 — ≥2 strong clashes removed, no broken holds | Original ${a.baseline.original.strongClashes} clash, ${a.baseline.original.cost.toFixed(3)} weighted minutes; Interval ${a.baseline.interval.strongClashes}, ${a.baseline.interval.cost.toFixed(3)}; 0 moved sets | FAIL to remove two; holds PASS |`,
  '| 4 — ≥20% better than best valid LLM on both festivals | No LLM API key; III Points comparative experiment not run | PENDING |',
  '| 4/6 — ≥4/5 plausible warnings and one worthwhile repair | No programmer contacted | PENDING |',
  `| 5 — intended Austin locality | ${a.city.filter(r => r.correct).length}/10 resolve Austin, Texas | PASS |`,
  `| 5 — ≥90% city candidate coverage | ${pct(cityReturned, cityRequested)} | FAIL; local layer disabled |`,
  '| 5 — five city repeats rank-correlation ≥0.99 | 5/5 at 1.000000 | PASS |',
  `| 5 — ≥2 top-ten replacements in ≥5/10 rows (common candidates only) | ${a.city.filter(r => r.topTenReplacements >= 2).length}/10 rows | FAIL |`, '',
  '## Scope and frozen assumptions', '',
  'ACL: 32 scored sets by 31 distinct acts; Silent Disco retained only as fixed stage occupancy; kids stage excluded. III Points Friday: 112 sets, 72 non-b2b acts; Saturday: 119 sets, 83 non-b2b acts. No b2b identities were merged. Probe 0 uses synthetic weights only and tests structural discretion before identity failures; its numbers are not Qloo results or product improvements. B2b sets remain fixed, but Probe 0 deliberately does not assert unknown-edge safety for its synthetic pattern experiment.', '',
  'Before any affinity request: froze the seeds, scheduling domains, 20 ACL triplets, prior-knowledge genre labels, Jaccard-to-percentile rule, zero walking buffer, k=4, search seed 20261013, and 15,000-evaluation budget. The genre baseline was also calculated and frozen before scores. The 20 supplementary triplets were frozen after observing identity coverage but before seeing scores. The 17-act follow-up removes only the unscoreable Leon Thomas after the original failed matrix, so it is explicitly a changed scope.', '',
  'Stage tiers and bands are inferred scenario constraints, not verified contracts: T-Mobile/American Express tier 1; Miller Lite/Snapchat/Tito’s tier 2; BMI/Beatbox tier 3; Bonus Tracks tier 4. III Points: Mind Melt/Sector 3 tier 1; Isotropic/RC95 tier 2; 444/S3QUENC3 tier 3; other stages tier 4. Main-stage closing sets are locked; stage minimum published changeover gaps and observed windows are preserved. Bands preserve relative order and the original same-tier/band time envelope. Bottom billing half is the earliest ceil(n/2) distinct acts by normalised within-stage billing position, then start and name; repeated acts use their highest position.', '',
  '## Identity review', '',
  'Confirmed means a curated inspection of the intended musician’s description, genre and music identifiers, not the first name match. This is not a completed human review. Leon Thomas uses Leon Thomas III, not the deceased jazz singer; it resolves but returns no affinities in either direction. Jesse Welles resolves only after the Welles alias retry; the shared artist identity is corroborated by [his official site](https://www.wellesmusic.com/), although the old project may describe an earlier audience. Solomon Hicks and The 4411 cleaned-name retries did not resolve the intended musicians.', '',
  '| Human review required | Status |', '|---|---|',
  ...read('identity-review').filter(r => r.status === 'ambiguous').map(r => `| ${r.act} | Unconfirmed; conflicting or insufficient identifying metadata; fixed |`), '',
  ...a.identity.map(i => `**${i.seed} unresolved or awaiting review:** ${i.unresolved.join(', ')}.`), '',
  'The Wednesday filter controls returned only the requested artist/TV types when supplied. This tests the plural types parameter; it does not certify identity correctness.', '',
  '## ACL row coverage and omissions', '',
  '| Source act | Returned / requested | Distinct | P90–P10 | Omitted |', '|---|---:|---:|---:|---|',
  ...a.matrix.rowStats.map(r => `| ${r.act} | ${r.returned}/${r.requested} | ${r.distinct} | ${r.spread.toFixed(8)} | ${r.omitted.join(', ')} |`), '',
  `Reciprocal observations were retained separately: ${a.matrix.reciprocal.pairs} observed reciprocal pairs, mean absolute direction difference ${a.matrix.reciprocal.meanDifference.toExponential(5)}, maximum ${a.matrix.reciprocal.maxDifference.toExponential(5)}. Symmetric weights are Interval’s rule, not an API assumption.`, '',
  '## Frozen triplets', '',
  '| Source | Same-genre candidate | Cross-genre control | Result |', '|---|---|---|---|',
  ...a.matrix.originalTriplets.map(t => `| ${t.source} | ${t.same} | ${t.cross} | ${t.result} |`), '',
  'Supplementary smaller-scope triplets (frozen before scores; original failures above are retained):', '',
  '| Source | Same-genre candidate | Cross-genre control | Result |', '|---|---|---|---|',
  ...a.matrix.narrowTriplets.map(t => `| ${t.source} | ${t.same} | ${t.cross} | ${t.result} |`), '',
  '## Repair versus genre comparator', '',
  '| Schedule | Qloo-weighted minutes | Strong clashes | Unknown overlaps | Validity |', '|---|---:|---:|---:|---|',
  `| Original | ${a.baseline.original.cost} | ${a.baseline.original.strongClashes} | ${a.baseline.original.unknownClashes} | PASS |`,
  `| Interval best found | ${a.baseline.interval.cost} | ${a.baseline.interval.strongClashes} | ${a.baseline.interval.unknownClashes} | PASS; no improvement found |`,
  `| Pre-score frozen genre repair | ${a.baseline.genre.cost} | ${a.baseline.genre.strongClashes} | ${a.baseline.genre.unknownClashes} | FAIL: unresolved-set lock; comparison inconclusive |`,
  `| Coverage-matched genre diagnostic | ${adjustedMetrics.cost} | ${adjustedMetrics.strongClashes} | ${adjustedMetrics.unknownClashes} | ${validate(schedule, adjustedSlots, snapshot.weights).length ? 'FAIL' : 'PASS'} |`,
  '| LLM-only 1–3 | Unavailable | Unavailable | Unavailable | Pending key |', '',
  `The frozen genre repair moved ${a.baseline.genreChanges.join(', ')} before identities were known. It cannot be treated as a valid competitive baseline after unresolved identities must stay fixed. The coverage-matched diagnostic reruns the same solver, seed and budget on the frozen genre weights, with exactly the Interval locks and Qloo unknown-edge guard; it uses coverage learned after scoring and is not a preregistered baseline. Neither comparison establishes a Qloo benefit.`, '',
  '## City conditioning', '',
  '| Source | Austin returned / requested | Top-ten replacements | Named-control returned | Austin/control rank correlation | Point-control returned |', '|---|---:|---:|---:|---:|---:|',
  ...a.city.map((r, i) => `| ${r.act} | ${r.returned}/${r.requested} | ${r.topTenReplacements} | ${r.controlReturned} | ${r.controlCorrelation?.toFixed(6) ?? 'Unavailable'} | ${existsSync(`cache/probes/control-point-${i}.json`) ? entities(read(`control-point-${i}`)).length : 'Pending'} |`), '',
  'Austin resolves correctly. Tokyo, Japan resolves to Minato rather than the intended whole city; the named distant-control result is therefore not a validated Tokyo-wide comparison. An explicit central-Tokyo point and 10,000 m radius were tested as the prescribed fallback; counts appear above. Correlations compare Austin with the named control over common returned candidates and show whether rankings differ, independently of omissions. Austin coverage already fails the enablement threshold, so no optional local layer is enabled. Omission is never counted as a ranking improvement.', '',
  '## Call accounting and artifact boundaries', '',
  `Total session Qloo request starts so far: **${callCount()} / 900** (including retries, controls, uncached repeats and saved-snapshot preparation). Initial probes and smaller-scope follow-up: **188**; city point fallback: **${a.city.filter((_, i) => existsSync(`cache/probes/control-point-${i}.json`)).length}**; remaining calls prepare the Saturday identities and two-day III Points matrix. Minimum observed start spacing: **${Math.min(...spacings)} ms**. HTTP 429: **${ledger.filter(r => r.status === 429).length}**. Monthly-zero headers: **${ledger.filter(r => r.remaining === 0).length}**. Every start is counted in the private SQLite ledger; stdout logs count, method and endpoint only.`, '',
  'Private artifacts: cache/qloo.sqlite and cache/probes/*.json. Raw responses, identity evidence, directed scores, ranks, matrices and repairs stay there. This report contains summary numbers and act names, not raw payloads. Inputs in the research folder and all seed CSVs were left unchanged. No messages, deployment, or git state changes were performed.', '',
];
writeFileSync('/home/timidan/Documents/hackathon-research/qloo-2026-10-30/PROBES.md', lines.join('\n'));
console.log(`PROBES.md written; ${callCount()} Qloo calls`);
