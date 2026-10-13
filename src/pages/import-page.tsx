import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileArrowUp, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { cn } from 'cn';
import { arrowClass, buttonClass } from '@/components/button';
import { StageBackground } from '@/components/stage';
import { api, ApiError, type IdentityEstimateResponse, type Run, type ScoreResponse } from '@/lib/api';
import { useRun } from '@/lib/use-run';
import { festival, plural } from '@/lib/timetable';

const panel = 'rounded-[4px] border border-chalk/12 bg-haze/80 p-5 backdrop-blur-md sm:p-6';
const h2 = 'flex items-baseline gap-3 font-display text-[0.875rem] font-bold uppercase tracking-[0.06em]';
const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h2 className={h2}><span className="font-mono text-[0.75rem] font-normal text-chalk-2 tabular-nums">0{n}</span>{children}</h2>
);
const body = 'text-[0.9375rem] leading-[1.6] text-chalk-2';
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The published ACL Friday timetable in the import format, with the seed's two headline holds.
 * Like the seed, it bills Steve Aoki under his own name so Qloo can match him. */
function sampleCsv() {
  const rows = festival('acl').sets.map(s => [s.day, s.stage, s.act === 'Steve Aoki with Mack' ? 'Steve Aoki' : s.act, hhmm(s.start), hhmm(s.end), s.held ? 'exact' : ''].map(cell).join(','));
  return ['day,stage,act,start,end,hold', ...rows].join('\n');
}
// The server keeps an act's Qloo row only if it separates at least 10 other acts, so fewer than 11 confirmed acts can't produce any clash weight.
const MIN_SCORED = 11;
const b2b = (run: Run, act: string) => run.schedule.slots.some(s => s.act === act && /\bb2b\b/i.test(s.label));
const said = (e: unknown) => (e instanceof ApiError ? e.detail.reason : 'The request didn’t reach the Interval API.');
// An estimate that loses a race with a newer version is simply asked again for that version.
const stale = (e: unknown) => e instanceof ApiError && e.status === 409;

