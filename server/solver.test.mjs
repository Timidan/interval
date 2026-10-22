import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, validate, metrics, pairKey } from './schedule.mjs';
import { weightsFromRows } from './matrix.mjs';
const slot = (id, stage, start, locked = false) => ({ id, act: id, label: id, stage, start, day: '1970-01-01', duration: 30, tier: 1, band: 'middle', earliest: 0, latestEnd: 120, locked });
const schedule = { slots: [slot('A', 'One', 0), slot('B', 'Two', 0, true), slot('C', 'Three', 60, true)], stages: ['One', 'Two', 'Three'].map(name => ({ name, day: '1970-01-01', tier: 1, open: 0, close: 120, changeover: 0 })), k: 1, buffer: 0 };
test('repair lowers clash cost while preserving fixed sets, durations and the anchor move budget', () => {
  const weights = { [pairKey('A', 'B')]: .95, [pairKey('A', 'C')]: .1, [pairKey('B', 'C')]: .1 };
  const result = solve(schedule, weights, { budget: 300 });
  assert.ok(result.repairs.length);
  assert.deepEqual(validate(schedule, result.repairs[0].slots, weights), []);
  assert.ok(result.repairs[0].metrics.cost < metrics(schedule.slots, weights).cost);
  assert.deepEqual(result.repairs[0].slots.slice(1), schedule.slots.slice(1));
  assert.deepEqual(solve(schedule, weights, { budget: 300 }), result);
});
test('missing reciprocal affinity stays unknown and rejects newly increased overlap', () => {
  const { weights } = weightsFromRows({ A: { B: .8, C: .9 }, B: { A: .8, C: .7 }, C: {} });
  assert.equal(weights[pairKey('A', 'C')], undefined);
  const proposed = schedule.slots.map(s => s.id === 'A' ? { ...s, start: 60 } : s);
  assert.deepEqual(validate(schedule, proposed, weights), ['unknown overlap increased']);
});

test('net guard permits redistribution, rejects total growth, and records every changed unknown pair', async () => {
  const { unknownChanges } = await import('./schedule.mjs');
  const s = structuredClone(schedule); s.slots[1].locked = false;
  const redistributed = s.slots.map(a => a.id === 'A' ? { ...a, start: 60 } : a);
  assert.deepEqual(validate(s, redistributed, {}, { unknownGuard: 'pair' }), ['unknown overlap increased']);
  assert.deepEqual(validate(s, redistributed, {}, { unknownGuard: 'net' }), []);
  assert.deepEqual(unknownChanges(s.slots, redistributed, {}).map(c => c.delta).sort((a, b) => a - b), [-30, 30]);
  const grown = redistributed.map(a => a.id === 'B' ? { ...a, start: 60 } : a);
  s.k = 2;
  assert.deepEqual(validate(s, grown, {}, { unknownGuard: 'net' }), ['total unknown overlap increased']);
});

test('agent drops unsupported claims and fails closed after one strict JSON correction', async () => {
  const { parseStep, renderSegments, beginTurn, runTurn } = await import('./agent.mjs');
  const { db } = await import('./qloo.mjs');
  const { randomUUID } = await import('node:crypto');
  assert.throws(() => parseStep('{"type":"final","segments":[],"text":"made up"}'));
  assert.throws(() => parseStep('{"type":"final","segments":[{"templateId":"ask_subject","factRefs":[]}],"__proto__":{}}'));
  assert.throws(() => parseStep('{"type":"tools","calls":[{"name":"apply_proposal","args":{}}]}'));
  assert.deepEqual(renderSegments([{ templateId: 'pair_clash', factRefs: ['invented'] }], []), []);
  assert.equal(renderSegments([{ templateId: 'pair_clash', factRefs: ['real'] }], [{ id: 'real', templateId: 'pair_clash', text: 'Server fact' }])[0].text, 'Server fact');
  const run = { id: randomUUID(), owner: 'test', origin: 'test', version: 1, constraintVersion: 1, schedule: structuredClone(schedule), current: structuredClone(schedule.slots), identities: [], snapshot: null, repairs: [], undo: [] };
  const before = structuredClone(run.current), { turn, key } = beginTurn(run, { message: 'Repair this' });
  let calls = 0;
  await runTurn(run, turn, key, () => { throw new Error('Search must not run'); }, async () => ({ id: String(++calls), recordedAt: new Date().toISOString(), model: 'test', effort: 'test', text: 'not JSON' }));
  assert.equal(calls, 2); assert.equal(turn.status, 'failed'); assert.deepEqual(run.current, before);
  assert.equal(turn.steps.filter(s => s.status === 'invalid').length, 2);
  db.prepare('DELETE FROM runs WHERE id=?').run(run.id);
});

