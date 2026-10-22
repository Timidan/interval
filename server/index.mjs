import { beginTurn, runTurn, replay, recordings } from './agent.mjs';
import { health } from './llm.mjs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { request, requestRef, cached, callCount, monthlyStopped, db, hash } from './qloo.mjs';
import { candidateList, buildSnapshot, estimate, snapshotSummary, loadSnapshot } from './scoring.mjs';
import { seeds, newRun, loadRun, saveRun, view, pairEvidence, proposal, constraint, syncIdentities, coverage, pruneRuns } from './runs.mjs';
import { validate, metrics, same } from './schedule.mjs';
import { weightsFromRows } from './matrix.mjs';

const busy = new Set(); let liveJob = false;
const fail = (status, reason, extra = {}) => Object.assign(new Error(reason), { status, ...extra });
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
export function clientIp(req) {
  const forwarded = process.env.TRUST_PROXY === '1' ? req.headers['x-forwarded-for']?.split(',')[0].trim() : undefined;
  return forwarded || req.socket.remoteAddress || 'local';
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Use application/json');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 131072) throw fail(413, 'Request exceeds 128 KB'); chunks.push(chunk); }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString()); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw 0; return parsed; }
  catch { throw fail(400, 'Invalid JSON object'); }
}
function checkVersion(run, expected) { if (!Number.isInteger(expected) || expected !== run.version) throw fail(409, 'The running order or constraints changed. Refresh the run before trying again.'); }
function limits() { const row = db.prepare('SELECT data FROM runs WHERE id=?').get('_anonymous_limits'); return row ? JSON.parse(row.data) : { day: '', reserved: 0, sessions: {}, ips: {} }; }
function reserve(run, ip, maximum, requested, scoring) {
  if (!Number.isInteger(requested) || requested < 0 || requested > 900) throw fail(400, 'maxNewCalls must be 0–900');
  if (!maximum) return () => {};
  if (requested < maximum) throw fail(409, 'Live scoring is unavailable within the current budget. No scoring job has started. Saved runs still work.');
  if (liveJob) throw fail(409, 'Another live Qloo job is running; try again after it completes');
  if (monthlyStopped()) throw fail(429, 'Qloo quota exhausted. Saved runs still work; repairs using their snapshots need no new Qloo calls.');
  const remaining = db.prepare('SELECT remaining FROM quota_ledger WHERE remaining IS NOT NULL ORDER BY id DESC LIMIT 1').get()?.remaining;
  db.exec('BEGIN IMMEDIATE');
  try {
    const today = new Date().toISOString().slice(0, 10); let l = limits();
    if (l.day !== today) l = { day: today, reserved: 0, sessions: {}, ips: {} };
    if (callCount() + maximum > 900 || l.reserved + maximum > 250 || (remaining != null && remaining - maximum < 200) || (scoring && ((l.sessions[run.owner] || 0) >= 1 || (l.ips[ip] || 0) >= 2))) throw fail(429, 'Live scoring is unavailable within the current budget. No scoring job has started. Saved runs still work.');
    l.reserved += maximum;
    if (scoring) { l.sessions[run.owner] = (l.sessions[run.owner] || 0) + 1; l.ips[ip] = (l.ips[ip] || 0) + 1; }
    db.prepare('INSERT OR REPLACE INTO runs VALUES(?,?)').run('_anonymous_limits', JSON.stringify(l));
    db.exec('COMMIT'); liveJob = true;
    const started = callCount();
    return () => {
      const current = limits(); current.reserved -= Math.max(0, maximum - (callCount() - started));
      db.prepare('INSERT OR REPLACE INTO runs VALUES(?,?)').run('_anonymous_limits', JSON.stringify(current)); liveJob = false;
    };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const maxSearches = Number(process.env.MAX_SEARCHES || 3), maxQueued = Number(process.env.MAX_QUEUED_SEARCHES || 20);
if (![maxSearches, maxQueued].every(n => Number.isInteger(n) && n >= 1)) throw new Error('MAX_SEARCHES and MAX_QUEUED_SEARCHES must be positive integers');
let activeSearches = 0; const queued = [];
function checkSearchCapacity() {
  if (activeSearches >= maxSearches && queued.length >= maxQueued) throw fail(503, 'Interval is busy with other searches. Nothing changed; try again in a minute.');
}
// A finished search hands its slot straight to the oldest waiting one.
const releaseSearch = () => { const next = queued.shift(); if (next) next(); else activeSearches--; };
function searchSlot() {
  checkSearchCapacity();
  if (activeSearches < maxSearches) { activeSearches++; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const start = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { const i = queued.indexOf(start); if (i >= 0) queued.splice(i, 1); reject(fail(503, 'Interval stayed busy with other searches, so this search didn’t start.')); }, 90000);
    queued.push(start);
  });
}
function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData }); }
    catch (error) { releaseSearch(); reject(error); return; }
    let received = false;
    const timer = setTimeout(() => { void worker.terminate(); reject(fail(504, 'Repair search timed out. No completed repair was returned.')); }, 60000);
    worker.once('message', result => { received = true; clearTimeout(timer); resolve(result); });
    worker.once('error', () => { clearTimeout(timer); reject(fail(500, 'Repair search could not finish')); });
    worker.once('exit', code => { releaseSearch(); clearTimeout(timer); if (code !== 0 || !received) reject(fail(500, 'Repair search could not finish')); });
  });
}
// The solver is deterministic, so identical inputs share one search, including one still running.
// ponytail: in-process memo, oldest entry evicted past 50; persist it if first searches after a restart prove too slow.
const searches = new Map();
function searchWorker(run, weights, options = {}) {
  const workerData = { schedule: run.schedule, weights, options: { startSlots: run.current, ...options } }, key = hash(workerData);
  if (!searches.has(key)) {
    const search = searchSlot().then(() => runWorker(workerData)); // searchSlot throws here, synchronously, when the queue is full
    search.catch(() => searches.delete(key));
    searches.set(key, search);
    if (searches.size > 50) searches.delete(searches.keys().next().value);
  }
  return searches.get(key);
}
// ponytail: fixed hourly window per process, reset on restart; a sliding window if hour-boundary bursts matter.
const runsPerHour = 60; let opened = { hour: -1, ips: new Map() };
function startJob(run, work) {
  busy.add(run.id); saveRun(run);
  Promise.resolve().then(work).catch(error => {
    run.status = 'failed'; run.reason = error.status ? error.message : 'This operation could not finish. Check the run before retrying.'; saveRun(run);
  }).finally(() => busy.delete(run.id));
}
pruneRuns();
setInterval(pruneRuns, 60 * 60 * 1000).unref();

