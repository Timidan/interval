import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, Check, Eye, Intersect, LockSimple, LockSimpleOpen, MagnifyingGlass, Rows, Table, WarningCircle } from '@phosphor-icons/react';
import { cn } from 'cn';
import { buttonClass } from '@/components/button';
import AnimatedTabs from '@/components/smoothui/animated-tabs';
import { StageBackground } from '@/components/stage';
import { Comms } from '@/components/comms';
import { Comparison } from '@/components/comparison';
import { EvidenceDrawer } from '@/components/evidence-drawer';
import { Sheet } from '@/components/sheet';
import { Stat } from '@/components/stat';
import type { Clash, Repair, Run, SeedId, Slot as RunSlot, UnknownGuard } from '@/lib/api';
import { useRun } from '@/lib/use-run';
import { clock, concurrent, daySets, dayStages, festival, fromRun, overlapPairs, plural, sheetSlot, span, type Festival, type Slot } from '@/lib/timetable';

const SEEDS: Record<string, SeedId> = { '2026-10-02': 'acl-friday', '2026-10-16': 'iii-friday', '2026-10-17': 'iii-saturday' };
const at = (s: RunSlot) => clock(s.start - Date.parse(`${s.day}T00:00:00Z`) / 60000);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const longDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The running order as an Apple-style grouped list: one rounded group per stage, a state bar per set. */
function ListView({ sets, stages, clashIds, movedIds, pinned, onPin, actions }: { sets: Slot[]; stages: string[]; clashIds: Set<string>; movedIds: Set<string>; pinned: string | null; onPin: (id: string | null) => void; actions: (s: Slot) => React.ReactNode }) {
  const bar = (s: Slot) => (clashIds.has(s.id) ? 'bg-marker' : movedIds.has(s.id) ? 'bg-cue' : s.b2b || s.unknown ? 'bg-unknown' : 'bg-event');
  return (
    <div className="paper grid grid-cols-[minmax(0,1fr)] gap-6 text-ink sm:grid-cols-2 xl:grid-cols-3">
      {stages.map(st => (
        <section key={st}>
          <h3 className="px-1 pb-2 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-2">{st}</h3>
          <ul className="overflow-hidden rounded-[14px] bg-paper-2 ring-1 ring-paper-line/70">
            {sets.filter(s => s.stage === st).sort((a, b) => a.start - b.start).map(s => (
              <li key={s.id} className="border-b border-paper-line last:border-b-0">
                <button type="button" aria-pressed={pinned === s.id} onClick={() => onPin(pinned === s.id ? null : s.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors duration-150 hover:bg-paper-line/40 aria-pressed:bg-paper-line/50">
                <span aria-hidden="true" className={cn('w-[3px] self-stretch rounded-full', bar(s))} />
                <span className="w-[4.25rem] shrink-0 text-[0.8125rem] leading-[1.25] tabular-nums">
                  <span className="block font-medium text-ink">{clock(s.start)}</span>
                  <span className="block text-ink-2">{clock(s.end)}</span>
                </span>
                <span className="min-w-0 flex-1 text-pretty text-[0.9375rem] font-semibold leading-snug [overflow-wrap:anywhere]">{s.act}</span>
                {clashIds.has(s.id) && <span className="inline-flex shrink-0 items-center gap-1 text-[0.75rem] font-semibold text-marker-ink"><Intersect size={13} weight="bold" />Clash</span>}
                {s.held && <span className="inline-flex shrink-0 items-center gap-1 text-[0.75rem] font-medium text-ink-2"><LockSimple size={12} weight="fill" />Held</span>}
                {(s.b2b || s.unknown) && <span className="shrink-0 text-[0.75rem] font-medium text-ink-2">{s.b2b ? 'b2b · unknown' : 'Unknown'}</span>}
                </button>
                {pinned === s.id && (
                  <div className="space-y-2 px-3 pb-3 ps-[1.6875rem]">
                    <p className="text-[0.8125rem] leading-[1.6] text-ink-2">Plays at the same time as {plural(concurrent(sets, s).length, 'set', 'sets')} on other stages.</p>
                    {actions(s)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** What the colours mean, next to the calendar. Each state also carries a word in the sets themselves. */
function Legend({ moved, before }: { moved: boolean; before: string }) {
  const item = (swatch: string, text: string) => (
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={cn('size-2.5 rounded-[3px]', swatch)} />{text}</span>
  );
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] font-medium text-ink-2">
      {item('bg-event', 'Qloo identifies')}
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="event stripes size-2.5 rounded-[3px] ring-1 ring-unknown/40" style={{ '--tone': 'var(--color-unknown)' } as React.CSSProperties} />Unknown to Qloo</span>
      {item('bg-marker', 'Strong clash')}
      {moved && item('bg-cue', 'Moved')}
      {moved && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-cue/75" />{before}</span>}
      <span className="inline-flex items-center gap-1"><LockSimple aria-hidden="true" size={12} weight="fill" />Held</span>
    </p>
  );
}

const minutes = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'minute' : 'minutes'}`;
const unknownTotal = (before: number, after: number) => after === before ? `Their total stays at ${minutes(after)}.`
  : `Their total ${after < before ? 'falls' : 'rises'} from ${before.toLocaleString('en-US')} to ${minutes(after)}.`;

const panel = 'rounded-[4px] border border-chalk/12 bg-haze/80 p-5 backdrop-blur-md';

function Warnings({ run, strong, onOpen, onRule, busy }: { run: Run; strong: Clash[]; onOpen: (c: Clash) => void; onRule: (g: UnknownGuard) => void; busy: boolean }) {
  const unknown = run.metrics?.unknownClashes ?? 0;
  const net = run.schedule.unknownGuard === 'net';
  return (
    <section id="clash-warnings" aria-label="Clash warnings" className={cn(panel, 'scroll-mt-5')}>
      <h2 className="flex items-center gap-2 font-display text-[0.875rem] font-bold uppercase tracking-[0.06em]">
        <Intersect size={18} weight="duotone" className="text-marker-dark" />Clash warnings
      </h2>
      {!run.snapshot ? <p className="mt-3 text-[0.9375rem] text-chalk-2">Clash warnings need Qloo evidence, and none is loaded for this day.</p> : <>
        {strong.length ? (
          <ul className="mt-3 divide-y divide-chalk/10">
            {strong.map((c, i) => (
              <li key={c.setIds.join()} className="rise" style={{ '--i': i } as React.CSSProperties}>
                <button type="button" onClick={() => onOpen(c)} className="group flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-start">
                  <span className="font-narrow text-[1.375rem] font-semibold uppercase leading-tight">{c.acts[0]} × {c.acts[1]}</span>
                  <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-mono text-[0.75rem] text-chalk-2 tnum">{c.overlapMinutes} min overlap · Qloo link {(c.weight ?? 0).toFixed(2)}</span>
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-[3px] border border-gel/45 px-3 text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-gel transition-colors duration-150 group-hover:border-gel group-hover:bg-gel/10">
                      See Qloo evidence<ArrowRight aria-hidden="true" size={12} weight="bold" />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-[0.9375rem] text-chalk-2">No strong clash among the acts Qloo identifies.</p>}
        <p className="mt-2 text-[0.8125rem] leading-[1.6] text-chalk-2">
          {plural(unknown, 'overlapping pair includes', 'overlapping pairs include')} an act Qloo can’t identify. Interval counts them as unknown, never as safe.{' '}
          {net ? 'Looser rule in use: a tested change can’t grow their total overlap, though one pair can shift.' : 'Strict rule in use: a tested change can’t add overlap to any one of them.'}{' '}
          <button type="button" disabled={busy} onClick={() => onRule(net ? 'pair' : 'net')}
            className="font-medium text-chalk underline decoration-chalk/35 underline-offset-4 hover:decoration-chalk disabled:cursor-not-allowed disabled:opacity-45">
            {net ? 'Switch to the strict rule' : 'Switch to the looser rule'}
          </button>
        </p>
      </>}
    </section>
  );
}

function Proposal({ repair, n, total, shown, onShow, onApply }: { repair: Repair; n: number; total: number; shown: boolean; onShow: () => void; onApply: () => void }) {
  const unknown = repair.unknownChanges ?? [];
  const pairs = unknown.length <= 3 ? unknown.map(u => `${u.acts.join(' × ')} (${u.beforeMinutes} to ${u.afterMinutes} min)`).join(', ') : plural(unknown.length, 'pair', 'pairs');
  const rows: [string, number, number][] = [
    ['Strong clashes', repair.before.strongClashes, repair.after.strongClashes],
    ['Qloo-weighted clash minutes', Math.round(repair.before.cost), Math.round(repair.after.cost)],
    ['Overlaps with unknown acts', repair.before.unknownClashes, repair.after.unknownClashes],
  ];
  return (
    <section aria-label={`Tested change ${n} of ${total}`} className={cn(panel, 'rise')} style={{ '--i': n - 1 } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[0.875rem] font-bold uppercase tracking-[0.06em]">Tested change {n} of {total}</h2>
        {repair.validity.passed && <span className="inline-flex items-center gap-1.5 font-mono text-[0.75rem] uppercase tracking-[0.1em] text-cue-dark"><Check size={14} weight="bold" />Keeps every hold</span>}
      </div>
      <ul className="mt-4 space-y-2">
        {repair.changes.map(c => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-narrow text-[1.25rem] font-semibold uppercase leading-tight">{c.act}</span>
            <span className="inline-flex items-center gap-2 font-mono text-[0.75rem] text-chalk-2 tnum">
              {c.before.stage} {at(c.before)} <ArrowRight size={12} weight="bold" className="text-cue-dark" /> <span className="text-chalk">{c.after.stage} {at(c.after)}</span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-chalk/10 pt-4 min-[26rem]:grid-cols-3 min-[26rem]:gap-4">
        {rows.map(([label, before, after]) => (
          <div key={label}>
            <dt className="font-mono text-[0.75rem] uppercase leading-4 tracking-[0.12em] text-chalk-2">{label}</dt>
            <dd className="mt-1 font-display text-[1.25rem] font-bold tnum">{before} <span className="text-chalk-2">to</span> {after}</dd>
          </div>
        ))}
      </dl>
      {unknown.length > 0 && (
        <p className="mt-3 text-[0.8125rem] leading-[1.6] text-chalk-2">
          {repair.unknownGuard === 'net' ? 'Looser rule: overlap' : 'Overlap'} with acts Qloo can’t identify changes for {pairs}.{' '}
          {unknownTotal(repair.before.unknownMinutes, repair.after.unknownMinutes)}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onApply} className={buttonClass('primary', 'h-11 px-5')}>Apply this change</button>
        <button type="button" aria-pressed={shown} onClick={onShow} className={buttonClass('ghost', cn('h-11 px-4', shown && 'border-chalk/70 bg-chalk/10'))}>
          <Eye size={16} weight={shown ? 'fill' : 'bold'} />Show on the sheet
        </button>
      </div>
    </section>
  );
}

/** Strong clashes once a proposal is applied: the ledger lists every strongly linked pair the change touches; the rest keep their state. */
function clashesAfter(strong: Clash[], repair: Repair) {
  const key = (ids: string[]) => [...ids].sort().join();
  const after = new Map(repair.ledger.map(l => [key(l.setIds), l.afterMinutes > 0]));
  const ids = new Set<string>();
  for (const c of strong) if (after.get(key(c.setIds)) ?? true) c.setIds.forEach(id => ids.add(id));
  for (const l of repair.ledger) if (l.afterMinutes > 0) l.setIds.forEach(id => ids.add(id));
  return ids;
}

const applyPill = 'inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[0.8125rem] font-semibold text-paper transition-[background-color,scale] duration-150 hover:bg-ink/85 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45';
const capsule = 'inline-flex h-10 items-center gap-2 rounded-full bg-paper-2 px-4 text-[0.8125rem] font-semibold text-ink ring-1 ring-paper-line transition-[background-color,scale] duration-150 hover:bg-paper-line/60 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45';

export function SheetPage() {
  // An imported running order arrives as `?run=<id>`; without it the page shows the seeded festivals.
  const [runId] = useState(() => new URLSearchParams(window.location.search).get('run'));
  const [fid, setFid] = useState<Festival['id']>('acl');
  const f = festival(fid);
  const [picked, setDay] = useState<string | null>(null);
  const [view, setView] = useState<'sheet' | 'list'>(() => (window.matchMedia('(max-width: 767px)').matches ? 'list' : 'sheet'));
  const seedDay = f.days.find(d => d.id === picked)?.id ?? f.days[0].id;
  const { run, busy, error, act, send } = useRun(runId ? { runId } : { seedId: SEEDS[seedDay] });
  const days = runId ? [...new Set(run?.schedule.stages.map(s => s.day))].sort().map(id => ({ id, label: weekday(id).slice(0, 3) })) : f.days;
  const day = runId ? days.find(d => d.id === picked)?.id ?? days[0]?.id ?? '' : seedDay;
  const [evidence, setEvidence] = useState<Clash | null>(null);
  const [ghosts, setGhosts] = useState<{ seed: string; slots: Slot[] } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  // The proposal drawn on the sheet: undefined follows the first one found, null shows the draft.
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const shownGhosts = ghosts && ghosts.seed === run?.id && run?.canUndo ? ghosts.slots.filter(g => g.day === day) : undefined;
  // The page behind the drawer is inert while it's open, so the opener is remembered here and refocused after it closes.
  const opener = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const openEvidence = useCallback((c: Clash) => { opener.current = document.activeElement as HTMLElement | null; setEvidence(c); }, []);
  const closeEvidence = useCallback(() => { flushSync(() => setEvidence(null)); opener.current?.focus(); }, []);

  const local = useMemo(() => (runId ? [] : daySets(f, day)), [runId, f, day]);
  const current = useMemo(() => (run ? fromRun(run, day) : { sets: local, stages: dayStages(f, local) }), [run, day, f, local]);
  const preview = run?.repairs.length && pick !== null ? run.repairs.find(r => r.id === pick) ?? run.repairs[0] : null;
  const previewN = preview && run ? run.repairs.indexOf(preview) + 1 : 0;
  const { sets, stages } = useMemo(() => (run && preview ? fromRun(run, day, preview.slots) : current), [run, day, preview, current]);
  const strong = useMemo(() => (run?.clashes ?? []).filter(c => c.weight != null && c.weight >= 0.9), [run]);
  const clashIds = useMemo(() => (preview ? clashesAfter(strong, preview) : new Set(strong.flatMap(c => c.setIds))), [strong, preview]);
  const sheetGhosts = preview ? preview.changes.filter(c => c.before.day === day).map(c => sheetSlot(c.before)) : shownGhosts;
  const pairs = useMemo(() => overlapPairs(current.sets), [current]);
  const b2b = sets.filter(s => s.b2b).length;
  const selected = view === 'sheet' && !preview ? sets.find(s => s.id === pinned) ?? null : null;
  const canRepair = !!run && !busy && !!run.metrics && (run.status === 'ready' || run.status === 'none_found' || run.status === 'failed');
  const strict = run?.schedule.unknownGuard !== 'net';
  const repairStatus = !run ? '' : run.status === 'searching' ? 'Searching for tested changes.'
    : run.status === 'none_found' ? 'No tested change found.'
    : run.status === 'failed' ? 'The search didn’t finish.'
    : run.repairs.length ? `${plural(run.repairs.length, 'tested change', 'tested changes')} found.${preview ? ` The sheet shows change ${previewN}, not applied.` : ''}`
    : shownGhosts ? 'Change applied.' : '';

  const reset = () => { setPinned(null); setPick(undefined); setNotice(''); };
  const holdControl = (s: Slot) => s.unknown
    ? <p className="text-[0.8125rem] leading-[1.6] text-ink-2">Qloo can’t identify {s.act}, so Interval never moves this set.</p>
    : (
      <button type="button" disabled={busy} onClick={() => hold(s)} className={capsule}>
        {s.held ? <LockSimpleOpen aria-hidden="true" size={15} weight="bold" /> : <LockSimple aria-hidden="true" size={15} weight="bold" />}
        {s.held ? `Release ${s.act}` : `Hold ${s.act} here`}
      </button>
    );
  const apply = async (r: Repair) => {
    if (run && await act({ type: 'apply', expectedVersion: run.version, repairId: r.id })) { setGhosts({ seed: run.id, slots: r.changes.map(c => sheetSlot(c.before)) }); setPick(undefined); setNotice(''); }
  };
  const repair = (unknownGuard?: UnknownGuard) => {
    if (!run) return;
    reset();
    void act(unknownGuard ? { type: 'repair', expectedVersion: run.version, unknownGuard } : { type: 'repair', expectedVersion: run.version });
  };
  const rule = async (value: UnknownGuard) => {
    if (!run) return;
    if (await act({ type: 'constraint', expectedVersion: run.version, expectedConstraintVersion: run.constraintVersion, constraint: { kind: 'unknown_guard', value } }))
      setNotice(value === 'net' ? 'Looser rule in use. Repair to search with it.' : 'Strict rule in use. Repair to search with it.');
  };
  const hold = async (s: Slot) => {
    if (!run) return;
    if (await act({ type: 'constraint', expectedVersion: run.version, expectedConstraintVersion: run.constraintVersion, constraint: { kind: 'lock', setIds: [s.id], holds: s.held ? [] : ['exact'] } }))
      setNotice(s.held ? `${s.act} can move again. Repair to use the change.` : `${s.act} is held where it is. Repair to plan around it.`);
  };

  return (
    <div className="relative min-h-[100dvh]">
      <a href="#running-order" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:rounded-[3px] focus:bg-chalk focus:px-4 focus:py-3 focus:text-[0.8125rem] focus:font-semibold focus:text-ink">Skip to the running order</a>
      <div inert={evidence ? true : undefined}>
      <StageBackground dim={0.7} />
      <header className="rise mx-auto flex max-w-[112rem] flex-wrap items-center gap-x-5 gap-y-3 px-5 pt-5" style={{ '--i': 0 } as React.CSSProperties}>
        <a href="/" className="inline-flex items-center gap-2.5 font-display text-[1rem] font-extrabold uppercase tracking-[0.06em] text-chalk">
          <ArrowLeft size={16} weight="bold" className="text-chalk-2" />Interval
        </a>
        {runId ? (
          <span className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-chalk-2">Your running order</span>
        ) : (
          <AnimatedTabs label="Festival" variant="underline" activeTab={fid} onChange={id => { setFid(id as Festival['id']); setDay(null); reset(); }}
            tabs={[{ id: 'acl', label: 'ACL · Weekend 1' }, { id: 'iii', label: 'III Points' }]} />
        )}
        {(!runId || days.length > 1) && <AnimatedTabs label="Day" variant="underline" activeTab={day} onChange={d => { setDay(d); reset(); }} tabs={days.map(d => ({ id: d.id, label: d.label }))} />}
        <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:ms-auto sm:w-auto sm:flex-nowrap">
          <AnimatedTabs label="View" variant="underline" activeTab={view} onChange={v => { setView(v as 'sheet' | 'list'); setPinned(null); }}
            tabs={[{ id: 'sheet', label: 'Sheet', icon: <Table size={15} /> }, { id: 'list', label: 'List', icon: <Rows size={15} /> }]} />
          <div className="flex flex-col items-end">
            <button type="button" disabled={!canRepair} aria-describedby="repair-why" onClick={() => repair()}
              className={buttonClass('primary', 'h-12 whitespace-nowrap px-5')}>
              <Intersect size={16} weight="bold" />{run?.status === 'searching' ? 'Searching…' : 'Repair running order'}
            </button>
            <span id="repair-why" className="mt-1.5 font-mono text-[0.75rem] uppercase tracking-[0.1em] text-chalk-2">
              {run ? `Moves up to ${plural(run.schedule.k, 'set', 'sets')} · keeps every hold` : error ? 'Qloo evidence unavailable' : 'Loading Qloo evidence'}
            </span>
          </div>
        </div>
      </header>

      <section className="rise mx-auto mt-8 grid max-w-[112rem] grid-cols-2 gap-6 px-5 sm:grid-cols-3 lg:grid-cols-5" style={{ '--i': 1 } as React.CSSProperties}>
        <Stat label="Sets" value={current.sets.length} />
        <Stat label="Overlapping pairs" value={pairs} />
        <Stat label="Acts Qloo identifies" value={run ? run.coverage.confirmed : null} note={run ? `of ${run.coverage.acts} ${runId ? 'in this running order' : 'on this day'}` : undefined} />
        <Stat label="Strong clashes" value={run?.metrics ? run.metrics.strongClashes : null} after={preview?.after.strongClashes} note={run?.metrics ? 'Linked acts playing at once' : 'Needs Qloo evidence'} />
        <Stat label="Qloo-weighted clash minutes" value={run?.metrics ? Math.round(run.metrics.cost) : null} after={preview ? Math.round(preview.after.cost) : undefined} note={run?.metrics ? 'Overlap minutes × how closely Qloo links the acts' : 'Needs Qloo evidence'} />
      </section>

      <main id="running-order" tabIndex={-1} className="rise mx-auto mt-8 grid max-w-[112rem] grid-cols-[minmax(0,1fr)] gap-5 px-5 pb-24 lg:grid-cols-[minmax(0,1fr)_23rem]" style={{ '--i': 2 } as React.CSSProperties}>
        <div className="min-w-0 space-y-5">
          <div ref={card} className="paper scroll-mt-5 rounded-[22px] bg-paper p-4 shadow-[0_1px_1px_oklch(0_0_0_/_0.08),0_36px_80px_-30px_oklch(0.122_0.009_268.083_/_0.95)] ring-1 ring-paper-line/60 sm:p-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 text-ink">
              <h1 className="leading-none">
                <span className="block text-[clamp(1.75rem,2.6vw,2.25rem)] font-semibold tracking-[-0.02em]">{day ? weekday(day) : 'Running order'}</span>
                <span className="mt-2 block text-[0.875rem] font-normal text-ink-2">{day ? longDate(day) : 'Loading'} · {runId ? 'Imported running order' : `${f.name} · ${f.edition}`}</span>
              </h1>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                {preview && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-cue/12 px-3 py-1 text-[0.75rem] font-semibold text-cue-ink">
                    <Eye aria-hidden="true" size={13} weight="bold" />Preview of tested change {previewN} · not applied
                  </span>
                )}
                {!preview && strong.length === 1 && (
                  <button type="button" onClick={() => openEvidence(strong[0])} className="inline-flex items-center gap-1.5 rounded-full bg-marker/10 px-3 py-1.5 text-[0.75rem] font-semibold text-marker-ink ring-1 ring-marker/25 transition-colors duration-150 hover:bg-marker/15">
                    <Intersect aria-hidden="true" size={13} weight="bold" />Strong clash: {strong[0].acts.join(' × ')} · See evidence
                  </button>
                )}
                {!preview && strong.length > 1 && (
                  <a href="#clash-warnings" className="inline-flex items-center gap-1.5 rounded-full bg-marker/10 px-3 py-1.5 text-[0.75rem] font-semibold text-marker-ink ring-1 ring-marker/25 transition-colors duration-150 hover:bg-marker/15">
                    <Intersect aria-hidden="true" size={13} weight="bold" />{strong.length} strong clashes · See the list
                  </a>
                )}
                <Legend moved={!!sheetGhosts?.length} before={preview ? 'Where it plays now' : 'Where it was'} />
              </div>
            </div>
            {preview && run && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[14px] bg-cue/10 px-4 py-3 text-ink ring-1 ring-cue/25">
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold leading-snug">
                    {preview.changes.map(c => `${c.act} ${c.before.stage === c.after.stage ? '' : `${c.before.stage} → ${c.after.stage}, `}${at(c.before)} → ${at(c.after)}`).join(' · ')}
                  </p>
                  <p className="mt-1 text-[0.8125rem] leading-snug text-ink-2 tnum">
                    Strong clashes {preview.before.strongClashes} → {preview.after.strongClashes} · weighted minutes {Math.round(preview.before.cost)} → {Math.round(preview.after.cost)}{preview.validity.passed ? ' · keeps every hold' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => void apply(preview)} className={applyPill}><Check aria-hidden="true" size={15} weight="bold" />Apply this change</button>
                  {run.repairs.length > 1 && (
                    <button type="button" onClick={() => setPick(run.repairs[previewN % run.repairs.length].id)} className={capsule}>
                      Next change <span className="font-normal text-ink-2 tnum">{previewN % run.repairs.length + 1} of {run.repairs.length}</span>
                    </button>
                  )}
                  <button type="button" onClick={() => setPick(null)} className={capsule}>Hide preview</button>
                </div>
              </div>
            )}
            {!preview && run && (run.status === 'searching' || run.status === 'none_found' || run.status === 'failed') && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[14px] bg-paper-2 px-4 py-3 text-ink ring-1 ring-paper-line">
                {run.status === 'searching' ? <p className="font-mono text-[0.8125rem] text-ink-2">Searching tested changes that keep every hold…</p> : (
                  <>
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] font-semibold leading-snug">{run.status === 'none_found' ? 'No tested change found' : run.reason ?? 'The search stopped early.'}</p>
                      <p className="mt-1 max-w-[72ch] text-pretty text-[0.8125rem] leading-snug text-ink-2">
                        {run.status === 'none_found' ? `${run.reason ?? ''} ` : ''}The draft stays as it is.
                        {run.status === 'none_found' && (strict ? ' The strict rule rejects any change that adds overlap to a pair with an act Qloo can’t identify; the looser rule only stops their total overlap from growing.' : ' Releasing a hold gives the search more room.')}
                      </p>
                    </div>
                    {(run.status === 'failed' || strict) && (
                      <button type="button" disabled={!canRepair} onClick={() => repair(run.status === 'failed' ? undefined : 'net')} className={capsule}>
                        <MagnifyingGlass aria-hidden="true" size={15} weight="bold" />{run.status === 'failed' ? 'Search again' : 'Search again with the looser rule'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {!preview && run?.canUndo && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[14px] bg-paper-2 px-4 py-3 text-ink ring-1 ring-paper-line">
                <p className="text-[0.875rem] leading-snug text-ink-2">{shownGhosts ? 'Change applied. Dashed outlines show where the moved sets were; green shows where they play now.' : 'A tested change is applied.'}</p>
                <button type="button" disabled={busy} onClick={() => { setNotice(''); void act({ type: 'undo', expectedVersion: run.version }); }} className={capsule}>
                  <ArrowCounterClockwise aria-hidden="true" size={15} weight="bold" />Undo the last change
                </button>
              </div>
            )}
            {runId && !run ? (
              <div role="status" aria-label="Loading the running order" className="space-y-3">
                {[0, 1, 2, 3].map(i => <div key={i} className="shimmer h-12 rounded-[7px]" />)}
              </div>
            ) : view === 'sheet'
              ? (
                <>
                  <a href="#after-sheet" className="sr-only focus:not-sr-only focus:mb-3 focus:inline-block focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-[0.8125rem] focus:font-semibold focus:text-paper">Skip past the timetable</a>
                  <Sheet key={`${fid}-${day}`} sets={sets} stages={stages} clashIds={clashIds} ghosts={sheetGhosts} variant="full" pinned={pinned} onPin={setPinned} />
                  <span id="after-sheet" tabIndex={-1} />
                </>
              )
              : <ListView sets={sets} stages={stages} clashIds={clashIds} movedIds={new Set(sheetGhosts?.map(g => g.id))} pinned={pinned} onPin={setPinned} actions={s => (run && !preview ? holdControl(s) : null)} />}
            {selected && run && <div className="mt-1 flex flex-wrap items-center gap-3">{holdControl(selected)}</div>}
          </div>

          {error && <p role="alert" className="flex items-start gap-2.5 rounded-[4px] border border-chalk/25 bg-stage/70 px-4 py-3 text-[0.9375rem] leading-6 text-chalk"><WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" />{error}</p>}
          {run ? <Warnings run={run} strong={strong} onOpen={openEvidence} onRule={rule} busy={busy} /> : !error && (
            <div role="status" aria-label="Loading Qloo evidence" className={cn(panel, 'space-y-3')}>
              <div className="shimmer-dark h-4 w-44 rounded-[2px]" />
              <div className="shimmer-dark h-6 w-2/3 rounded-[2px]" />
              <div className="shimmer-dark h-3 w-full rounded-[2px]" />
            </div>
          )}
          {run?.repairs.map((r, i) => <Proposal key={r.id} repair={r} n={i + 1} total={run.repairs.length} shown={preview?.id === r.id}
            onShow={() => {
              const show = preview?.id !== r.id;
              setPick(show ? r.id : null);
              if (show) card.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            }}
            onApply={() => void apply(r)} />)}

          {!runId && <Comparison seedId={SEEDS[day]} />}

          {runId ? (
            <p className="max-w-[72ch] text-pretty text-[0.8125rem] leading-[1.6] text-chalk-2">
              Imported from your CSV. {run?.assumptions.map(a => `${a}.`).join(' ')}
              {run?.snapshot ? ` Qloo: snapshot fetched ${date(run.snapshot.fetchedAt)}, covering the acts you confirmed. Striped grey sets are acts it can’t identify, so their pairs stay unknown.` : ''}{' '}
              <a className="underline decoration-chalk/30 underline-offset-4 hover:text-chalk" href="/import">Import another draft</a>
            </p>
          ) : (
          <p className="max-w-[72ch] text-pretty text-[0.8125rem] leading-[1.6] text-chalk-2">
            Timetable: <a className="underline decoration-chalk/30 underline-offset-4 hover:text-chalk" href={f.sourceUrl} target="_blank" rel="noreferrer">{f.source}</a>, verified {f.verified}. Retrospective scenario. {f.holds}.
            {f.notShown ? ` ${f.notShown}.` : ''}
            {run?.snapshot ? ` Qloo: saved snapshot fetched ${date(run.snapshot.fetchedAt)}, covering the acts it can identify. Striped grey sets are acts it can’t, so their pairs stay unknown.` : ' Qloo snapshot: not loaded.'}
            {b2b ? ` ${plural(b2b, 'b2b set is', 'b2b sets are')} striped too: their artists are never merged into one Qloo identity.` : ''}{' '}
            <a className="underline decoration-chalk/30 underline-offset-4 hover:text-chalk" href="/import">Import a draft</a> to try your own lineup.
          </p>
          )}
        </div>
        <Comms run={run} send={send} className="lg:sticky lg:top-5 lg:self-start" />
      </main>
      </div>
      <p role="status" className="sr-only">{notice || repairStatus}</p>
      {evidence && run && <EvidenceDrawer runId={run.id} clash={evidence} onClose={closeEvidence} />}
    </div>
  );
}