/** Bring a draft running order: CSV in, artist matches confirmed, the Qloo cost stated before anything is fetched. */
export function ImportPage() {
  const [runId, setRunId] = useState(() => new URLSearchParams(window.location.search).get('run'));
  const { run, busy, error, setError, save } = useRun(runId ? { runId } : null);

  return (
    <div className="relative min-h-[100dvh]">
      <StageBackground dim={0.78} />
      <header className="rise mx-auto flex max-w-3xl items-center gap-5 px-5 pt-5" style={{ '--i': 0 } as React.CSSProperties}>
        <a href="/" className="inline-flex items-center gap-2.5 font-display text-[1rem] font-extrabold uppercase tracking-[0.06em] text-chalk">
          <ArrowLeft size={16} weight="bold" className="text-chalk-2" />Interval
        </a>
        <a href="/sheet" className="ms-auto text-[0.875rem] text-chalk-2 underline decoration-chalk/30 underline-offset-4 hover:text-chalk">Sample festivals</a>
      </header>
      <main className="rise mx-auto mt-10 max-w-3xl space-y-5 px-5 pb-24" style={{ '--i': 1 } as React.CSSProperties}>
        <div>
          <h1 className="font-display text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold uppercase leading-[0.95] tracking-[-0.01em] text-chalk">Import a draft</h1>
          <p className={cn(body, 'mt-4 max-w-[62ch] text-pretty')}>
            Paste a draft as CSV. Interval matches each act to Qloo, tells you how many Qloo calls scoring needs before it runs, then finds clashes and tested changes the same way it does for the sample festivals.
          </p>
        </div>
        {error && <p role="alert" className="flex items-start gap-2.5 rounded-[4px] border border-chalk/25 bg-stage/70 px-4 py-3 text-[0.9375rem] leading-6 text-chalk"><WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" />{error}</p>}
        {!runId ? <Paste onCreated={r => { save(r); setRunId(r.id); window.history.replaceState(null, '', `/import?run=${r.id}`); }} />
          : !run ? <div role="status" aria-label="Loading your running order" className={cn(panel, 'space-y-3')}><div className="shimmer-dark h-4 w-44 rounded-[2px]" /><div className="shimmer-dark h-3 w-full rounded-[2px]" /></div>
          : <Steps run={run} busy={busy} save={save} setError={setError} />}
      </main>
    </div>
  );
}

function Paste({ onCreated }: { onCreated: (r: Run) => void }) {
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [csv, setCsv] = useState('');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const file = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 120_000) { setProblem('Choose a CSV under 120 KB. Interval takes up to 150 sets.'); return; }
    setCsv(await f.text()); setProblem(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csv.trim()) { setProblem('Paste a CSV with a header row: day, stage, act, start, end.'); return; }
    setSending(true); setProblem(null);
    try { onCreated(await api.createRun({ csv, timezone })); }
    catch (err) { setProblem(said(err)); }
    finally { setSending(false); }
  };
  return (
    <form onSubmit={submit} className={panel} noValidate>
      <Step n={1}>Paste the draft</Step>
      <label htmlFor="csv" className="mt-4 block text-[0.875rem] font-medium text-chalk">Running order as CSV</label>
      <p id="csv-help" className="mt-1 max-w-[68ch] text-pretty text-[0.8125rem] leading-[1.6] text-chalk-2">
        Columns: day, stage, act, start and end. Optional: hold (day, stage, start or exact), band (opener, middle, sub-headline or headline) and tier (1–100). Use 24-hour local times such as 19:30, and a dated end such as 2026-10-03T01:00 for sets that finish after midnight. Up to 150 sets and 60 acts.
      </p>
      <textarea id="csv" value={csv} onChange={e => setCsv(e.target.value)} rows={10} spellCheck={false}
        aria-describedby={problem ? 'csv-help csv-problem' : 'csv-help'} aria-invalid={problem ? true : undefined}
        placeholder={'day,stage,act,start,end,hold\n2026-10-02,Main,Headliner,20:00,21:30,exact'}
        className="mt-3 w-full resize-y rounded-[3px] border border-chalk/15 bg-stage/60 p-3 font-mono text-base leading-6 text-chalk placeholder:text-chalk-2/70 focus-visible:border-chalk/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gel sm:text-[0.8125rem]" />
      {problem && <p id="csv-problem" role="alert" className="mt-2 flex items-start gap-2 text-[0.875rem] leading-6 text-chalk"><WarningCircle size={16} weight="bold" className="mt-1 shrink-0 text-marker-dark" />{problem}</p>}
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
        <label className="block">
          <span className="block text-[0.875rem] font-medium text-chalk">Festival timezone</span>
          <select value={timezone} onChange={e => setTimezone(e.target.value)}
            className="mt-2 h-11 rounded-[3px] border border-chalk/15 bg-stage/60 px-3 text-base text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gel sm:text-[0.875rem]">
            {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className={buttonClass('ghost', 'h-11 cursor-pointer px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gel')}>
          <FileArrowUp size={16} weight="bold" />Choose a CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => void file(e.target.files?.[0])} />
        </label>
        <button type="button" onClick={() => { setCsv(sampleCsv()); setTimezone('America/Chicago'); setProblem(null); }} className={buttonClass('link', 'h-11')}>
          Use the ACL Friday sample
        </button>
      </div>
      <button type="submit" disabled={sending} className={buttonClass('primary', 'mt-6 h-12 px-5')}>
        {sending ? 'Checking…' : 'Check the timetable'}<ArrowRight size={16} weight="bold" className={arrowClass} />
      </button>
    </form>
  );
}

function Steps({ run, busy, save, setError }: { run: Run; busy: boolean; save: (r: Run) => void; setError: (e: string | null) => void }) {
  const acts = run.identities.filter(i => !b2b(run, i.act));
  const unlooked = acts.filter(i => i.status !== 'confirmed' && !i.candidates.length && !i.evidenceRef && !i.note);
  const confirmed = acts.filter(i => i.status === 'confirmed').length;
  const stages = new Set(run.schedule.stages.map(s => `${s.day}|${s.name}`)).size;
  const days = new Set(run.schedule.stages.map(s => s.day)).size;
  return (
    <>
      <section className={panel}>
        <Step n={1}>Draft checked</Step>
        <p className={cn(body, 'mt-2')}>
          {plural(run.schedule.slots.length, 'set', 'sets')} by {plural(run.identities.length, 'act', 'acts')} across {plural(stages, 'stage', 'stages')} on {plural(days, 'day', 'days')}, in {run.timezone.replace(/_/g, ' ')}. Every set fits its stage without overlap.
        </p>
      </section>
      {unlooked.length > 0 || run.status === 'resolving'
        ? <Lookup run={run} count={unlooked.length} busy={busy} save={save} setError={setError} />
        : <>
            <section className={panel}>
              <Step n={2}>Acts looked up</Step>
              <p className={cn(body, 'mt-2')}>Qloo returned possible matches for {acts.filter(i => i.candidates.length).length} of {plural(acts.length, 'act', 'acts')}.</p>
            </section>
            <Matches run={run} save={save} setError={setError} />
            {confirmed > 0 && <Score run={run} busy={busy} save={save} setError={setError} />}
          </>}
    </>
  );
}

