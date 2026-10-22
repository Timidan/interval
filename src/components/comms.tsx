import { memo, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Headset, PaperPlaneRight, Play, WarningCircle } from '@phosphor-icons/react';
import { cn } from 'cn';
import AITaskList, { type AITask } from '@/components/smoothui/ai-task-list';
import { useStage } from '@/components/stage';
import { api, type AgentHealth, type AgentStep, type AgentTurn, type MessageRequest, type Recording, type Run } from '@/lib/api';

const TOOLS: Record<string, string> = {
  find_clashes: 'Find clashes between linked acts',
  apply_constraint: 'Apply a constraint',
  propose_repairs: 'Search for tested changes',
  explain_change: 'Explain a change',
  resolve_acts: 'Check artist identities',
  confirm_identity: 'Confirm an identity',
  score_lineup: 'Load Qloo evidence',
  run_baseline: 'Run a comparison',
};
const task = (s: AgentStep): AITask => ({
  id: s.id,
  label: s.kind === 'model' ? 'Plan the next step' : TOOLS[s.name ?? ''] ?? (s.name ?? 'Tool').replace(/_/g, ' '),
  note: s.kind === 'model' ? s.model : s.reason,
  status: s.status === 'running' ? 'running' : s.status === 'complete' ? 'done' : 'failed',
});
// A time on another day names the day, so "until 1:00" can't be read as later today.
const clockAt = (unix: number) => {
  const at = new Date(unix * 1000);
  return at.toLocaleString([], at.toDateString() === new Date().toDateString() ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};
const recorded = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const EXAMPLES = ['Keep both headliners where they are.', "I’d rather split the two biggest crowds."];

/** Example requests typed out over an empty input. Isolated so its ticks re-render only itself. */
const Typing = memo(function Typing() {
  const reduce = useReducedMotion();
  const { paused } = useStage();
  const still = reduce || paused;
  const [state, setState] = useState({ phrase: 0, length: 0, back: false });
  useEffect(() => {
    if (still) return;
    const text = EXAMPLES[state.phrase];
    const done = !state.back && state.length === text.length;
    const t = window.setTimeout(() => setState(s => {
      if (!s.back && s.length < text.length) return { ...s, length: s.length + 1 };
      if (!s.back) return { ...s, back: true };
      if (s.length > 0) return { ...s, length: s.length - 1 };
      return { phrase: (s.phrase + 1) % EXAMPLES.length, length: 0, back: false };
    }), done ? 2200 : state.back ? 22 : 48);
    return () => window.clearTimeout(t);
  }, [state, still]);
  const text = still ? EXAMPLES[state.phrase] : EXAMPLES[state.phrase].slice(0, state.length);
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-[1.0625rem] flex items-center text-base text-chalk-2 sm:text-[0.875rem]">
      {text}<span className="caret ms-px inline-block h-[1.1em] w-px bg-chalk/70" />
    </span>
  );
});

