import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Graph, Intersect, LockSimple, ArrowsLeftRight, Rows } from '@phosphor-icons/react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform, useVelocity } from 'motion/react';
import { cn } from 'cn';
import { arrowClass, buttonClass } from '@/components/button';
import { useComparison } from '@/components/comparison';
import { BlurReveal } from '@/components/inspira/blur-reveal';
import { Magnetic, Tilt } from '@/components/motion-bits';
import { RollingNumber } from '@/components/rolling-number';
import { ShaderText } from '@/components/shader-text';
import { StageBackground } from '@/components/stage';
import { Sheet } from '@/components/sheet';
import { Stat } from '@/components/stat';
import { api, type PairEvidence } from '@/lib/api';
import { bounds, clock, concurrent, daySets, dayStages, festival, fromRun, overlapPairs, plural, span, type Slot } from '@/lib/timetable';
import { useRun } from '@/lib/use-run';

export const PRODUCT_SENTENCE = "Interval helps festival programmers fix draft running orders: Qloo’s taste graph flags linked acts that clash, and Interval proposes a few tested changes that keep every hold.";

const QLOO_REQUEST = `GET /v2/insights
  filter.type=urn:entity:artist
  signal.interests.entities={act}
  filter.results.entities={every other act}`;

type View = { start: number; end: number } | null;
type Step = { icon: React.ReactNode; title: string; body: React.ReactNode; view: View; label: string; emphasis?: 'holds'; focusId?: string | null;
  /** The running order after a tested change, drawn in place of the draft: moved sets glide, dashed ghosts keep their old places. */
  after?: { sets: Slot[]; ghosts: Slot[]; clashIds: Set<string> } };
const order = (i: number) => ({ '--i': i }) as React.CSSProperties;

const closeness = (rank: number) => (rank === 1 ? 'closest' : rank === 2 ? 'second-closest' : rank === 3 ? 'third-closest' : `${rank}th-closest`);

function useNarrow() {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** True once the element has come into view (with a scroll check where IntersectionObserver is throttled). */
function useSeen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const check = () => { if (el.getBoundingClientRect().top < window.innerHeight * 0.8) setSeen(true); };
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { threshold: 0.3 });
    io.observe(el);
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => { io.disconnect(); window.removeEventListener('scroll', check); };
  }, [seen]);
  return [ref, seen] as const;
}

/** What Qloo says about the pair, in words: each act's rank in the other's row. */
function useClashReading(runId: string | undefined, ref: string | undefined) {
  const [evidence, setEvidence] = useState<PairEvidence | null>(null);
  useEffect(() => {
    if (!runId || !ref) return;
    let alive = true;
    api.evidence(runId, ref).then(e => alive && setEvidence(e)).catch(() => {});
    return () => { alive = false; };
  }, [runId, ref]);
  return useMemo(() => {
    const [a, b] = evidence?.directions ?? [];
    if (!a || !b) return null;
    const rank = (d: typeof a) => d.row.findIndex(r => r.act === d.candidate) + 1;
    const [ra, rb] = [rank(a), rank(b)];
    if (!ra || !rb) return null;
    return ra === rb
      ? `Qloo ranks each as the other’s ${closeness(ra)} act of the ${a.rowPopulation} it scored on this bill.`
      : `Qloo ranks ${a.candidate} as ${a.source}'s ${closeness(ra)} act and ${b.candidate} as ${b.source}'s ${closeness(rb)}.`;
  }, [evidence]);
}

/** A calendar card: a day title in the Apple Calendar manner, with the festival beneath and a status on the trailing edge. */
function Paper({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[22px] bg-paper p-4 shadow-[0_1px_1px_oklch(0_0_0_/_0.08),0_36px_80px_-28px_oklch(0.122_0.009_268.083_/_0.95)] ring-1 ring-paper-line/60 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 text-ink">
        <div>
          <p className="text-[1.375rem] font-semibold leading-none tracking-[-0.01em]">Friday</p>
          <p className="mt-1.5 text-[0.8125rem] text-ink-2">Austin City Limits · Weekend 1 · Oct 2, 2026</p>
        </div>
        <span className="text-[0.8125rem] font-medium text-ink-2 tabular-nums">{label}</span>
      </div>
      {children}
    </div>
  );
}