function Lookup({ run, count, busy, save, setError }: { run: Run; count: number; busy: boolean; save: (r: Run) => void; setError: (e: string | null) => void }) {
  const [estimate, setEstimate] = useState<IdentityEstimateResponse | null>(null);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    let alive = true;
    api.identities(run.id, { operation: 'resolve', mode: 'estimate', expectedVersion: run.version }).then(e => alive && setEstimate(e)).catch(e => alive && !stale(e) && setError(said(e)));
    return () => { alive = false; };
  }, [run.id, run.version, setError]);
  const go = async () => {
    if (!estimate) return;
    setLooking(true); setError(null);
    try { save(await api.identities(run.id, { operation: 'resolve', maxNewCalls: estimate.maximumCalls, expectedVersion: run.version })); }
    catch (e) { setError(said(e)); api.run(run.id).then(save).catch(() => {}); }
    finally { setLooking(false); }
  };
  const working = looking || busy;
  return (
    <section className={panel} aria-busy={working}>
      <Step n={2}>Find the acts on Qloo</Step>
      <p className={cn(body, 'mt-2')}>
        {!estimate ? 'Checking what the lookup costs…'
          : estimate.estimatedCalls === 0 ? `Every lookup for these ${plural(count, 'act', 'acts')} is already saved, so this uses no Qloo calls.`
          : !estimate.live ? `This demo uses saved Qloo data only and makes no new calls. ${plural(estimate.estimatedCalls, 'act hasn’t', 'acts haven’t')} been looked up before, so ${estimate.estimatedCalls === 1 ? 'it stays' : 'they stay'} unknown; the rest are matched from saved data.`
          : `Looking up ${plural(count, 'act', 'acts')} takes ${plural(estimate.estimatedCalls, 'Qloo call', 'Qloo calls')}, and at most ${estimate.maximumCalls} if some need a retry.`}
        {run.schedule.slots.some(s => /\bb2b\b/i.test(s.label)) ? ' b2b sets stay unknown: their artists are never merged into one identity.' : ''}
      </p>
      {working && <p role="status" className="mt-3 font-mono text-[0.8125rem] text-chalk-2">Looking up acts on Qloo. This takes about a second per act.</p>}
      {working && <div aria-hidden="true" className="shimmer-dark mt-3 h-1 w-full rounded-full" />}
      <button type="button" disabled={!estimate || working} onClick={go} className={buttonClass('primary', 'mt-5 h-12 px-5')}>
        <MagnifyingGlass size={16} weight="bold" />{estimate?.live && estimate.estimatedCalls > 0 ? `Look up acts · up to ${plural(estimate.maximumCalls, 'call', 'calls')}` : 'Look up acts'}
      </button>
    </section>
  );
}