test('agent health reports the local work limit before contacting Hermes, and retries a stale Hermes failure', async () => {
  const { health } = await import('./llm.mjs');
  const { db } = await import('./qloo.mjs');
  const { randomUUID } = await import('node:crypto');
  const budget = randomUUID(), originalFetch = globalThis.fetch, originalUrl = process.env.HERMES_URL;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('No external calls allowed'); };
  db.exec('BEGIN');
  try {
    const insert = db.prepare('INSERT INTO llm_calls(id,budget,started,status) VALUES(?,?,?,?)');
    for (let i = 0; i < 60; i++) insert.run(randomUUID(), budget, '2000-01-01T00:00:00Z', 'complete');
    const status = await health('test', budget);
    assert.equal(status.status, 'limited');
    assert.match(status.reason, /work budget exhausted/);
    assert.equal(status.retry_at, null);
    assert.equal(fetches, 0);
    process.env.HERMES_URL = 'http://hermes.test'; db.prepare("DELETE FROM llm_state WHERE id='limited'").run();
    for (const [minutes, expected] of [[11, 'available'], [1, 'unavailable']]) {
      globalThis.fetch = async () => Response.json({ status: 'unavailable', model: 'm', effort: 'e', updated_at: new Date(Date.now() - minutes * 60000).toISOString() });
      assert.equal((await health('test', randomUUID())).status, expected);
    }
  } finally {
    db.exec('ROLLBACK'); globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.HERMES_URL; else process.env.HERMES_URL = originalUrl;
  }
});

