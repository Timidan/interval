import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { complete, health, modelCallCount } from '../server/llm.mjs';
import { hash, callCount } from '../server/qloo.mjs';
import { newRun } from '../server/runs.mjs';
import { solve, validate, metrics, minute, same, unknownChanges } from '../server/schedule.mjs';
import { weightsFromRows } from '../server/matrix.mjs';

const dir = 'cache/baselines'; mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = name => `${dir}/${name}.json`;
const read = name => JSON.parse(readFileSync(file(name), 'utf8'));
const write = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
const days = ['acl-friday', 'iii-friday', 'iii-saturday'];
const qlooBefore = callCount(), modelBefore = modelCallCount();
const frozen = JSON.parse(readFileSync('cache/probes/frozen.json'));
const system = `You are programming a festival running order. Propose a schedule that reduces conflicts between acts likely to appeal to similar listeners, using ONLY the artist names, original timetable, supplied musical metadata and constraints below. No external tools or scores are available.
Return strict JSON only: {"changes":[{"setId":"existing-id","day":"YYYY-MM-DD","stage":"existing stage","start":INTEGER}]}.
Unlisted sets retain their original placements. start is local minutes from programme-day midnight (19:00=1140, next-day 01:00=1500). Preserve every act, duration and set. Return at most k changed sets; returning no changes is permitted if no useful legal change can be found. No commentary or other keys.
Hard rules: fixed sets cannot move. Each set stays within its allowed days, same stage tier, allowed stages if supplied, availability and billing envelope. Preserve exact holds. Every stage has open/close times and minimum changeover. Consecutive sets on a stage must preserve band order opener < middle < sub-headline < headline (excluded fixed occupancy does not have a band). Repeated sets of the same act cannot overlap. Do not increase k. The primary objective is fewer listener-affinity clashes, with fewer moves and fewer shifted minutes as tie breaks; concurrent-major-draw preference is off. You have at most one correction based only on logistical validation.`;
function inputs(run) {
  const s = run.schedule, local = (n, day) => n - minute(`${day}T00:00`);
  return { k: s.k, walkingBuffer: s.buffer, objective: 'affinity', timezone: run.timezone,
    stages: s.stages.map(t => ({ ...t, open: local(t.open, t.day), close: local(t.close, t.day) })),
    sets: s.slots.map(t => ({ setId: t.id, act: t.act, day: t.day, stage: t.stage, start: local(t.start, t.day), duration: t.duration,
      tier: t.tier, band: t.band, fixed: !!(t.locked || t.unresolved), excluded: !!t.excluded, allowedDays: t.allowedDays || [t.day], allowedStages: t.allowedStages,
      earliest: local(t.earliest, t.day), latestEnd: local(t.latestEnd, t.day), holds: t.holds || [],
      musicMetadata: { genres: frozen.genres[t.act] || [] } })) };
}
function decode(text, schedule) {
  let result;
  try {
    result = JSON.parse(text);
    if (!result || Object.keys(result).join() !== 'changes' || !Array.isArray(result.changes) || result.changes.length > schedule.k) throw 0;
    const seen = new Set();
    for (const c of result.changes) {
      if (!c || Object.keys(c).sort().join() !== 'day,setId,stage,start' || !schedule.slots.some(s => s.id === c.setId) || seen.has(c.setId) || !Number.isInteger(c.start) || typeof c.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.day) || typeof c.stage !== 'string') throw 0;
      seen.add(c.setId);
    }
  } catch { return { slots: null, errors: ['Invalid JSON changes schema, set ID, duplicate set or move count'] }; }
  const slots = schedule.slots.map(s => { const c = result.changes.find(c => c.setId === s.id); return c ? { ...s, day: c.day, stage: c.stage, start: minute(`${c.day}T00:00`) + c.start } : s; });
  return { slots, errors: validate(schedule, slots, {}, { unknown: false }) };
}
if (!existsSync(file('manifest'))) {
  const runs = days.map(seedId => newRun({ seedId }, 'baseline-preparation'));
  const manifest = { frozenAt: new Date().toISOString(), design: 'Retrospective follow-up after Qloo coverage and original probe outcomes were known; not the preregistered experiment',
    system, days: runs.map(r => ({ seedId: r.origin, input: inputs(r), schedule: r.schedule, snapshotId: r.snapshot?.id })),
    model: 'gpt-5.6-luna', effort: 'medium', temperature: 'not exposed by Hermes', modelSeed: 'not exposed by Hermes; three independent single-turn completions',
    independentTrials: 3, maximumCorrections: 1, feedback: 'Identical deterministic validator, logistical errors only; unknown-edge safeguards evaluated after all outputs freeze',
    metadataSource: 'Existing pre-Qloo frozen independent genre labels; empty when not supplied; no Qloo-derived metadata',
    scoring: 'Same saved snapshot per day; reciprocal percentile weights >= 0.90 times buffered overlap; unknown weights never zero',
    acceptance: 'Logistical validity separate from pair/net unknown guards; any unknown-guard failure makes that comparison inconclusive; best valid LLM is headline comparator; no operator acceptance inferred',
    solverSeed: 20261013, evaluations: 15000, k: 4, buffer: 0, lambda: 0 };
  manifest.protocolHash = hash(manifest); write('manifest', manifest);
}
const manifest = read('manifest');
if (!process.argv.includes('--evaluate-only')) {
  const available = await health();
  if (available.status !== 'available') throw new Error(`Hermes ${available.status}; retry_at=${available.retry_at}`);
  for (const day of manifest.days) for (let trial = 1; trial <= 3; trial++) {
    const name = `${day.seedId}-${trial}`;
    if (existsSync(file(name))) { console.log(`${name}: frozen, skipped`); continue; }
    const attempts = [];
    // Completed attempt files make interruption resumable without reissuing a successful call.
    for (let attempt = 0; attempt < 2; attempt++) {
      const attemptName = `${name}-attempt-${attempt + 1}`;
      const user = JSON.stringify({ input: day.input, ...(attempt ? { previousOutput: attempts[0].completion.text, validationErrors: attempts[0].validation.errors, instruction: 'Correct only logistical errors. No affinity feedback is supplied.' } : {}) });
      let entry;
      if (existsSync(file(attemptName))) entry = read(attemptName);
      else {
        const completion = await complete({ system: manifest.system, user, visitor: `baseline-${day.seedId}-${trial}` });
        entry = { completion, prompt: { system: manifest.system, user }, validation: decode(completion.text, day.schedule) };
        write(attemptName, entry);
      }
      attempts.push(entry);
      if (!entry.validation.errors.length) break;
    }
    write(name, { seedId: day.seedId, trial, protocolHash: manifest.protocolHash, frozenAt: new Date().toISOString(), attempts,
      slots: attempts.at(-1).validation.slots, logisticalErrors: attempts.at(-1).validation.errors });
    console.log(`${name}: frozen; ${attempts.length} model calls; ${attempts.at(-1).validation.errors.length ? 'logistically invalid' : 'logistical constraints pass'}`);
  }
}
// Do not reveal scores until every independent output has been frozen.
for (const day of days) for (let trial = 1; trial <= 3; trial++) if (!existsSync(file(`${day}-${trial}`))) throw new Error('All nine outputs must freeze before evaluation');
if (!existsSync(file('comparison'))) {
  const rows = [];
  for (const day of manifest.days) {
    const run = newRun({ seedId: day.seedId }, 'baseline-evaluation');
    if (run.snapshot?.id !== day.snapshotId) throw new Error('Snapshot changed since the baseline freeze');
    run.schedule = day.schedule; run.current = day.schedule.slots;
    const evaluate = (label, kind, slots, extra = {}) => {
      const moved = slots?.filter((s, i) => !same(s, day.schedule.slots[i]));
      return { seedId: day.seedId, label, kind, moved: moved?.length ?? null, acts: moved?.map(s => s.act) || [],
        minutesShifted: slots?.reduce((n, s, i) => n + Math.abs(s.start - day.schedule.slots[i].start), 0) ?? null,
        metrics: slots ? metrics(slots, run.snapshot.weights, day.schedule.buffer) : null,
        logisticalErrors: slots ? validate(day.schedule, slots, {}, { unknown: false }) : ['Invalid JSON schedule'],
        pairErrors: slots ? validate(day.schedule, slots, run.snapshot.weights, { unknownGuard: 'pair' }) : ['Invalid JSON schedule'],
        netErrors: slots ? validate(day.schedule, slots, run.snapshot.weights, { unknownGuard: 'net' }) : ['Invalid JSON schedule'],
        unknownChanges: slots ? unknownChanges(day.schedule.slots, slots, run.snapshot.weights, day.schedule.buffer) : [], slots, ...extra };
    };
    rows.push(evaluate('Original', 'original', day.schedule.slots));
    for (let trial = 1; trial <= 3; trial++) { const result = read(`${day.seedId}-${trial}`); rows.push(evaluate(`LLM ${trial}`, 'llm_only', result.slots)); }
    for (const unknownGuard of ['pair', 'net']) {
      const result = solve(day.schedule, run.snapshot.weights, { unknownGuard, seed: manifest.solverSeed, budget: manifest.evaluations });
      rows.push(evaluate(`Interval ${unknownGuard}`, 'interval', result.repairs[0]?.slots || day.schedule.slots, { unknownGuard, evaluated: result.evaluated }));
      if (day.seedId === 'acl-friday') {
        const genre = JSON.parse(readFileSync('cache/probes/genre-baseline.json'));
        const result = solve(day.schedule, weightsFromRows(genre.rows).weights, { guardWeights: run.snapshot.weights, unknownGuard, seed: manifest.solverSeed, budget: manifest.evaluations });
        rows.push(evaluate(`Genre ${unknownGuard}`, 'genre_only', result.repairs[0]?.slots || day.schedule.slots, { unknownGuard, evaluated: result.evaluated, diagnostic: 'Coverage-matched retrospective diagnostic using original pre-Qloo genre labels' }));
      }
    }
    if (day.seedId !== 'acl-friday') rows.push(evaluate('Genre unavailable', 'genre_only', null, { reason: 'No frozen independent genre labels supplied for this lineup', available: false, logisticalErrors: [], pairErrors: [], netErrors: [] }));
  }
  write('comparison', { frozenAt: new Date().toISOString(), protocolHash: manifest.protocolHash, rows });
}
const comparison = read('comparison');
for (const r of comparison.rows) console.log(JSON.stringify({ day: r.seedId, label: r.label, hard: r.logisticalErrors, pair: r.pairErrors, net: r.netErrors, moved: r.moved, shifted: r.minutesShifted, metrics: r.metrics, acts: r.acts }));
if (callCount() !== qlooBefore) throw new Error('Qloo ledger changed during the comparison');
console.log(JSON.stringify({ newModelCalls: modelCallCount() - modelBefore, newQlooCalls: callCount() - qlooBefore }));
