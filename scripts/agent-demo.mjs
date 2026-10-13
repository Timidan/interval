import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { callCount, db } from '../server/qloo.mjs';
import { modelCallCount } from '../server/llm.mjs';
const base = process.env.INTERVAL_API || 'http://127.0.0.1:4192';
const before = callCount(), modelBefore = modelCallCount();
mkdirSync('cache/agent-demos', { recursive: true, mode: 0o700 });
async function request(path, input, cookie) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await fetch(base + path, { method: input ? 'POST' : 'GET', headers: { ...(input ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: input ? JSON.stringify(input) : undefined }); break; }
    catch (e) { if (input || attempt === 2) throw e; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify({ status: response.status, reason: data.reason }));
  return { data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}
for (const seedId of ['acl-friday', 'iii-saturday']) {
  const messages = [`${seedId === 'acl-friday' ? 'Paris Paloma' : 'REBOLLEDO'} can only play Saturday.`, 'Keep both headliners where they are.', "I'd rather split the two biggest crowds."];
  for (let i = 0; i < messages.length; i++) {
    const path = `cache/agent-demos/${seedId}-${i + 1}.json`;
    if (existsSync(path)) { const saved = JSON.parse(readFileSync(path)); console.log(JSON.stringify({ seedId, request: i + 1, saved: true, status: saved.agent.turns.at(-1).status })); continue; }
    const created = await request('/api/runs', { seedId, unknownGuard: 'net' }); let run = created.data;
    const current = structuredClone(run.current);
    const pending = await request(`/api/runs/${run.id}/messages`, { message: messages[i], expectedVersion: run.version }, created.cookie);
    assert.equal(pending.status, 202);
    while ((run = (await request(`/api/runs/${run.id}`, null, created.cookie)).data).status === 'thinking') await new Promise(resolve => setTimeout(resolve, 1000));
    assert.deepEqual(run.current.map(s => [s.id, s.day, s.stage, s.start]), current.map(s => [s.id, s.day, s.stage, s.start]));
    assert.equal(callCount(), before);
    const turn = run.agent.turns.at(-1);
    writeFileSync(path, JSON.stringify(run, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ seedId, request: i + 1, status: turn.status, modelCalls: turn.modelCalls, searches: turn.repairSearches, tools: turn.steps.filter(s => s.kind === 'tool').map(s => ({ name: s.name, status: s.status, result: s.result?.status })), segments: turn.segments.map(s => s.text), reason: turn.reason, retry_at: turn.retry_at }));
    const fulfilled = i === 0 && seedId === 'acl-friday' ? turn.segments.some(s => s.templateId === 'ask_day') : i === 2 ? turn.segments.some(s => s.templateId === 'ask_major_draws') : turn.repairSearches > 0 && turn.facts.some(f => f.templateId === 'constraint_applied');
    if (fulfilled && turn.recordingId) {
      const record = JSON.parse(db.prepare('SELECT data FROM agent_recordings WHERE id=?').get(turn.recordingId).data);
      record.demo = true; db.prepare('UPDATE agent_recordings SET data=? WHERE id=?').run(JSON.stringify(record), turn.recordingId);
    }
    if (!fulfilled && !['limited','unavailable'].includes(turn.status)) throw new Error('Required programming workflow was not completed; preserve this attempt and inspect it before retrying');
    if (turn.status === 'limited' || turn.status === 'unavailable') throw new Error(`Hermes ${turn.status}; retry_at=${turn.retry_at}`);
  }
}
console.log(JSON.stringify({ modelCallsThisInvocation: modelCallCount() - modelBefore, qlooCalls: callCount() - before }));