function Matches({ run, save, setError }: { run: Run; save: (r: Run) => void; setError: (e: string | null) => void }) {
  const acts = run.identities.filter(i => !b2b(run, i.act));
  // Only a person's earlier review is preselected, never a name match: Qloo often has several artists with one name
  // (ACL's Leon Thomas is "Leon Thomas III", not the jazz singer). The programmer still saves every choice.
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(acts.filter(i => i.status === 'ambiguous' && i.suggestedRef).map(i => [i.act, i.suggestedRef!])));
  const reviewed = acts.find(i => i.status === 'ambiguous' && i.suggestedFrom)?.suggestedFrom;
  const [saving, setSaving] = useState(false);
  const pending = acts.filter(i => i.status === 'ambiguous');
  const chosen = pending.filter(i => choice[i.act]);
  const confirm = async () => {
    setSaving(true); setError(null);
    let r = run;
    try {
      for (const i of chosen) {
        const ref = choice[i.act];
        r = ref === 'none' ? await api.identities(r.id, { operation: 'unresolve', act: i.act, expectedVersion: r.version })
          : await api.identities(r.id, { operation: 'confirm', act: i.act, candidateRef: ref, expectedVersion: r.version });
        save(r);
      }
    } catch (e) { setError(said(e)); api.run(run.id).then(save).catch(() => {}); }
    finally { setSaving(false); }
  };
  const undo = async (act: string) => {
    setError(null);
    try { save(await api.identities(run.id, { operation: 'unresolve', act, expectedVersion: run.version })); } catch (e) { setError(said(e)); }
  };
  const done = acts.filter(i => i.status !== 'ambiguous');
  if (run.snapshot) {
    const matched = acts.filter(i => i.status === 'confirmed');
    return (
      <section className={panel}>
        <Step n={3}>Matches confirmed</Step>
        <p className={cn(body, 'mt-2')}>
          {plural(matched.length, 'act is', 'acts are')} matched to Qloo artists; the other {acts.length - matched.length} stay unknown. The scores depend on these matches, so they’re fixed now. To try different matches, import the draft again.
        </p>
        <details className="mt-4">
          <summary className="cursor-pointer text-[0.875rem] font-medium text-chalk underline decoration-chalk/35 underline-offset-4">Show every match</summary>
          <ul className="mt-3 divide-y divide-chalk/10 border-t border-chalk/10">
            {acts.map(i => (
              <li key={i.act} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[0.875rem]">
                <span className="text-chalk">{i.act}</span>
                <span className="text-chalk-2">{i.status === 'confirmed' ? `Matched to ${i.candidates.find(c => c.entityId === i.entityId)?.name ?? 'a Qloo artist'}` : 'Unknown'}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>
    );
  }
  return (
    <section className={panel}>
      <Step n={3}>Confirm the matches</Step>
      <p className={cn(body, 'mt-2')}>
        {pending.length ? `Pick the Qloo artist for each act, or None of these. Check the description: different artists often share a name. Acts you skip stay unknown.${reviewed ? ` Matches a person confirmed for ${reviewed} are preselected; check them before saving.` : ''}`
          : 'Every act is settled. Acts without a match stay unknown: Interval never moves them and never treats their pairs as zero.'}
      </p>
      {pending.length > 0 && (
        <ul className="mt-5 space-y-5">
          {pending.map(i => (
            <li key={i.act}>
              <fieldset>
                <legend className="font-narrow text-[1.25rem] font-semibold uppercase leading-tight text-chalk">{i.act}</legend>
                <div className="mt-2 grid gap-2">
                  {[...i.candidates.map(c => ({ ref: c.ref, title: c.name, tag: c.ref === i.suggestedRef ? 'Reviewed match' : c.name.toLowerCase() === i.act.toLowerCase() ? 'Same name' : null, detail: [c.genres.slice(0, 3).join(', '), c.description].filter(Boolean).join(' · ') })), { ref: 'none', title: 'None of these', tag: null, detail: 'The act stays unknown.' }].map(o => (
                    <label key={o.ref} className={cn('flex cursor-pointer items-start gap-3 rounded-[3px] border px-3 py-2.5 transition-colors duration-150', choice[i.act] === o.ref ? 'border-chalk/60 bg-chalk/[0.07]' : 'border-chalk/12 hover:border-chalk/35')}>
                      <input type="radio" name={`match-${i.act}`} value={o.ref} checked={choice[i.act] === o.ref} onChange={() => setChoice(m => ({ ...m, [i.act]: o.ref }))} className="mt-1 size-4 shrink-0 accent-[var(--color-chalk)]" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem] font-semibold text-chalk">{o.title}{o.tag && <span className="font-mono text-[0.6875rem] font-normal uppercase tracking-[0.1em] text-chalk-2">{o.tag}</span>}</span>
                        {o.detail && <span className="mt-0.5 block text-[0.8125rem] leading-[1.5] text-chalk-2 [overflow-wrap:anywhere]">{o.detail}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <button type="button" disabled={!chosen.length || saving} onClick={confirm} className={buttonClass('primary', 'mt-6 h-12 px-5')}>
          <Check size={16} weight="bold" />{saving ? 'Saving…' : `Save ${plural(chosen.length, 'choice', 'choices')}`}
        </button>
      )}
      {done.length > 0 && (
        <ul className="mt-6 divide-y divide-chalk/10 border-t border-chalk/10">
          {done.map(i => (
            <li key={i.act} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[0.875rem]">
              <span className="text-chalk">{i.act}</span>
              <span className="inline-flex items-center gap-3 text-chalk-2">
                {i.status === 'confirmed' ? <><Check aria-hidden="true" size={14} weight="bold" className="text-cue-dark" />Matched to {i.candidates.find(c => c.entityId === i.entityId)?.name ?? 'a Qloo artist'}</>
                  : i.note ? 'Not in the saved Qloo data · stays unknown' : i.candidates.length ? 'None of these · stays unknown' : 'Not on Qloo · stays unknown'}
                {i.candidates.length > 0 && (
                  <button type="button" onClick={() => void undo(i.act)} className="text-chalk underline decoration-chalk/35 underline-offset-4 hover:decoration-chalk"
                    aria-label={`Change the match for ${i.act}`}>Change</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Score({ run, busy, save, setError }: { run: Run; busy: boolean; save: (r: Run) => void; setError: (e: string | null) => void }) {
  const [estimate, setEstimate] = useState<ScoreResponse | null>(null);
  const confirmed = run.identities.filter(i => i.status === 'confirmed').length;
  const pending = run.identities.some(i => i.status === 'ambiguous');
  const short = confirmed < MIN_SCORED;
  const unsaved = !!estimate && !estimate.live && estimate.estimatedCalls > 0;
  useEffect(() => {
    if (run.snapshot || busy || short) return;
    let alive = true;
    api.score(run.id, { mode: 'estimate', maxNewCalls: 0, expectedVersion: run.version }).then(e => alive && setEstimate(e)).catch(e => alive && !stale(e) && setError(said(e)));
    return () => { alive = false; };
  }, [run.id, run.version, run.snapshot, busy, short, setError]);
  const go = async () => {
    if (!estimate) return;
    setError(null);
    try { const r = await api.score(run.id, { mode: 'fetch', maxNewCalls: estimate.maximumCalls, expectedVersion: run.version }); if (r.run) save(r.run); }
    catch (e) { setError(said(e)); }
  };
  if (run.snapshot) {
    const strong = run.metrics?.strongClashes ?? 0;
    const used = (run as Run & { callsUsed?: number }).callsUsed; // set by the server after a live scoring job
    return (
      <section className={panel}>
        <Step n={4}>Scored</Step>
        <p className={cn(body, 'mt-2')}>
          Qloo scored {plural(confirmed, 'confirmed act', 'confirmed acts')}{used ? ` with ${plural(used, 'new call', 'new calls')}` : ''}. {run.coverage.usablePairs} of {run.coverage.totalPairs} pairs have an affinity; the rest stay unknown. {strong ? `${plural(strong, 'strong clash', 'strong clashes')} to look at.` : 'No strong clash among the acts Qloo identifies.'}
        </p>
        <a href={`/sheet?run=${run.id}`} className={buttonClass('primary', 'mt-5 h-12 px-5')}>Open the running order<ArrowRight size={16} weight="bold" className={arrowClass} /></a>
      </section>
    );
  }
  const scoring = run.status === 'scoring';
  return (
    <section className={panel} aria-busy={scoring}>
      <Step n={4}>Score the confirmed acts</Step>
      <p className={cn(body, 'mt-2')}>
        {short ? `Scoring needs at least ${MIN_SCORED} confirmed acts, and ${confirmed} ${confirmed === 1 ? 'is' : 'are'} confirmed. Qloo’s scores are compared within each act’s list, and a shorter list can’t tell strong links from weak ones.`
          : !estimate ? 'Checking what scoring costs…'
          : estimate.estimatedCalls === 0 ? `Every comparison between these ${plural(confirmed, 'act', 'acts')} is already saved, so scoring uses no Qloo calls.`
          : unsaved ? `This demo uses saved Qloo data only, and ${plural(estimate.estimatedCalls, 'request these matches need isn’t', 'requests these matches need aren’t')} saved, so it can’t score them here. The reviewed matches of the ACL Friday sample score from saved data; to score your own lineup, run Interval with a Qloo key.`
          : `Scoring compares each of the ${confirmed} confirmed acts with the others: ${plural(estimate.estimatedCalls, 'Qloo call', 'Qloo calls')}, and at most ${estimate.maximumCalls} if some need a retry.`}
        {pending ? ' Acts still waiting for a choice are left out.' : ''}
      </p>
      {scoring && <p role="status" className="mt-3 font-mono text-[0.8125rem] tabular-nums text-chalk-2">Scoring with Qloo{run.progress ? `: ${run.progress.completed} of ${run.progress.total} requests` : '…'}</p>}
      {scoring && <div aria-hidden="true" className="shimmer-dark mt-3 h-1 w-full rounded-full" />}
      {run.status === 'failed' && run.reason && <p role="alert" className="mt-3 text-[0.875rem] leading-6 text-chalk">{run.reason}</p>}
      <button type="button" disabled={short || !estimate || unsaved || scoring} onClick={go} className={buttonClass('primary', 'mt-5 h-12 px-5')}>
        {!short && estimate?.live && estimate.estimatedCalls > 0 ? `Score with Qloo · up to ${plural(estimate.maximumCalls, 'call', 'calls')}` : 'Score with Qloo'}
      </button>
    </section>
  );
}
