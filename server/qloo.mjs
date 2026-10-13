import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

mkdirSync('cache', { recursive: true, mode: 0o700 });
export const db = new DatabaseSync('cache/qloo.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS request_cache (ref TEXT PRIMARY KEY, request TEXT, response TEXT, fetched TEXT);
CREATE TABLE IF NOT EXISTS quota_ledger (id INTEGER PRIMARY KEY, session TEXT, started INTEGER, method TEXT, path TEXT, status INTEGER, remaining INTEGER);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let credentials;
function config() {
  if (credentials) return credentials;
  const values = {};
  try {
    for (const line of readFileSync(`${homedir()}/.config/interval/qloo.env`, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(QLOO_BASE_URL|QLOO_API_KEY)\s*=\s*(.*?)\s*$/);
      if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  const base = process.env.QLOO_BASE_URL || values.QLOO_BASE_URL;
  const key = process.env.QLOO_API_KEY || values.QLOO_API_KEY;
  if (base?.replace(/\/$/, '') !== 'https://hackathon.api.qloo.com' || !key) throw Object.assign(new Error('Qloo credentials unavailable or base URL unsupported'), { status: 503 });
  credentials = { base: 'https://hackathon.api.qloo.com', key, namespace: hash(key) };
  return credentials;
}
const session = 'interval-g2-2026-10-13';
export const callCount = () => Number(db.prepare('SELECT count(*) AS n FROM quota_ledger WHERE session=?').get(session).n);
export function cached(ref) {
  const row = db.prepare('SELECT * FROM request_cache WHERE ref=?').get(ref);
  return row && { ref, request: JSON.parse(row.request), data: JSON.parse(row.response), fetched: row.fetched, status: 200, cached: true };
}
export function requestRef(path, params, method = 'GET') {
  const { namespace, base } = config();
  return hash({ namespace, base, method, path, params: Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) });
}
export const monthlyStopped = () => Boolean(db.prepare('SELECT id FROM quota_ledger WHERE remaining=0 AND started>=? LIMIT 1').get(Date.parse(new Date().toISOString().slice(0, 7) + '-01T00:00:00Z')));
let queue = Promise.resolve();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function request(path, params, { bypass = false, method = 'GET' } = {}) {
  const job = queue.then(() => execute(path, params, { bypass, method }));
  queue = job.catch(() => {});
  return job;
}
async function execute(path, params, { bypass, method }) {
  const { base, key, namespace } = config();
  if (!['/search', '/v2/insights'].includes(path)) throw new Error('Unsupported Qloo path');
  const canonical = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  const safeRequest = { base, method, path, params: canonical };
  const ref = hash({ namespace, ...safeRequest });
  if (!bypass) { const hit = cached(ref); if (hit) return hit; }
  if (process.env.QLOO_OFFLINE === '1') throw Object.assign(new Error('New Qloo calls are disabled; saved evidence only'), { status: 503 });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (callCount() >= 900) throw Object.assign(new Error('Session Qloo call budget exhausted; saved runs still work'), { status: 429 });
    const monthStart = Date.parse(new Date().toISOString().slice(0, 7) + '-01T00:00:00Z');
    if (db.prepare('SELECT id FROM quota_ledger WHERE remaining=0 AND started>=? LIMIT 1').get(monthStart)) throw Object.assign(new Error('Qloo quota exhausted. Saved runs still work; repairs using their snapshots need no new Qloo calls.'), { status: 429 });
    const cooldown = db.prepare('SELECT data FROM runs WHERE id=?').get('_qloo_cooldown');
    const waiting = cooldown ? JSON.parse(cooldown.data).until - Date.now() : 0;
    if (waiting > 60000) throw Object.assign(new Error('Qloo rate-limit cooldown active; saved runs still work'), { status: 429 });
    if (waiting > 0) await sleep(waiting + 1);
    const last = db.prepare('SELECT max(started) AS t FROM quota_ledger').get().t || 0;
    while (Date.now() < last + 350) await sleep(last + 350 - Date.now());
    const started = Date.now();
    const entry = db.prepare('INSERT INTO quota_ledger(session,started,method,path) VALUES(?,?,?,?)').run(session, started, method, path);
    console.log(`Qloo call ${callCount()}: ${method} ${path}`);
    let response;
    try {
      response = await fetch(base + path + (method === 'GET' ? '?' + new URLSearchParams(canonical) : ''), {
        method, headers: { 'X-Api-Key': key, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'POST' ? JSON.stringify(canonical) : undefined, signal: AbortSignal.timeout(30000), redirect: 'error',
      });
    } catch {
      db.prepare('UPDATE quota_ledger SET status=0 WHERE id=?').run(entry.lastInsertRowid);
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      return { ref, request: safeRequest, status: 0, data: null, fetched: new Date().toISOString() };
    }
    const rawRemaining = response.headers.get('x-month-ratelimit-remaining');
    const remaining = rawRemaining === null ? null : Number(rawRemaining);
    db.prepare('UPDATE quota_ledger SET status=?,remaining=? WHERE id=?').run(response.status, remaining, entry.lastInsertRowid);
    let data; try { data = await response.json(); } catch { data = null; }
    const fetched = new Date().toISOString();
    if (response.ok) db.prepare('INSERT OR REPLACE INTO request_cache VALUES(?,?,?,?)').run(ref, JSON.stringify(safeRequest), JSON.stringify(data), fetched);
    const result = { ref, request: safeRequest, status: response.status, data, fetched, remaining };
    if (response.status === 429) {
      const value = response.headers.get('retry-after');
      const delay = value ? (/^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) : 1000 * (attempt + 1);
      const until = Date.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 1000);
      db.prepare('INSERT OR REPLACE INTO runs VALUES(?,?)').run('_qloo_cooldown', JSON.stringify({ until }));
    }
    if (remaining === 0 || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return result;
    const retry = response.headers.get('retry-after');
    const delay = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 1000 * (attempt + 1);
    if (!Number.isFinite(delay) || delay > 60000) return result;
    await sleep(delay);
  }
}
export function entities(result) { return result?.data?.results?.entities || (Array.isArray(result?.data?.results) ? result.data.results : []); }
export function insights(source, candidates, extra = {}) {
  return { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': source, 'filter.results.entities': [...new Set(candidates)].sort().join(','), take: 50, page: 1, ...extra };
}