test('proxy handling, local health and scoring gate make no external calls', async () => {
  const http = await import('node:http'), { syncBuiltinESMExports } = await import('node:module');
  const { Readable } = await import('node:stream');
  const { db, hash } = await import('./qloo.mjs');
  const { saveRun } = await import('./runs.mjs');
  const { randomUUID } = await import('node:crypto');
  const workers = await import('node:worker_threads'), { EventEmitter } = await import('node:events');
  const originalWorker = workers.default.Worker, originalMaxSearches = process.env.MAX_SEARCHES, originalMaxQueued = process.env.MAX_QUEUED_SEARCHES;
  const pending = [];
  workers.default.Worker = class extends EventEmitter { constructor() { super(); pending.push(this); } };
  process.env.MAX_SEARCHES = '1'; process.env.MAX_QUEUED_SEARCHES = '1';
  const originalServer = http.default.createServer, originalFetch = globalThis.fetch;
  const originalTrustProxy = process.env.TRUST_PROXY, originalOffline = process.env.QLOO_OFFLINE;
  let handler, fetches = 0;
  http.default.createServer = callback => { handler = callback; return { listen() {} }; };
  syncBuiltinESMExports();
  globalThis.fetch = async () => { fetches++; throw new Error('No external calls allowed'); };
  db.exec('BEGIN');
  try {
    const { clientIp } = await import('./index.mjs');
    const forwardedRequest = { headers: { 'x-forwarded-for': ' 203.0.113.1 , 10.0.0.2' }, socket: { remoteAddress: '10.0.0.3' } };
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(forwardedRequest), '10.0.0.3');
    process.env.TRUST_PROXY = 'true';
    assert.equal(clientIp(forwardedRequest), '10.0.0.3');
    process.env.TRUST_PROXY = '1';
    assert.equal(clientIp(forwardedRequest), '203.0.113.1');
    assert.equal(clientIp({ ...forwardedRequest, headers: {} }), '10.0.0.3');
    assert.equal(clientIp({ ...forwardedRequest, headers: { 'x-forwarded-for': ' , 10.0.0.2' } }), '10.0.0.3');
    const changesBeforeHealth = db.prepare('SELECT total_changes() AS n').get().n;
    await handler({ method: 'GET', url: '/api/health', headers: {} }, {
      writeHead(code) { assert.equal(code, 200); },
      end(value) { assert.deepEqual(JSON.parse(value), { ok: true }); },
    });
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBeforeHealth);
    // Invalid creation input exercises cookie issuance without creating a run.
    for (const [trust, proto, secure] of [['0', 'https', false], ['1', 'https', true], ['1', 'http', false]]) {
      process.env.TRUST_PROXY = trust;
      const req = Readable.from([Buffer.from('{}')]);
      Object.assign(req, { method: 'POST', url: '/api/runs', socket: { remoteAddress: 'test' }, headers: { 'content-type': 'application/json', 'x-forwarded-proto': proto } });
      let cookie;
      await handler(req, {
        setHeader(name, value) { assert.equal(name, 'Set-Cookie'); cookie = value; },
        writeHead(code) { assert.equal(code, 400); }, end() {},
      });
      assert.match(cookie, new RegExp(`^interval_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}$`));
    }
    const session = 'a'.repeat(64), run = { id: randomUUID(), owner: hash(session), version: 1,
      identities: Array.from({ length: 10 }, (_, i) => ({ act: `Act ${i}`, status: 'confirmed' })) };
    saveRun(run);
    const limits = db.prepare("SELECT data FROM runs WHERE id='_anonymous_limits'").get();
    const calls = db.prepare('SELECT count(*) AS n FROM quota_ledger').get().n;
    for (const mode of ['estimate', 'fetch']) {
      const req = Readable.from([Buffer.from(JSON.stringify({ mode, expectedVersion: 1, maxNewCalls: 900 }))]);
      Object.assign(req, { method: 'POST', url: `/api/runs/${run.id}/score`, socket: { remoteAddress: 'test' },
        headers: { 'content-type': 'application/json', cookie: `interval_session=${session}` } });
      let status, result;
      await handler(req, { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } });
      assert.equal(status, 409);
      assert.equal(result.reason, 'Scoring needs at least 11 confirmed acts');
    }
    assert.equal(fetches, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM quota_ledger').get().n, calls);
    assert.deepEqual(db.prepare("SELECT data FROM runs WHERE id='_anonymous_limits'").get(), limits);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM runs WHERE id=?').get(run.id).data), run);
    const searchingRun = { id: randomUUID(), owner: hash(session), origin: 'acl-friday', version: 1, constraintVersion: 1,
      status: 'ready', schedule: structuredClone(schedule), current: structuredClone(schedule.slots),
      identities: schedule.slots.map(s => ({ act: s.act, status: 'confirmed' })),
      snapshot: { id: 'test', weights: { [pairKey('A', 'B')]: .95 } }, repairs: [], undo: [] };
    const waitingRun = { ...structuredClone(searchingRun), id: randomUUID() };
    const fullRun = { ...structuredClone(searchingRun), id: randomUUID(), repairs: [{ id: 'preserve' }] };
    saveRun(searchingRun); saveRun(waitingRun); saveRun(fullRun);
    const post = async (target, route, input) => {
      const req = Readable.from([Buffer.from(JSON.stringify({ expectedVersion: target.version, ...input }))]);
      Object.assign(req, { method: 'POST', url: `/api/runs/${target.id}/${route}`, socket: { remoteAddress: 'test' },
        headers: { 'content-type': 'application/json', cookie: `interval_session=${session}` } });
      let status, result;
      await handler(req, { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } });
      return { status, result };
    };
    assert.equal((await post(searchingRun, 'actions', { type: 'repair' })).status, 202);
    // With the one slot busy, the next repair waits in the queue instead of failing.
    assert.equal((await post(waitingRun, 'actions', { type: 'repair', seed: 2 })).status, 202);
    for (const [route, input] of [['actions', { type: 'repair', seed: 3, unknownGuard: 'net' }],
      ['actions', { type: 'baseline', kind: 'genre_only' }], ['messages', { message: 'Repair this' }]]) {
      const response = await post(fullRun, route, input);
      assert.equal(response.status, 503);
      assert.equal(response.result.reason, 'Interval is busy with other searches. Nothing changed; try again in a minute.');
      assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM runs WHERE id=?').get(fullRun.id).data), fullRun);
    }
    assert.equal(pending.length, 1);
    pending[0].emit('message', { repairs: [] }); pending[0].emit('exit', 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.length, 2);
    // Identical inputs reuse the finished search instead of starting a worker.
    const again = { ...structuredClone(searchingRun), id: randomUUID() }; saveRun(again);
    assert.equal((await post(again, 'actions', { type: 'repair' })).status, 202);
    assert.equal(pending.length, 2);
    pending[1].emit('error', new Error('Simulated worker failure')); pending[1].emit('exit', 1);
    await new Promise(resolve => setImmediate(resolve));
    // An uncached act must not prevent a later saved search from resolving.
    process.env.QLOO_OFFLINE = '1';
    const { newRun } = await import('./runs.mjs');
    const { requestRef } = await import('./qloo.mjs');
    const missing = `Missing ${randomUUID()}`, saved = `Saved ${randomUUID()}`;
    const imported = newRun({ timezone: 'UTC', csv: `day,stage,act,start,end\n2026-10-02,One,${missing},18:00,18:30\n2026-10-02,One,${saved},18:30,19:00` }, hash(session));
    const ref = requestRef('/search', { query: saved, types: 'urn:entity:artist', take: 5 });
    db.prepare('INSERT INTO request_cache VALUES(?,?,?,?)').run(ref, '{}', JSON.stringify({ results: { entities: [{ entity_id: 'saved-test-entity', name: saved, types: ['urn:entity:artist'] }] } }), new Date().toISOString());
    const req = Readable.from([Buffer.from(JSON.stringify({ operation: 'resolve', expectedVersion: imported.version, maxNewCalls: 0 }))]);
    Object.assign(req, { method: 'POST', url: `/api/runs/${imported.id}/identities`, socket: { remoteAddress: 'test' },
      headers: { 'content-type': 'application/json', cookie: `interval_session=${session}` } });
    let resolved;
    await handler(req, { writeHead(code) { assert.equal(code, 200); }, end(value) { resolved = JSON.parse(value); } });
    assert.equal(resolved.identities[0].status, 'unresolved');
    assert.deepEqual(resolved.identities[0].candidates, []);
    assert.equal(resolved.identities[0].note, 'Not in the saved Qloo data');
    assert.equal(resolved.identities[1].status, 'ambiguous');
    assert.equal(resolved.identities[1].candidates[0].entityId, 'saved-test-entity');
    assert.equal(fetches, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM quota_ledger').get().n, calls);
    assert.deepEqual(db.prepare("SELECT data FROM runs WHERE id='_anonymous_limits'").get(), limits);

  } finally {
    db.exec('ROLLBACK'); globalThis.fetch = originalFetch;
    if (originalOffline === undefined) delete process.env.QLOO_OFFLINE;
    else process.env.QLOO_OFFLINE = originalOffline;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
    workers.default.Worker = originalWorker;
    if (originalMaxSearches === undefined) delete process.env.MAX_SEARCHES;
    else process.env.MAX_SEARCHES = originalMaxSearches;
    if (originalMaxQueued === undefined) delete process.env.MAX_QUEUED_SEARCHES;
    else process.env.MAX_QUEUED_SEARCHES = originalMaxQueued;
    http.default.createServer = originalServer; syncBuiltinESMExports();
  }
});