/** The real lineup as a moving band. Type encodes Qloo's coverage: solid if Qloo identifies the act, outline if not, red for the clash. */
function LineupMarquee({ sets, clashIds }: { sets: Slot[]; clashIds: Set<string> }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const skewX = useSpring(useTransform(velocity, [-2500, 0, 2500], [7, 0, -7]), { stiffness: 220, damping: 40 });
  const acts = useMemo(() => {
    const seen = new Map<string, Slot>();
    for (const s of [...sets].sort((a, b) => a.start - b.start)) if (!seen.has(s.act)) seen.set(s.act, s);
    return [...seen.values()];
  }, [sets]);
  const tone = (s: Slot) => (sets.some(t => t.act === s.act && clashIds.has(t.id)) ? 'text-marker-dark' : s.unknown || s.b2b ? 'outline-type' : 'text-chalk');
  return (
    <section aria-labelledby="lineup" className="marquee-wrap relative overflow-hidden border-y border-chalk/10 py-9">
      <h2 id="lineup" className="sr-only">The Friday lineup</h2>
      <p className="sr-only">{acts.map(s => s.act).join(', ')}</p>
      <motion.div aria-hidden="true" style={reduce ? undefined : { skewX }}>
        <div className="marquee flex w-max items-center font-display text-[clamp(2rem,4.8vw,4.5rem)] font-extrabold uppercase leading-none tracking-[-0.02em]">
          {[0, 1].map(copy => (
            <span key={copy} className="flex items-center">
              {acts.map(s => (
                <span key={`${copy}-${s.id}`} className="flex items-center">
                  <span className={tone(s)}>{s.act}</span>
                  <span className="mx-[0.6em] inline-block size-[0.16em] rounded-full bg-chalk/35" />
                </span>
              ))}
            </span>
          ))}
        </div>
      </motion.div>
      <p className="mx-auto mt-7 flex max-w-[92rem] flex-wrap gap-x-6 gap-y-1 px-5 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-chalk-2 sm:px-8">
        <span>Solid: Qloo identifies the act</span><span>Outline: it can’t</span><span className="text-marker-dark">Red: the strongest clash</span>
      </p>
    </section>
  );
}

/** The product's claim in two real numbers: overlaps in the published day, and how many Qloo links strongly. */
function Statement({ pairs, strong, unknown }: { pairs: number; strong: number | null; unknown: number | null }) {
  const [ref, seen] = useSeen<HTMLElement>();
  const pad = (n: number) => String(n).replace(/\d/g, '0');
  return (
    <section ref={ref} aria-label="What Qloo changes" className="mx-auto grid max-w-[92rem] grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-12 px-5 py-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:py-36">
      <div>
        <RollingNumber value={seen ? String(pairs) : pad(pairs)} className="outline-type font-display text-[clamp(6rem,17vw,16rem)] font-extrabold leading-[0.9] tracking-[-0.05em]" />
        <p className="mt-2 font-display text-[clamp(1.125rem,1.7vw,1.625rem)] font-bold uppercase leading-tight">Overlapping pairs, as published</p>
      </div>
      <div className="lg:pb-2">
        {strong == null
          ? <p className="max-w-[30rem] text-[1.0625rem] leading-[1.6] text-chalk-2">The saved Qloo snapshot couldn’t be loaded, so this page can’t say which overlaps matter.</p>
          : <>
              <RollingNumber value={seen ? String(strong) : pad(strong)} className="font-display text-[clamp(6rem,17vw,16rem)] font-extrabold leading-[0.9] tracking-[-0.05em] text-marker-dark" />
              <p className="mt-2 font-display text-[clamp(1.125rem,1.7vw,1.625rem)] font-bold uppercase leading-tight">{strong === 1 ? 'Pair Qloo links strongly' : 'Pairs Qloo links strongly'}</p>
              <p className="mt-6 max-w-[32rem] text-[1.0625rem] leading-[1.6] text-chalk/80">
                Most overlaps are fine. Interval flags the pairs Qloo’s taste graph links strongly{unknown ? `, and treats the ${plural(unknown, 'overlap', 'overlaps')} involving acts Qloo can’t identify as unknown, never as safe` : ''}.
              </p>
            </>}
      </div>
    </section>
  );
}

