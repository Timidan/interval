import { randomUUID } from 'node:crypto';
import { db, hash } from './qloo.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS llm_calls (id TEXT PRIMARY KEY, visitor TEXT, budget TEXT, started TEXT, status TEXT, prompt_hash TEXT, model TEXT, effort TEXT, recorded_at TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS llm_state (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_recordings (id TEXT PRIMARY KEY, match_hash TEXT, recorded_at TEXT, data TEXT NOT NULL);`);
const get = id => { const row = db.prepare('SELECT data FROM llm_state WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; };
const set = (id, value) => db.prepare('INSERT OR REPLACE INTO llm_state VALUES(?,?)').run(id, JSON.stringify(value));
const url = () => process.env.HERMES_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:18080' : null);
const error = (state, reason, retry_at = null) => Object.assign(new Error(reason), { status: state === 'limited' ? 429 : 503, state, retry_at, callStarted: false });
export const modelCallCount = () => Number(db.prepare('SELECT count(*) n FROM llm_calls').get().n);
const workBudget = () => process.env.HERMES_BUDGET_ID || 'interval-hermes-2026-10-13';
function allowance(visitor, budget = workBudget()) {
  const today = new Date().toISOString().slice(0, 10);
  const used = db.prepare('SELECT count(*) n FROM llm_calls WHERE budget=?').get(budget).n;
  if (used >= Number(process.env.HERMES_BUDGET_CALLS || 60)) return { status: 'limited', reason: 'Interval work budget exhausted; no further model calls are authorized in this budget', retry_at: null };
  const counts = db.prepare('SELECT count(*) daily, sum(visitor=?) visitor FROM llm_calls WHERE substr(started,1,10)=?').get(visitor || null, today);
  if (counts.daily >= Number(process.env.LLM_DAILY_LIMIT || 60) || counts.visitor >= Number(process.env.LLM_VISITOR_LIMIT || 18)) return {
    status: 'limited', reason: 'Interval model-call allowance reached', retry_at: Math.floor(Date.parse(`${today}T00:00:00Z`) / 1000) + 86400 };
  return null;
}
export async function health(visitor, budget = workBudget()) {
  const limited = allowance(visitor, budget);
  if (limited) return limited;
  if (!url()) return { status: 'unavailable', reason: 'Agent unavailable: HERMES_URL is not configured', retry_at: null };
  const stopped = get('limited');
  if (stopped && (!stopped.retry_at || stopped.retry_at * 1000 > Date.now())) return { status: 'limited', ...stopped };
  try {
    const response = await fetch(`${url()}/healthz`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const body = await response.json();
    if (!response.ok || !['available', 'limited', 'unavailable', 'unknown'].includes(body.status)) throw 0;
    // Hermes keeps reporting a failure (or "unknown" after a limit resets) until a call succeeds, so a stale one lets the next request try.
    const retry = body.status === 'unknown' || (body.status === 'unavailable' && Date.parse(body.updated_at) < Date.now() - 600000);
    const safe = { status: retry ? 'available' : body.status, model: body.model, effort: body.effort, retry_at: Number.isFinite(body.retry_at) ? body.retry_at : null };
    if (safe.status === 'limited') set('limited', { retry_at: safe.retry_at, reason: 'Hermes shared usage limit reached' });
    return safe;
  } catch { return { status: 'unavailable', reason: 'Agent unavailable: Hermes health check failed', retry_at: null }; }
}
export async function complete({ system, user, visitor, budget = workBudget() }) {
  if (!visitor || typeof system !== 'string' || !system || typeof user !== 'string' || !user || Buffer.byteLength(JSON.stringify({ system, user })) > 131072) throw error('unavailable', 'Agent input is unavailable or exceeds the Hermes input limit');
  const id = randomUUID(), now = new Date().toISOString();
  // Cross-process lease also covers scripts; count starts, including failed and corrective calls.
  db.exec('BEGIN IMMEDIATE');
  try {
    const lease = get('lease');
    if (lease?.until > Date.now()) throw error('unavailable', 'Another Interval model call is in progress');
    const stopped = get('limited');
    if (stopped && (!stopped.retry_at || stopped.retry_at * 1000 > Date.now())) throw error('limited', stopped.reason, stopped.retry_at);
    const limited = allowance(visitor, budget);
    if (limited) throw error('limited', limited.reason, limited.retry_at);
    set('lease', { id, until: Date.now() + 240000 });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  let timedOut = false, started = false;
  try {
    const available = await health(visitor, budget);
    if (available.status !== 'available') throw error(available.status === 'limited' ? 'limited' : 'unavailable', available.reason || 'Agent unavailable from Hermes', available.retry_at);
    db.prepare('INSERT INTO llm_calls(id,visitor,budget,started,status,prompt_hash) VALUES(?,?,?,?,?,?)').run(id, visitor, budget, now, 'started', hash({ system, user }));
    started = true;
    let response;
    try { response = await fetch(`${url()}/v1/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, user }), signal: AbortSignal.timeout(180000), redirect: 'error' }); }
    catch { timedOut = true; throw error('unavailable', 'Agent unavailable: Hermes call failed or timed out; no automatic retry'); }
    const body = await response.json().catch(() => null);
    if (response.status === 429) {
      const retry_at = Number.isFinite(body?.retry_at) ? body.retry_at : null;
      set('limited', { retry_at, reason: 'Hermes shared usage limit reached' });
      throw error('limited', 'Hermes shared usage limit reached', retry_at);
    }
    if (!response.ok || typeof body?.text !== 'string' || typeof body?.model !== 'string' || typeof body?.effort !== 'string') throw error('unavailable', 'Agent unavailable: Hermes did not return a completion');
    const recordedAt = new Date().toISOString();
    db.prepare('UPDATE llm_calls SET status=?,model=?,effort=?,recorded_at=?,text=? WHERE id=?').run('complete', body.model, body.effort, recordedAt, body.text, id);
    return { id, promptHash: hash({ system, user }), model: body.model, effort: body.effort, recordedAt, text: body.text };
  } catch (e) {
    db.prepare('UPDATE llm_calls SET status=? WHERE id=?').run(e.state || 'unavailable', id);
    const failure = e.state ? e : error('unavailable', 'Agent unavailable');
    failure.callStarted = started; throw failure;
  } finally {
    if (!timedOut && get('lease')?.id === id) db.prepare('DELETE FROM llm_state WHERE id=?').run('lease');
  }
}