test('run expiry preserves internal rows, agent turns, recent runs and recordings', async () => {
  const { db } = await import('./qloo.mjs');
  const { pruneRuns } = await import('./runs.mjs');
  const { randomUUID } = await import('node:crypto');
  const originalTTL = process.env.RUN_TTL_DAYS;
  process.env.RUN_TTL_DAYS = '7';
  db.exec('BEGIN');
  try {
    const ids = [randomUUID(), `_${randomUUID()}`, randomUUID(), randomUUID()];
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    const data = [{ createdAt: old }, { createdAt: old }, { createdAt: old, agent: { turns: [{}] } }, { createdAt: new Date().toISOString() }];
    db.prepare('INSERT INTO agent_recordings VALUES(?,?,?,?)').run(randomUUID(), 'expiry-check', old, JSON.stringify({ message: 'Preserve this answer' }));
    const recordings = db.prepare('SELECT * FROM agent_recordings').all();
    for (let i = 0; i < ids.length; i++) db.prepare('INSERT INTO runs VALUES(?,?)').run(ids[i], JSON.stringify(data[i]));
    assert.ok(pruneRuns() >= 1); // the local database may hold other expired runs
    assert.equal(db.prepare('SELECT id FROM runs WHERE id=?').get(ids[0]), undefined);
    for (const id of ids.slice(1)) assert.ok(db.prepare('SELECT id FROM runs WHERE id=?').get(id));
    assert.deepEqual(db.prepare('SELECT * FROM agent_recordings').all(), recordings);
  } finally {
    db.exec('ROLLBACK');
    if (originalTTL === undefined) delete process.env.RUN_TTL_DAYS;
    else process.env.RUN_TTL_DAYS = originalTTL;
  }
});