// A process restart cannot resume a worker or an in-flight fetch; preserve evidence and mark the interruption.
for (const row of db.prepare("SELECT id,data FROM runs WHERE id != '_anonymous_limits'").all()) {
  const run = JSON.parse(row.data);
  if (['resolving', 'scoring', 'searching', 'thinking'].includes(run.status)) {
    const turn = run.agent?.turns.at(-1);
    if (turn?.status === 'thinking') { turn.status = 'failed'; turn.reason = 'Agent turn interrupted by server restart; review constraints before retrying'; turn.completedAt = new Date().toISOString(); for (const step of turn.steps) if (step.status === 'running') { step.status = 'failed'; step.completedAt = turn.completedAt; } }
    run.status = 'failed'; run.reason = 'Interval restarted before this finished.'; saveRun(run); }
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4191'), path = url.pathname;
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'POST' && req.headers.origin && !['http://127.0.0.1:4190', 'http://localhost:4190', `http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) throw fail(403, 'Origin not allowed');
    let session = req.headers.cookie?.match(/(?:^|;\s*)interval_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (req.method === 'GET' && path === '/api/agent') return json(res, 200, await health(session ? hash(session) : undefined));
    if (req.method === 'GET' && path.startsWith('/api/comparisons/')) {
      const seedId = path.slice('/api/comparisons/'.length);
      if (!['acl-friday', 'iii-friday', 'iii-saturday'].includes(seedId)) throw fail(404, 'No prepared comparison for this seed.');
      let frozen;
      try { frozen = JSON.parse(readFileSync('cache/baselines/comparison.json', 'utf8')); }
      catch { throw fail(404, 'The prepared comparison is unavailable.'); }
      const seedRows = frozen.rows.filter(r => r.seedId === seedId);
      const originals = new Map((seedRows.find(r => r.kind === 'original')?.slots || []).map(s => [s.id, s]));
      const placement = ({ day, stage, start, duration }) => ({ day, stage, start, duration });
      const rows = seedRows.map(r => {
        const available = r.available !== false && r.metrics != null;
        const changes = available ? (r.slots || []).flatMap(s => {
          const before = originals.get(s.id);
          return before && !same(before, s) ? [{ act: s.act, setId: s.id, before: placement(before), after: placement(s) }] : [];
        }) : [];
        return { label: r.label, kind: r.kind, unknownGuard: r.unknownGuard, available,
          reason: r.reason, diagnostic: r.diagnostic, moved: r.moved, acts: r.acts, minutesShifted: r.minutesShifted, changes,
          metrics: r.metrics == null ? null : { cost: r.metrics.cost, strongClashes: r.metrics.strongClashes,
            unknownClashes: r.metrics.unknownClashes, unknownMinutes: r.metrics.unknownMinutes },
          logistics: available && r.logisticalErrors?.length === 0,
          pairGuard: available && r.pairErrors?.length === 0, netGuard: available && r.netErrors?.length === 0 };
      });
      if (!rows.length) throw fail(404, 'The prepared comparison is unavailable.');
      return json(res, 200, { seedId, frozenAt: frozen.frozenAt, rows });
    }
    if (req.method === 'GET' && path === '/api/seeds') return json(res, 200, seeds.map(s => ({ ...s, snapshot: snapshotSummary(loadSnapshot(s.id)) })));
    if (req.method === 'POST' && path === '/api/runs') {
      const hour = Math.floor(Date.now() / 3600000), ip = hash(clientIp(req));
      if (opened.hour !== hour) opened = { hour, ips: new Map() };
      if ((opened.ips.get(ip) || 0) >= runsPerHour) {
        const wait = 60 - new Date().getUTCMinutes();
        throw fail(429, `This network has opened ${runsPerHour} running orders this hour. Try again in ${wait} minute${wait === 1 ? '' : 's'}; running orders you already have still work.`);
      }
      const input = await body(req);
      if (!session) { session = randomBytes(32).toString('hex'); res.setHeader('Set-Cookie', `interval_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`); }
      let created;
      try { created = newRun(input, hash(session)); } catch (error) { throw fail(400, error.message); }
      opened.ips.set(ip, (opened.ips.get(ip) || 0) + 1);
      return json(res, 201, view(created));
    }
    const match = path.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(identities|score|actions|messages|evidence)(?:\/(pair-[a-f0-9]{24}))?)?$/);
    if (!match || !session) throw fail(404, 'This run is unavailable.');
    const run = loadRun(match[1], hash(session)); if (!run) throw fail(404, 'This run is unavailable.');
    if (req.method === 'GET' && !match[2]) return json(res, 200, view(run));
    if (req.method === 'GET' && match[2] === 'evidence') { const selected = pairEvidence(run, match[3]); if (!selected) throw fail(404, 'This evidence record is unavailable.'); return json(res, 200, selected); }
    if (req.method === 'GET' && match[2] === 'messages') return json(res, 200, { recordings: recordings(run) });
    if (req.method !== 'POST') throw fail(405, 'Method not allowed');
    const input = await body(req); checkVersion(run, input.expectedVersion);
    if (busy.has(run.id)) throw fail(409, 'This run already has an operation in progress');
    if (match[2] === 'messages') {
      if (input.replayId) { replay(run, input.replayId, input.message, input.majorDrawSetIds); return json(res, 200, view(run)); }
      checkSearchCapacity();
      const { turn, key } = beginTurn(run, input);
      startJob(run, () => runTurn(run, turn, key, searchWorker));
      return json(res, 202, view(run));
    }
    const ip = hash(clientIp(req));
    if (match[2] === 'identities') {
      if (input.operation === 'resolve') {
        const pending = run.identities.filter(i => i.status !== 'confirmed' && !i.candidates.length && !run.schedule.slots.some(s => s.act === i.act && /\bb2b\b/i.test(s.label)));
        const requests = pending.map(i => ({ identity: i, params: { query: i.act, types: 'urn:entity:artist', take: 5 } }));
        const uncached = requests.filter(r => !cached(requestRef('/search', r.params))).length;
        const live = process.env.QLOO_OFFLINE !== '1';
        if (input.mode === 'estimate') return json(res, 200, { estimatedCalls: uncached, maximumCalls: uncached * 3, live });
        const release = reserve(run, ip, live ? uncached * 3 : 0, input.maxNewCalls, false);
        busy.add(run.id); run.version++; run.status = 'resolving'; run.snapshot = null; run.repairs = []; saveRun(run);
        try {
          for (const { identity, params } of requests) {
            if (!live && !cached(requestRef('/search', params))) {
              identity.status = 'unresolved'; identity.candidates = []; identity.note = 'Not in the saved Qloo data';
              continue;
            }
            const result = await request('/search', params);
            identity.candidates = candidateList(result); identity.evidenceRef = result.ref; identity.status = identity.candidates.length ? 'ambiguous' : 'unresolved';
            delete identity.note;
            saveRun(run);
          }
          if (run.origin === 'import') {
            const reviews = seeds.map(seed => ({ name: seed.name, identities: loadSnapshot(seed.id)?.identityReview || [] }));
            for (const identity of run.identities.filter(i => i.status !== 'confirmed')) {
              delete identity.suggestedRef; delete identity.suggestedFrom;
              for (const review of reviews) {
                const confirmed = review.identities.find(i => i.act === identity.act && i.status === 'confirmed');
                const candidate = confirmed && identity.candidates.find(c => c.entityId === confirmed.entityId);
                if (candidate) { identity.suggestedRef = candidate.ref; identity.suggestedFrom = review.name; break; }
              }
            }
          }
        } catch (error) { run.status = 'failed'; run.reason = 'Identity lookup did not finish; already fetched candidates were retained'; saveRun(run); throw error; }
        finally { release(); busy.delete(run.id); }
      } else {
        const identity = run.identities.find(i => i.act === input.act); if (!identity) throw fail(400, 'Unknown act');
        if (input.operation === 'confirm') {
          const candidate = identity.candidates.find(c => c.ref === input.candidateRef); if (!candidate) throw fail(400, 'Unknown identity candidate');
          if (run.identities.some(i => i.act !== identity.act && i.status === 'confirmed' && i.entityId === candidate.entityId)) throw fail(409, 'That identity is already assigned to another act');
          identity.entityId = candidate.entityId; identity.status = 'confirmed'; identity.confirmationSource = 'operator UI confirmation';
        } else if (input.operation === 'unresolve') { identity.entityId = null; identity.status = 'unresolved'; }
        else throw fail(400, 'Unsupported identity operation');
      }
      run.snapshot = null; run.repairs = []; run.version++; run.status = 'needs_scoring'; syncIdentities(run); saveRun(run); return json(res, 200, view(run));
    }
    if (match[2] === 'score') {
      if (!['estimate', 'fetch'].includes(input.mode) || (input.context && input.context !== 'global')) throw fail(400, 'Only global scoring is available');
      if (run.identities.filter(i => i.status === 'confirmed').length < 11) throw fail(409, 'Scoring needs at least 11 confirmed acts');
      const live = process.env.QLOO_OFFLINE !== '1';
      if (run.snapshot) return json(res, 200, { status: 'complete', estimatedCalls: 0, maximumCalls: 0, callsUsed: 0, callsRemaining: 900 - callCount(), live, run: view(run) });
      const estimatedCalls = estimate(run.identities), maximumCalls = estimatedCalls * 3;
      const result = { estimatedCalls, maximumCalls, callsUsed: 0, callsRemaining: 900 - callCount(), live };
      if (input.mode === 'estimate') return json(res, 200, { ...result, status: 'estimated' });
      const release = reserve(run, ip, maximumCalls, input.maxNewCalls, true), start = callCount();
      run.status = 'scoring'; run.reason = undefined; run.version++; run.repairs = [];
      startJob(run, async () => {
        try {
          run.snapshot = await buildSnapshot(run.identities, run.origin, progress => { run.progress = progress; saveRun(run); });
          run.status = 'ready'; run.callsUsed = callCount() - start; saveRun(run);
        } finally { release(); }
      });
      return json(res, 202, { ...result, status: 'queued', run: view(run) });
    }
    if (match[2] === 'actions') {
      if (input.type === 'constraint') {
        if (input.expectedConstraintVersion !== run.constraintVersion) throw fail(409, 'Constraint version changed');
        try { constraint(run, input.constraint); } catch (error) { throw fail(409, error.message); }
        saveRun(run); return json(res, 200, view(run));
      }
      if (input.type === 'repair' || input.type === 'baseline') {
        if (!run.snapshot || !coverage(run).usablePairs) throw fail(409, 'No usable Qloo pairs. Clash measures are unavailable.');
        if (input.seed != null && (!Number.isInteger(input.seed) || input.seed < 1 || input.seed > 2147483647)) throw fail(400, 'Invalid search seed');
        if (input.type === 'baseline' && input.kind === 'llm_only') throw fail(409, 'Read prepared LLM comparisons through the agent; generation uses the isolated baseline script');
        if (input.type === 'baseline' && (input.kind !== 'genre_only' || run.origin !== 'acl-friday')) throw fail(409, 'Genre comparison is only prepared for ACL Friday');
        if (input.unknownGuard != null && !['pair', 'net'].includes(input.unknownGuard)) throw fail(400, 'Invalid unknown guard');
        let weights = run.snapshot.weights;
        if (input.type === 'baseline') {
          checkSearchCapacity();
          try { weights = weightsFromRows(JSON.parse(readFileSync('cache/probes/genre-baseline.json', 'utf8')).rows).weights; }
          catch { throw fail(409, 'The genre comparison is unavailable on this server.'); }
        }
        // Start/reserve synchronously, before changing any run state.
        const searching = searchWorker(run, weights, { guardWeights: run.snapshot.weights,
          seed: input.type === 'baseline' ? 20261013 : input.seed || 20261013,
          unknownGuard: input.unknownGuard || run.schedule.unknownGuard || 'pair' });
        if (input.unknownGuard != null) {
          if (input.unknownGuard !== run.schedule.unknownGuard) { run.schedule.unknownGuard = input.unknownGuard; run.constraintVersion++; }
        }
        run.status = 'searching'; run.reason = undefined; run.version++; run.repairs = [];
        startJob(run, async () => {
          if (input.type === 'baseline') {
            const result = await searching;
            const slots = result.repairs[0]?.slots || run.current;
            run.comparison.genre = { label: 'Coverage-matched genre diagnostic; generated after coverage was known', metrics: metrics(slots, run.snapshot.weights, run.schedule.buffer), slots, validity: validate(run.schedule, slots, run.snapshot.weights) };
            run.status = 'ready';
          } else {
            const result = await searching;
            run.repairs = result.repairs.map(r => proposal(run, r, { seed: result.seed, evaluated: result.evaluated })).filter(r => r.validity.passed);
            run.status = run.repairs.length ? 'ready' : 'none_found';
            if (!run.repairs.length) run.reason = 'No repair found within these constraints and search limits.';
          }
          saveRun(run);
        });
        return json(res, 202, view(run));
      }
      if (input.type === 'apply') {
        const repair = run.repairs.find(r => r.id === input.repairId);
        if (!repair || repair.version !== run.version || repair.constraintVersion !== run.constraintVersion || repair.snapshotId !== run.snapshot?.id) throw fail(409, 'The running order or constraints changed. Calculate a new repair before applying.');
        const errors = validate(run.schedule, repair.slots, run.snapshot.weights);
        if (errors.length) throw fail(409, 'This proposal did not pass validation. It has not been applied.', { errors });
        run.undo.push(run.current); run.current = repair.slots; run.version++; run.repairs = []; run.status = 'ready'; run.reason = undefined;
      } else if (input.type === 'undo') {
        const previous = run.undo.at(-1); if (!previous) throw fail(409, 'No applied repair to undo.');
        const errors = validate(run.schedule, previous, run.snapshot?.weights || {});
        if (errors.length) throw fail(409, 'The previous timetable conflicts with current constraints', { errors });
        run.current = run.undo.pop(); syncIdentities(run); run.version++; run.repairs = []; run.status = run.snapshot ? 'ready' : 'needs_scoring'; run.reason = undefined;
      } else throw fail(400, 'Unsupported action');
      saveRun(run); return json(res, 200, view(run));
    }
    throw fail(404, 'Route not found');
  } catch (error) {
    // Never return upstream bodies, request headers, fetch errors, stack traces or configuration values.
    json(res, error.status || 500, { reason: error.status ? error.message : 'Server operation failed', ...(error.errors ? { errors: error.errors } : {}) });
  }
});
server.requestTimeout = 35000;
// Outlive the proxy's 2-minute upstream keep-alive, so the proxy closes idle connections first instead of reusing one Node is closing.
server.keepAliveTimeout = 125000; server.headersTimeout = 126000;
const port = Number(process.env.PORT || 4191);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Interval API: http://${host}:${port}`));
