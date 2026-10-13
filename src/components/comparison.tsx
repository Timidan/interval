import { useEffect, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { cn } from 'cn';
import { api, type Comparison as Data, type ComparisonRow, type SeedId } from '@/lib/api';

const cache = new Map<string, Promise<Data>>();
const ORDER: ComparisonRow['kind'][] = ['original', 'llm_only', 'genre_only', 'interval'];
const rank = (r: ComparisonRow) => ORDER.indexOf(r.kind) * 2 + (r.unknownGuard === 'net' ? 1 : 0);

function name(r: ComparisonRow) {
  if (r.kind === 'original') return 'Published timetable';
  if (r.kind === 'llm_only') return `LLM only, trial ${r.label.replace(/\D/g, '')}`;
  const who = r.kind === 'interval' ? 'Interval' : 'Genre labels only';
  return r.available ? `${who}, ${r.unknownGuard === 'net' ? 'looser' : 'strict'} rule` : who;
}

function Mark({ ok }: { ok: boolean }) {
  return ok
    ? <span className="inline-flex text-cue-dark"><Check aria-hidden="true" size={15} weight="bold" /><span className="sr-only">Passes</span></span>
    : <span className="inline-flex text-marker-dark"><X aria-hidden="true" size={15} weight="bold" /><span className="sr-only">Fails</span></span>;
}

/** The prepared comparison for a seeded day, fetched once per page. */
export function useComparison(seedId: SeedId) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(null); setFailed(false);
    if (!cache.has(seedId)) cache.set(seedId, api.comparison(seedId));
    cache.get(seedId)!.then(d => alive && setData(d)).catch(() => { cache.delete(seedId); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [seedId]);
  return { data, failed };
}

/** The brief's proof table: every approach measured the same way on the published timetable, prepared before this page loaded. */
export function Comparison({ seedId }: { seedId: SeedId }) {
  const { data, failed } = useComparison(seedId);
  if (failed) return null;

  const rows = data ? [...data.rows].sort((a, b) => rank(a) - rank(b)) : [];
  const head = 'px-3 pb-2 text-start font-mono text-[0.6875rem] font-normal uppercase leading-4 tracking-[0.12em] text-chalk-2';
  return (
    <section aria-labelledby="comparison-title" className="rounded-[4px] border border-chalk/12 bg-haze/80 p-5 backdrop-blur-md">
      <h2 id="comparison-title" className="font-display text-[0.875rem] font-bold uppercase tracking-[0.06em]">Compared with other approaches</h2>
      <p className="mt-2 max-w-[72ch] text-pretty text-[0.8125rem] leading-[1.6] text-chalk-2">
        Every row is measured the same way, on the published timetable. The LLM-only trials saw the act names, set times and the same rules, but no Qloo scores. The genre rows use genre labels gathered before any Qloo data.
      </p>
      {data ? (
        <div className="relative -mx-5 mt-4 overflow-x-auto overscroll-x-contain px-2">
          <table className="w-full min-w-[40rem] border-collapse text-[0.875rem]">
            <thead>
              <tr>
                <th scope="col" className={head}>Approach</th>
                <th scope="col" className={cn(head, 'text-end')}>Sets moved</th>
                <th scope="col" className={cn(head, 'text-end')}>Strong clashes</th>
                <th scope="col" className={cn(head, 'text-end')}>Weighted clash minutes</th>
                <th scope="col" className={head}>Keeps holds</th>
                <th scope="col" className={head}>Strict rule</th>
                <th scope="col" className={head}>Looser rule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className={cn('border-t border-chalk/10 align-top', r.kind === 'interval' && r.available && 'bg-chalk/[0.04]')}>
                  <th scope="row" className="min-w-[12rem] px-3 py-2.5 text-start font-normal">
                    <span className={cn('block', r.kind === 'interval' ? 'font-semibold text-chalk' : 'text-chalk')}>{name(r)}</span>
                    {r.acts.length > 0 && <span className="mt-0.5 block text-[0.75rem] text-chalk-2">Moves {r.acts.join(', ')}</span>}
                  </th>
                  {r.available && r.metrics ? (
                    <>
                      <td className="px-3 py-2.5 text-end tabular-nums">{r.moved ?? '–'}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{r.metrics.strongClashes}</td>
                      <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{Math.round(r.metrics.cost).toLocaleString('en-US')}</td>
                      <td className="px-3 py-2.5"><Mark ok={r.logistics} /></td>
                      <td className="px-3 py-2.5"><Mark ok={r.pairGuard} /></td>
                      <td className="px-3 py-2.5"><Mark ok={r.netGuard} /></td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-3 py-2.5 text-[0.8125rem] text-chalk-2">Not available: no independent genre labels exist for this lineup.</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="status" aria-label="Loading the comparison" className="mt-4 space-y-2">
          <div className="shimmer-dark h-4 w-full rounded-[2px]" />
          <div className="shimmer-dark h-4 w-5/6 rounded-[2px]" />
          <div className="shimmer-dark h-4 w-2/3 rounded-[2px]" />
        </div>
      )}
      {data && (
        <p className="mt-4 max-w-[72ch] text-pretty text-[0.8125rem] leading-[1.6] text-chalk-2">
          Prepared {new Date(data.frozenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, before this page loaded. A retrospective comparison of timetables, not of audience outcomes.
        </p>
      )}
    </section>
  );
}
