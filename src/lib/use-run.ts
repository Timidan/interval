import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type MessageRequest, type Run, type RunAction, type SeedId } from '@/lib/api';

const BUSY: Run['status'][] = ['searching', 'scoring', 'resolving', 'thinking'];
// `?guard=pair` or `?guard=net` picks the rule for unknown acts; without it the server's default (the looser rule) applies.
const requested = new URLSearchParams(window.location.search).get('guard');
const guard = requested === 'pair' || requested === 'net' ? requested : undefined;
const created = new Map<SeedId, Promise<Run>>(); // one run per seed per page load, also under StrictMode's double effects
export type RunSource = { seedId: SeedId } | { runId: string };
const keyOf = (r: Run) => (r.origin === 'import' ? r.id : r.origin);

/** A run on the API: a fresh one per seeded day, or an imported one this browser already owns. */
export function useRun(source: RunSource | null) {
  const key = !source ? null : 'runId' in source ? source.runId : source.seedId;
  const [runs, setRuns] = useState<Partial<Record<string, Run>>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useCallback((r: Run) => setRuns(m => ((m[keyOf(r)]?.version ?? 0) > r.version ? m : { ...m, [keyOf(r)]: r })), []);
  const run = key ? runs[key] : undefined;

  useEffect(() => {
    if (!source) return;
    let alive = true;
    setError(null);
    let load: Promise<Run>;
    if ('runId' in source) load = api.run(source.runId);
    else {
      const { seedId } = source;
      if (!created.has(seedId)) created.set(seedId, api.createRun(guard ? { seedId, unknownGuard: guard } : { seedId }));
      load = created.get(seedId)!;
      load.catch(() => created.delete(seedId));
    }
    load.then(r => alive && save(r)).catch(e => {
      if (!alive) return;
      setError(e instanceof ApiError && e.status === 404 ? 'This running order isn’t available in this browser. Import it again to continue.'
        : e instanceof ApiError && e.status === 429 ? e.detail.reason : 'The Interval API isn’t responding, so no Qloo evidence is shown.');
    });
    return () => { alive = false; };
  }, [key, save]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = !!run && BUSY.includes(run.status);
  useEffect(() => {
    if (!run || !busy) return;
    // A failed check (a network blip, an API restart) retries instead of leaving the page stuck on "Searching…".
    let t = 0;
    const poll = (ms: number) => { t = window.setTimeout(() => api.run(run.id).then(save).catch(() => poll(3000)), ms); };
    poll(900);
    return () => window.clearTimeout(t);
  }, [run, busy, save]);

  const call = async (request: (r: Run) => Promise<Run>) => {
    if (!run) return false;
    setError(null);
    try {
      save(await request(run));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.detail.run) save(e.detail.run);
      else api.run(run.id).then(save).catch(() => {});
      setError(e instanceof ApiError ? e.detail.reason : 'The request didn’t reach the Interval API.');
      return false;
    }
  };
  const act = (body: RunAction) => call(r => api.action(r.id, body));
  const send = (body: Omit<MessageRequest, 'expectedVersion'>) => call(r => api.message(r.id, { ...body, expectedVersion: r.version }));
  return { run, busy, error, setError, save, call, act, send };
}
