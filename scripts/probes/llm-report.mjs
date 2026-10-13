import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { db, callCount } from '../../server/qloo.mjs';
const root = '/home/timidan/Documents/hackathon-research/qloo-2026-10-30';
const comparison = JSON.parse(readFileSync('cache/baselines/comparison.json'));
const manifest = JSON.parse(readFileSync('cache/baselines/manifest.json'));
const num = n => n == null ? '—' : Number(n.toFixed(3));
const passed = errors => errors.length ? 'FAIL' : 'PASS';
const calls = db.prepare('SELECT count(*) n FROM llm_calls WHERE budget=?').get('interval-hermes-2026-10-13').n;
const lines = [
  '## Hermes agent and retrospective baseline follow-up', '',
  `Recorded ${new Date().toISOString().slice(0, 10)}. Hermes: gpt-5.6-luna, medium effort. ${calls} completion starts; 0 new Qloo calls; Qloo ledger remains ${callCount()}.`, '',
  'This is a retrospective follow-up after the original coverage and affinity findings, not the preregistered experiment. Nine independent LLM schedules used only names, original timetables, identical constraints and existing independently supplied genre metadata; no Qloo scores, warnings, ranks or repair examples entered their prompts. Each received at most one logistical correction. All outputs were frozen before evaluation. Temperature and model seeds are not exposed by Hermes. The primary comparison uses four moves, zero walking buffer, lambda zero, search seed 20261013 and 15,000 candidate evaluations. The three trials per day are independent single-turn calls.', '',
  'Logistics excludes the unknown-affinity safeguards. Pair and net validity include logistics. Any otherwise valid LLM schedule rejected by an unknown guard makes that guard comparison inconclusive; invalid schedules are retained below. An invalid schedule is not evidence of better audience outcomes. Use the best valid LLM trial for a descriptive cost comparison, never its mean or worst trial. No programmer acceptance or audience benefit has been demonstrated.', '',
  '| Day | Schedule | Logistics | Pair guard | Net guard | Moved | Shifted minutes | Strong clashes | Qloo-weighted minutes | Unknown pairs / minutes | Moved acts |',
  '|---|---|---|---|---|---:|---:|---:|---:|---|---|',
];
for (const r of comparison.rows) lines.push(`| ${r.seedId} | ${r.label} | ${r.metrics ? passed(r.logisticalErrors) : 'Unavailable'} | ${r.metrics ? passed(r.pairErrors) : '—'} | ${r.metrics ? passed(r.netErrors) : '—'} | ${r.moved ?? '—'} | ${r.minutesShifted ?? '—'} | ${r.metrics?.strongClashes ?? '—'} | ${num(r.metrics?.cost)} | ${r.metrics ? `${r.metrics.unknownClashes} / ${r.metrics.unknownMinutes}` : '—'} | ${r.acts.join(', ') || '—'} |`);
lines.push('', 'ACL genre rows are coverage-matched retrospective diagnostics using the original pre-Qloo labels and the same solver, seeds, budget and constraints as Interval. III Points has no supplied independent frozen genre labels, so its genre comparison remains unavailable; Qloo genre tags were not substituted.', '');
for (const seedId of ['acl-friday', 'iii-friday', 'iii-saturday']) for (const guard of ['pair', 'net']) {
  const trials = comparison.rows.filter(r => r.seedId === seedId && r.kind === 'llm_only');
  const valid = trials.filter(r => r.metrics && !r[`${guard}Errors`].length).sort((a, b) => a.metrics.cost - b.metrics.cost);
  const guardFailure = trials.some(r => !r.logisticalErrors.length && r[`${guard}Errors`].length);
  const best = valid[0];
  lines.push(`${seedId}, ${guard}: ${guardFailure ? 'inconclusive because an otherwise valid LLM trial fails the unknown guard' : best ? `best valid LLM is ${best.label}, ${num(best.metrics.cost)} weighted minutes` : 'no valid LLM trial; no audience-quality comparison'}.${guardFailure && best ? ` Best surviving trial for reference only: ${best.label}, ${num(best.metrics.cost)}.` : ''}`);
}
lines.push('', 'Verified guard checks: Paris Paloma moves from 15:15 to 15:30 on Miller Lite, removing its clash with CMAT; ACL unknown overlap stays at 1,515 minutes. III Saturday moves REBOLLEDO, WHITESQUARE, ROMAN FLÜGEL and INTERPLANETARY CRIMINAL on S3QUENC3; cost falls from 167.965 to 97.849 with unknown overlap unchanged at 45,555 minutes. The guard-free III Friday result increases unknown overlap from 47,045 to 47,120 minutes; net-guarded search instead moves MEN I TRUST and MIND ENTERPRISES to reach 100.291 weighted minutes with 47,040 unknown minutes. Pair mode remains the default; neither policy is accepted by the programmer.', '', 'Live programming requests:', '', '| Day | Request | Terminal state | Model calls | Repair searches |', '|---|---|---|---:|---:|');
for (const name of readdirSync('cache/agent-demos').filter(n => /^(acl-friday|iii-saturday)-[123]\.json$/.test(n)).sort()) {
  const run = JSON.parse(readFileSync(`cache/agent-demos/${name}`)), turn = run.agent.turns.at(-1);
  lines.push(`| ${run.origin} | ${turn.message} | ${turn.status} | ${turn.modelCalls} | ${turn.repairSearches} |`);
}
lines.push('', 'The completed baseline set used 9 successful completions plus 1 lost completion at the 180-second timeout, with no correction calls. The remaining 50 calls covered live agent verification, initial incomplete attempts and confirmed-draw continuation fixtures. Hermes returned no 429. Interval reached its hard 60-call work limit and made no further model calls.', '', 'The isolated confirmed-major-draw continuation for ACL changed the preference to concurrent and ran a repair search; it found no improving proposal. The III Saturday continuation changed the objective but reached the local work limit before a repair search, so that extended verification remains incomplete. These flags were simulated test input, not a programmer endorsement.', '', 'Recorded answers and raw LLM schedules remain private under cache and SQLite; replays carry their actual recording date. Initial invalid or incomplete model attempts are retained separately. Saturday availability on ACL Friday requires a programme containing Saturday; crowd-spreading requests require coordinator-confirmed major draws. No agent turn applies a proposal or silently relaxes a hold.', '');
let report = readFileSync(`${root}/PROBES.md`, 'utf8');
const marker = '## Hermes agent and retrospective baseline follow-up';
if (report.includes(marker)) report = report.slice(0, report.indexOf(marker)).trimEnd();
report = report.replace('the requested ACL repair story has not been demonstrated. No LLM comparison or programmer review exists.', 'the original pair-guarded ACL repair story was not demonstrated. The retrospective Hermes/net-guard follow-up is below; programmer review remains pending.');
writeFileSync(`${root}/PROBES.md`, report.trimEnd() + '\n\n' + lines.join('\n'));
console.log(`Summary written; manifest frozen ${manifest.frozenAt}; no raw payloads in report`);
