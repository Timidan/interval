import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from 'cn';
import { Graph, X } from '@phosphor-icons/react';
import { api, type Clash, type PairEvidence } from '@/lib/api';

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const pct = (p: number) => `${ordinal(Math.round(p * 100))} percentile`;
const param = (v: string | number) => (typeof v === 'string' && v.includes(',') ? `${v.split(',').length} Qloo entity IDs` : v);
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date');

/** The two directed Qloo observations behind one clash warning, and the requests they came from. */
export function EvidenceDrawer({ runId, clash, onClose }: { runId: string; clash: Clash; onClose: () => void }) {
  const [evidence, setEvidence] = useState<PairEvidence | null>(null);
  const [failed, setFailed] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  // A short exit, softer than the entrance; instant under reduced motion.
  const dismiss = useCallback(() => {
    if (reduce) return onClose();
    setLeaving(true);
    window.setTimeout(onClose, 180);
  }, [onClose, reduce]);
  // Modal focus moves in on open; the page returns it to the opener on close.
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    if (clash.evidenceRef) api.evidence(runId, clash.evidenceRef).then(e => alive && setEvidence(e)).catch(() => alive && setFailed(true));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, [runId, clash.evidenceRef, dismiss]);

  return (
    <div className={cn('fixed inset-0 z-50 flex justify-end bg-stage/50 backdrop-blur-[2px]', leaving ? 'fade-out' : 'fade-in')} onClick={dismiss}>
      <aside role="dialog" aria-modal="true" aria-label={`Qloo evidence for ${clash.acts.join(' and ')}`} onClick={e => e.stopPropagation()}
        className={cn('paper flex h-full w-full max-w-[34rem] flex-col gap-6 overflow-y-auto overscroll-contain bg-paper p-6 text-ink shadow-[0_0_80px_oklch(0.122_0.009_268.083_/_0.6)] sm:p-8', leaving ? 'drawer-out' : 'drawer-in')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-2"><Graph size={14} weight="bold" />Qloo evidence</p>
            <h2 className="mt-2 font-narrow text-[1.75rem] font-semibold uppercase leading-[1.05]">{clash.acts[0]} × {clash.acts[1]}</h2>
            <p className="mt-2 text-[0.9375rem] leading-6 text-ink-2">
              They overlap for {clash.overlapMinutes} minutes. Pair weight {clash.weight == null ? 'unknown' : clash.weight.toFixed(2)}: the mean of both directions below, where 0.90 or more is a strong link.
            </p>
          </div>
          <button ref={close} type="button" onClick={dismiss} aria-label="Close the evidence" className="grid size-10 shrink-0 place-items-center rounded-[3px] border border-ink/20 transition-[background-color,scale] duration-150 hover:bg-ink/5 active:scale-[0.96]"><X size={16} weight="bold" /></button>
        </div>
        {failed && <p role="alert" className="text-[0.9375rem] text-ink">Unable to load the evidence. Close this panel and try again.</p>}
        {!evidence && !failed && (
          <div role="status" aria-label="Loading the saved Qloo observations" className="space-y-6">
            {[0, 1].map(i => (
              <div key={i} className="space-y-3 border-t border-paper-line pt-5">
                <div className="shimmer h-4 w-40 rounded-[2px]" />
                <div className="shimmer h-3 w-full rounded-[2px]" />
                <div className="shimmer h-36 w-full rounded-[3px]" />
              </div>
            ))}
          </div>
        )}
        {evidence?.directions.map((d, i) => (
          <section key={i} className="border-t border-paper-line pt-5">
            <h3 className="text-[0.9375rem] font-semibold">Ranked from {d.source}</h3>
            <p className="mt-1 text-[0.9375rem] leading-6 text-ink-2">
              {d.percentile == null
                ? <>Qloo returned no score for {d.candidate} in this row, so the pair stays unknown.</>
                : <>{d.candidate} sits at the <mark className="highlight-swipe bg-transparent px-1 text-ink">{pct(d.percentile)}</mark> of the {d.rowPopulation} other acts Qloo scored for this bill{d.affinity == null ? '' : ` (affinity ${d.affinity.toFixed(3)})`}.</>}
              {d.reason ? ` ${d.reason}` : ''}
            </p>
            <ol className="mt-3 max-h-56 overflow-y-auto rounded-[3px] border border-paper-line font-mono text-[0.75rem]">
              {d.row.map((r, n) => (
                <li key={r.act} className={r.act === d.candidate ? 'highlight-swipe flex justify-between gap-3 px-3 py-1 text-ink' : 'flex justify-between gap-3 px-3 py-1 text-ink-2'}>
                  <span className="truncate">{n + 1}. {r.act}</span><span className="tnum">{Math.round(r.percentile * 100)}</span>
                </li>
              ))}
            </ol>
            {d.request && (
              <pre className="mt-3 overflow-x-auto rounded-[3px] bg-paper-2 p-3 font-mono text-[0.6875rem] leading-5 text-ink-2">
                {`${d.request.method} ${d.request.path}\n${Object.entries(d.request.params).map(([k, v]) => `  ${k}=${param(v)}`).join('\n')}`}
              </pre>
            )}
            <p className="mt-2 font-mono text-[0.6875rem] text-ink-2">Saved Qloo snapshot, fetched {date(d.fetched)}</p>
          </section>
        ))}
        <p className="mt-auto text-[0.8125rem] leading-5 text-ink-2">Affinity is Qloo’s taste-graph signal, ranked within each act’s row. It is not a count of shared ticket holders.</p>
      </aside>
    </div>
  );
}