export function Landing() {
  const acl = festival('acl');
  const day = acl.days[0].id;
  const narrow = useNarrow();
  const { run } = useRun({ seedId: 'acl-friday' });
  const live = useMemo(() => (run ? fromRun(run, day) : null), [run, day]);
  const sets = useMemo(() => live?.sets ?? daySets(acl, day), [live, acl, day]);
  const stageNames = useMemo(() => live?.stages ?? dayStages(acl, sets), [live, acl, sets]);
  const pairs = useMemo(() => overlapPairs(sets), [sets]);
  const busiest = useMemo(() => sets.map(s => ({ s, n: concurrent(sets, s).length })).sort((a, b) => b.n - a.n)[0], [sets]);
  const held = sets.filter(s => s.held);
  const strongClashes = useMemo(() => (run?.clashes ?? []).filter(c => (c.weight ?? 0) >= 0.9).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)), [run]);
  const clash = strongClashes[0] ?? null;
  const clashIds = useMemo(() => new Set(clash?.setIds ?? []), [clash]);
  const clashSets = sets.filter(s => clashIds.has(s.id));
  const reading = useClashReading(run?.id, clash?.evidenceRef);
  const { data: prepared } = useComparison('acl-friday');
  const row = (kind: string, guard?: string) => prepared?.rows.find(r => r.kind === kind && r.available && r.metrics && (!guard || r.unknownGuard === guard));
  const original = row('original'), strictRow = row('interval', 'pair'), looser = row('interval', 'net');
  const llm = prepared?.rows.filter(r => r.kind === 'llm_only' && r.available && r.metrics) ?? [];
  // The prepared looser-rule change, drawn on the live sets (their ids match the comparison's only when the run loaded).
  const after = useMemo(() => {
    if (!live || !looser?.changes.length) return null;
    const local = (m: { day: string; start: number; duration: number }) => { const start = m.start - Date.parse(`${m.day}T00:00:00Z`) / 60000; return { start, end: start + m.duration }; };
    const moved = new Map(looser.changes.map(c => [c.setId, c]));
    const shifted = sets.map(s => { const c = moved.get(s.id); return c ? { ...s, stage: c.after.stage, ...local(c.after) } : s; });
    const ghosts = sets.filter(s => moved.has(s.id)).map(s => ({ ...s, ...local(moved.get(s.id)!.before) }));
    return { sets: shifted, ghosts, clashIds: looser.metrics!.strongClashes ? clashIds : new Set<string>() };
  }, [live, looser, sets, clashIds]);
  const shift = looser?.changes.map(c => {
    const d = c.after.start - c.before.start;
    return `moving ${c.act} ${Math.abs(d)} minutes ${d > 0 ? 'later' : 'earlier'}${c.after.stage !== c.before.stage ? ` to ${c.after.stage}` : ''}`;
  }).join(' and ');

  // A window around some sets, on quarter hours, inside the day.
  const day0 = bounds(sets);
  const around = (focus: Slot[], pad: number): View => focus.length ? {
    start: Math.max(day0.start, Math.floor((Math.min(...focus.map(s => s.start)) - pad) / 15) * 15),
    end: Math.min(day0.end + 30, Math.ceil((Math.max(...focus.map(s => s.end)) + pad) / 15) * 15),
  } : null;
  const pad = narrow ? 20 : 50;
  const clashView = around(clashSets.length ? clashSets : [busiest.s], pad);

  const steps: Step[] = [
    {
      icon: <Rows size={22} weight="duotone" />,
      title: 'The draft',
      view: null,
      label: 'Running order',
      body: (
        <>
          <p>Friday at Austin City Limits, as published.</p>
          <div className="mt-8 grid grid-cols-3 gap-6">
            <Stat label="Sets" value={sets.length} />
            <Stat label="Stages" value={stageNames.length} />
            <Stat label="Overlaps" value={pairs} />
          </div>
        </>
      ),
    },
    {
      icon: <Intersect size={22} weight="duotone" />,
      title: 'Most overlaps are fine',
      view: around([busiest.s], pad + 10),
      label: `${busiest.s.act} · ${span(busiest.s)}`,
      focusId: busiest.s.id,
      body: <p>{busiest.s.act} alone overlaps {plural(busiest.n, 'set', 'sets')} on other stages, and festival-goers expect that. The overlaps that hurt are the ones between acts whose audiences overlap too.</p>,
    },
    {
      icon: <Graph size={22} weight="duotone" />,
      title: 'Qloo says which ones matter',
      view: clashView,
      label: clash ? 'Clash warning' : 'Qloo evidence unavailable',
      body: (
        <>
          <p>For every act, one Qloo request scores it against every other act on the bill. Pairs the taste graph links strongly become clash warnings, each with the scores behind it.</p>
          <pre className="mt-6 overflow-x-auto rounded-[3px] border border-chalk/15 bg-stage/70 p-4 font-mono text-[0.8125rem] leading-[1.6] text-chalk">{QLOO_REQUEST}</pre>
          <p className="mt-4 text-chalk-2">
            {clash
              ? <>On this Friday that’s {clash.acts[0]} and {clash.acts[1]}, who overlap by {clash.overlapMinutes} minutes. {reading} Qloo identifies {run?.coverage.confirmed} of the {run?.coverage.acts} acts.</>
              : "This page couldn’t load the saved Qloo snapshot, so no clash is marked."}
          </p>
        </>
      ),
    },
    {
      icon: <LockSimple size={22} weight="duotone" />,
      title: 'Some slots never move',
      view: around(held, pad),
      label: 'Holds: inferred',
      emphasis: 'holds',
      body: <p>Interval never moves a hold. On a published timetable it infers them and says so: {held.map(s => s.act).join(' and ')} stay where they are, and every other set can only move within its stage size and billing band.</p>,
    },
    {
      icon: <ArrowsLeftRight size={22} weight="duotone" />,
      title: 'A few tested changes',
      view: clashView,
      label: after ? 'Prepared change · looser rule' : 'Tested changes',
      after: after ?? undefined,
      body: (
        <>
          <p>Interval moves at most four sets, checks every change against every hold, and shows what each one fixes before anything is applied.</p>
          {original && strictRow && looser && shift ? (
            <>
              <p className="mt-4">
                No change may grow the total overlap with acts Qloo can’t identify. Here, {shift} {looser.metrics!.strongClashes ? 'eases the clashes' : 'clears the clash'}: {Math.round(original.metrics!.cost)} Qloo-weighted clash minutes to {Math.round(looser.metrics!.cost)}, with every hold kept.
                {strictRow.moved ? '' : ' A stricter rule, which protects each of those pairs on its own, finds no change on this Friday.'}
              </p>
              {llm.length > 0 && (
                <p className="mt-4 text-chalk-2">
                  {Math.min(...llm.map(r => r.metrics!.cost)) >= original.metrics!.cost
                    ? `None of the ${plural(llm.length, 'LLM-only trial', 'LLM-only trials')}, given the same timetable and rules but no Qloo scores, lowered those ${Math.round(original.metrics!.cost)} minutes.`
                    : `The best of ${plural(llm.length, 'LLM-only trial', 'LLM-only trials')}, given the same timetable and rules but no Qloo scores, reached ${Math.round(Math.min(...llm.map(r => r.metrics!.cost)))}.`}
                  {' '}Prepared {new Date(prepared!.frozenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
                </p>
              )}
            </>
          ) : <p className="mt-4 text-chalk-2">It never shows a change it didn’t calculate.</p>}
        </>
      ),
    },
  ];

  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    // The step nearest the middle of the screen is the active one.
    const pick = () => {
      const mid = window.innerHeight / 2;
      let best = 0, bestDistance = Infinity;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestDistance) { bestDistance = d; best = i; }
      });
      setActive(best);
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => { window.removeEventListener('scroll', pick); window.removeEventListener('resize', pick); };
  }, []);
  const step = steps[active];
  const story = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: story, offset: ['start 55%', 'end 55%'] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <div className="relative overflow-x-clip">
      <StageBackground />

      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-[92rem] items-center justify-between px-5 pt-6 sm:px-8">
          <a href="/" className="font-display text-[1.125rem] font-extrabold uppercase tracking-[0.06em] text-chalk">Interval</a>
          <nav aria-label="Main" className="flex items-center gap-2 sm:gap-6">
            <a href="#how" className="hidden text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-chalk/75 transition-colors duration-300 hover:text-chalk sm:inline">How it works</a>
            <a href="/import" className="hidden text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-chalk/75 transition-colors duration-300 hover:text-chalk md:inline">Import a draft</a>
            {/* Below 352px the hero's own button is the way in, so the nav one steps aside instead of wrapping. */}
            <a href="/sheet" className={buttonClass('ghost', 'hidden h-11 whitespace-nowrap px-3 text-[0.75rem] tracking-[0.12em] min-[22rem]:inline-flex sm:px-4')}>Running order</a>
          </nav>
        </div>
      </header>

      <main id="main">
      <section className="relative mx-auto grid min-h-[100dvh] max-w-[92rem] grid-cols-[minmax(0,1fr)] gap-12 px-5 pt-28 pb-14 sm:px-8 lg:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)] lg:gap-10 lg:pt-24">
        <div className="@container lg:self-end">
          <h1 className="rise font-display text-[min(13.6cqi,8rem)] font-extrabold uppercase leading-[0.86] tracking-[-0.03em] text-chalk" style={order(1)}>
            <ShaderText lines={['Fix the', 'clashes']} />
          </h1>
          <p className="rise mt-8 max-w-[34rem] text-[clamp(1rem,1.2vw,1.1875rem)] leading-[1.6] text-chalk/80" style={order(2)}>{PRODUCT_SENTENCE}</p>
          <div className="rise mt-9" style={order(3)}>
            <Magnetic>
              <a href="/sheet" className={buttonClass('primary', 'whitespace-nowrap max-[24rem]:px-5 max-[24rem]:tracking-[0.1em]')}>Open the running order <ArrowRight size={16} weight="bold" className={arrowClass} /></a>
            </Magnetic>
          </div>
        </div>

        <div className="relative min-w-0 lg:self-start">
          <div aria-hidden="true" className="pointer-events-none absolute -inset-x-20 -top-40 h-[150%] bg-[radial-gradient(55%_50%_at_50%_32%,oklch(0.94_0.067_86.64_/_0.18),transparent_72%)]" />
          <div className="rise-side" style={order(2)}>
            <Tilt max={2.5}>
              <div className="float">
                <figure className="relative">
                  <Paper label={clashView ? `${clock(clashView.start, false)}–${clock(clashView.end)}` : 'Running order'}>
                    <Sheet sets={sets} stages={stageNames} clashIds={clashIds} variant="hero" view={clashView} />
                  </Paper>
                  <figcaption className="sr-only">An excerpt of the published ACL Friday running order{clash ? `, with a clash warning on ${clash.acts.join(' and ')}` : ''}.</figcaption>
                </figure>
              </div>
            </Tilt>
          </div>
          {clash && (
            <aside aria-label="Clash warning" className="rise relative z-10 -mt-4 ms-auto me-4 block max-w-[26rem] rounded-[18px] border border-marker-dark/45 bg-stage/90 p-5 shadow-[0_24px_60px_-20px_oklch(0.122_0.009_268.083_/_0.95),inset_0_1px_0_oklch(0.955_0.016_79.351_/_0.06)] backdrop-blur-md sm:me-8" style={order(4)}>
              <p className="flex items-center gap-2 font-mono text-[0.75rem] font-medium uppercase tracking-[0.14em] text-marker-dark"><Intersect size={14} weight="bold" />Clash warning</p>
              <p className="mt-2 font-narrow text-[1.5rem] font-semibold uppercase leading-tight text-chalk">{clash.acts[0]} × {clash.acts[1]}</p>
              <p className="mt-1.5 text-[0.9375rem] leading-6 text-chalk/80">{clash.overlapMinutes} minutes at the same time. {reading ?? 'Qloo links them strongly.'}</p>
            </aside>
          )}
        </div>
      </section>

      <LineupMarquee sets={sets} clashIds={clashIds} />
      <Statement pairs={pairs} strong={run ? strongClashes.length : null} unknown={run ? run.metrics?.unknownClashes ?? 0 : null} />

      <section id="how" ref={story} className="mx-auto grid max-w-[92rem] grid-cols-[minmax(0,1fr)] gap-10 px-5 pb-32 sm:px-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-16">
        <div className="relative">
          <div aria-hidden="true" className="absolute top-0 bottom-0 -start-5 hidden w-px bg-chalk/10 lg:block">
            <motion.div className="absolute inset-0 origin-top bg-chalk/70" style={{ scaleY: progress }} />
          </div>
          {steps.map((st, i) => (
            <article key={st.title} ref={el => { refs.current[i] = el; }} data-step={i}
              className={cn('flex flex-col justify-center py-10 transition-opacity duration-300 ease-push lg:min-h-[78vh]', active === i ? 'opacity-100' : 'lg:opacity-35')}>
              <BlurReveal>
                <div className="mb-4 flex items-end gap-4">
                  <span aria-hidden="true" className={cn('font-display text-[4.5rem] font-extrabold leading-[0.8] transition-colors duration-500', active === i ? 'text-chalk' : 'outline-type')}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="mb-1 text-gel">{st.icon}</span>
                </div>
                <h2 className="font-display text-[clamp(1.5rem,2.1vw,2rem)] font-bold uppercase leading-[1.08]">{st.title}</h2>
                <div className="mt-5 text-[1.0625rem] leading-[1.6] text-chalk/85">{st.body}</div>
              </BlurReveal>
              <Paper label={st.label} className="mt-8 lg:hidden">
                <Sheet sets={st.after?.sets ?? sets} ghosts={st.after?.ghosts} stages={stageNames} clashIds={st.after?.clashIds ?? (i >= 2 ? clashIds : undefined)} variant="story" view={st.view}
                  emphasis={st.emphasis} focusId={st.focusId ?? null} />
              </Paper>
            </article>
          ))}
        </div>
        <div className="relative hidden lg:block">
          <div className="sticky top-[10vh]">
            <Paper label={step.label}>
              <Sheet sets={step.after?.sets ?? sets} ghosts={step.after?.ghosts} stages={stageNames} clashIds={step.after?.clashIds ?? (active >= 2 ? clashIds : undefined)} variant="story" view={step.view}
                emphasis={step.emphasis} focusId={step.focusId ?? null} />
            </Paper>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[92rem] px-5 pb-28 sm:px-8">
        <h2 className="font-display text-[clamp(2.25rem,7.4vw,5.75rem)] font-extrabold uppercase leading-[0.9] tracking-[-0.03em] text-chalk">
          <ShaderText lines={['See the whole', 'Friday']} />
        </h2>
        <p className="mt-6 max-w-[40rem] text-[1.125rem] leading-[1.6] text-chalk/85">Open the running order, switch to III Points, and select any set to see what plays against it. Or import your own draft as CSV.</p>
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Magnetic>
            <a href="/sheet" className={buttonClass('primary', 'whitespace-nowrap max-[24rem]:px-5 max-[24rem]:tracking-[0.1em]')}>Open the running order <ArrowRight size={16} weight="bold" className={arrowClass} /></a>
          </Magnetic>
          <a href="/import" className={buttonClass('link')}>Import a draft</a>
        </div>
      </section>

      </main>

      <footer className="mx-auto max-w-[92rem] border-t border-chalk/10 px-5 py-8 text-[0.8125rem] leading-[1.6] text-chalk-2 sm:px-8">
        <p className="max-w-[72ch] text-pretty">Interval, built for the Qloo Agentic Hackathon. Real timetables from official festival sources, verified Oct 12, 2026; Qloo evidence from saved snapshots. A retrospective scenario: it doesn’t claim any organiser got anything wrong. Stage footage: Mixkit.</p>
      </footer>
    </div>
  );
}
