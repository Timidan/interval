// Isolated verification fixture: these choices are simulated coordinator input,
// not an actual programmer endorsement or a festival crowd-size claim.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { callCount } from '../server/qloo.mjs';
const base = process.env.INTERVAL_API || 'http://127.0.0.1:4192', before = callCount();
for (const seedId of ['acl-friday','iii-saturday']) {
  const path = `cache/agent-demos/${seedId}-confirmed-draws.json`;
  if (existsSync(path)) { console.log({ seedId, status: JSON.parse(readFileSync(path)).agent.turns.at(-1).status, saved: true }); continue; }
  let response = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ seedId, unknownGuard: 'net' }) });
  assert.equal(response.status, 201); const cookie = response.headers.get('set-cookie').split(';')[0]; let run = await response.json();
  const sets = run.current.filter(s => s.band === 'headline'); assert.equal(sets.length, 2);
  const placements = run.current.map(s => [s.id,s.day,s.stage,s.start]);
  response = await fetch(`${base}/api/runs/${run.id}/messages`, { method: 'POST', headers: { 'Content-Type':'application/json', cookie },
    body: JSON.stringify({ message: "I'd rather split the two biggest crowds. Use the confirmed major-draw flags, change the preference to concurrent, and propose repairs.", majorDrawSetIds: sets.map(s=>s.id), expectedVersion: run.version }) });
  assert.equal(response.status, 202);
  do { await new Promise(resolve=>setTimeout(resolve,1000)); response = await fetch(`${base}/api/runs/${run.id}`, { headers: { cookie } }); run = await response.json(); } while (run.status === 'thinking');
  const turn = run.agent.turns.at(-1);
  writeFileSync(path,JSON.stringify({...run,verificationFixture:'Simulated coordinator confirmation, not programmer acceptance'},null,2),{mode:0o600});
  console.log(JSON.stringify({seedId,status:turn.status,calls:turn.modelCalls,searches:turn.repairSearches,objective:run.schedule.objective,segments:turn.segments.map(s=>s.text),reason:turn.reason,retry_at:turn.retry_at}));
  assert.equal(callCount(),before);assert.deepEqual(run.current.map(s=>[s.id,s.day,s.stage,s.start]),placements);
  if (['limited','unavailable'].includes(turn.status)) throw new Error(`Hermes ${turn.status}; retry_at=${turn.retry_at}`);
  assert.equal(run.schedule.objective,'concurrent');assert.ok(turn.repairSearches > 0);
}