function Turn({ turn }: { turn: AgentTurn }) {
  return (
    <li className="rise space-y-3">
      <p className="ms-auto w-fit max-w-[90%] rounded-[3px] bg-chalk/10 px-3 py-2 text-[0.875rem] leading-[1.6] text-chalk">{turn.message}</p>
      {turn.mode === 'recorded' && <p className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-gel">Recorded answer · {recorded(turn.recordedAt)}</p>}
      {turn.steps.length > 0 && <AITaskList label="Steps" tasks={turn.steps.map(task)} className="rounded-[3px] bg-stage/50" />}
      {turn.segments.map((s, i) => (
        <p key={i} className={cn('text-[0.9375rem] leading-6', s.kind === 'question' ? 'text-gel' : 'text-chalk/90')}>{s.text}</p>
      ))}
      {turn.status === 'limited' && <p className="text-[0.875rem] leading-[1.6] text-chalk-2">The agent has reached its usage limit{turn.retry_at ? ` until ${clockAt(turn.retry_at)}` : ''}. Nothing was changed.</p>}
      {turn.status === 'unavailable' && <p className="text-[0.875rem] leading-[1.6] text-chalk-2">The agent is unavailable right now{turn.reason ? `: ${turn.reason}` : ''}. Nothing was changed.</p>}
      {turn.status === 'failed' && <p className="flex items-start gap-2 text-[0.875rem] leading-[1.6] text-chalk/90"><WarningCircle size={16} weight="bold" className="mt-1 shrink-0" />This request failed{turn.reason ? `: ${turn.reason}` : ''}. Any constraint it added is listed in its steps.</p>}
    </li>
  );
}

/** The agent's panel: it turns plain-words requests into constraints and repairs, and answers only with facts its tools returned. */
export function Comms({ run, send, className }: { run?: Run; send: (body: Omit<MessageRequest, 'expectedVersion'>) => Promise<unknown>; className?: string }) {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const turns = run?.agent?.turns ?? [];
  const thinking = run?.status === 'thinking';
  const last = turns.at(-1)?.status;

  useEffect(() => {
    let alive = true;
    api.agentHealth().then(h => alive && setHealth(h)).catch(() => alive && setHealth({ status: 'unavailable', retry_at: null }));
    return () => { alive = false; };
  }, [last]);
  useEffect(() => {
    if (!run) return;
    let alive = true;
    api.recordings(run.id).then(r => alive && setRecordings(r.recordings)).catch(() => {});
    return () => { alive = false; };
  }, [run?.id, run?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hermes can be up while Interval's own call budget is spent, so the latest refusal wins.
  const paused = health?.status === 'limited' || health?.status === 'unavailable';
  const status = last === 'limited' ? 'Limited' : !health ? 'Checking' : health.status === 'available' ? 'Available' : health.status === 'limited' ? `Limited${health.retry_at ? ` until ${clockAt(health.retry_at)}` : ''}` : 'Unavailable';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || thinking || !run) return;
    setDraft('');
    void send({ message });
  };

  return (
    <aside aria-label="Comms" className={cn('flex flex-col gap-4 rounded-[4px] border border-chalk/12 bg-haze/80 p-5 backdrop-blur-md', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Headset size={20} weight="duotone" className="text-gel" />
          <h2 className="font-display text-[0.875rem] font-bold uppercase tracking-[0.06em]">Comms</h2>
        </div>
        <span className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-chalk-2">{health?.model ?? 'Agent'} · {status}</span>
      </div>

      {turns.length === 0 && (
        <p className="text-[0.875rem] leading-[1.6] text-chalk-2">
          Ask for a change in plain words. The agent turns it into constraints, runs the search, and answers only with facts its tools returned.
        </p>
      )}
      {paused && (
        <p className="text-[0.875rem] leading-[1.6] text-chalk/90">
          {health.status === 'limited'
            ? `Live answers are paused: Interval’s model-call allowance is used up${health.retry_at ? ` until ${clockAt(health.retry_at)}` : ''}.`
            : 'Live answers are unavailable right now.'}
          {recordings.length > 0 ? ' The recorded answers below still replay.' : ' Recorded answers only replay on the exact running order and rules they were recorded on.'}
        </p>
      )}
      <ol aria-live="polite" aria-label="Conversation" className={cn('max-h-[52vh] space-y-5 overflow-y-auto overscroll-contain pe-1', !turns.length && 'hidden')}>
        {turns.map(t => <Turn key={t.id} turn={t} />)}
      </ol>

      {recordings.length > 0 && !thinking && (
        <div className="space-y-2">
          <p className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-chalk-2">Recorded answers</p>
          {recordings.map(r => (
            <button key={r.id} type="button" onClick={() => void send({ message: r.message, replayId: r.id })}
              className="group flex w-full items-start gap-2 rounded-[3px] border border-chalk/12 px-3 py-2 text-start text-[0.875rem] leading-5 text-chalk/90 transition-colors duration-200 ease-push hover:border-chalk/40">
              <Play size={14} weight="fill" className="mt-0.5 shrink-0 text-gel" />{r.message}
            </button>
          ))}
        </div>
      )}

      <form className="mt-auto" onSubmit={submit}>
        <label htmlFor="comms-ask" className="sr-only">Ask Interval</label>
        <div className="relative flex items-center gap-2 rounded-[3px] border border-chalk/12 bg-stage/60 p-1.5 transition-colors duration-300 focus-within:border-chalk/40 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gel">
          {!draft && !focused && !thinking && !paused && <Typing />}
          <input id="comms-ask" value={draft} onChange={e => setDraft(e.target.value)} disabled={!run || thinking || paused} maxLength={4000}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={focused ? 'For example: Keep both headliners where they are.' : ''}
            className="h-10 min-w-0 flex-1 bg-transparent px-2.5 text-base text-chalk placeholder:text-chalk-2 focus:outline-none disabled:opacity-50 sm:text-[0.875rem]" />
          <button type="submit" disabled={!run || thinking || paused || !draft.trim()} aria-label="Send"
            className="grid size-10 place-items-center rounded-[1px] bg-chalk/12 text-chalk transition-[background-color,scale] duration-150 ease-push hover:bg-chalk/20 active:scale-[0.96] disabled:bg-chalk/6 disabled:text-chalk-2 disabled:active:scale-100">
            <PaperPlaneRight size={16} weight="bold" />
          </button>
        </div>
        {thinking && <div aria-hidden="true" className="shimmer-dark mt-2 h-1 w-full rounded-full" />}
        <p className="mt-2 text-[0.75rem] leading-5 text-chalk-2">
          {thinking ? 'Working on it. Each step appears as it actually runs.' : paused ? 'Recorded answers say when they were recorded.' : 'Live answers come from gpt-5.6-luna. Recorded answers say when they were recorded.'}
        </p>
      </form>
    </aside>
  );
}
