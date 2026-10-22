import { useEffect, useMemo, useRef, useState } from 'react';
import { LockSimple } from '@phosphor-icons/react';
import { cn } from 'cn';
import { bounds, concurrent, hourLabel, span, type Slot } from '@/lib/timetable';

type Variant = 'hero' | 'story' | 'full';

const SIZES: Record<Variant, { label: number; row: number; ruler: number; name: number; fit: boolean }> = {
  hero: { label: 96, row: 48, ruler: 28, name: 13.5, fit: true },
  story: { label: 108, row: 52, ruler: 30, name: 13, fit: true },
  full: { label: 140, row: 60, ruler: 34, name: 12.5, fit: false },
};

// Each state sets the event's colours (see `.event` in index.css). Red means a clash and green a moved set, as everywhere else.
type Tone = 'known' | 'unknown' | 'clash' | 'moved';
const TONES: Record<Tone, React.CSSProperties> = {
  known: { '--tone': 'var(--color-event)', '--tone-ink': 'var(--color-event-ink)' } as React.CSSProperties,
  unknown: { '--tone': 'var(--color-unknown)', '--tone-ink': 'var(--color-ink-2)', '--tone-solid': 'var(--color-ink-2)' } as React.CSSProperties,
  clash: { '--tone': 'var(--color-marker)', '--tone-ink': 'var(--color-marker-ink)' } as React.CSSProperties,
  moved: { '--tone': 'var(--color-cue)', '--tone-ink': 'var(--color-cue-ink)' } as React.CSSProperties,
};
const ZOOM = 'duration-[800ms] ease-push';

type Props = {
  sets: Slot[];
  stages: string[];
  /** Sets in a strong clash: Qloo links them and they overlap. */
  clashIds?: Set<string>;
  /** After a change is applied: where the moved sets used to be (drawn as dashed ghosts), keyed by set id. */
  ghosts?: Slot[];
  variant?: Variant;
  emphasis?: 'none' | 'holds';
  focusId?: string | null;
  /** The set the programmer clicked; the page owns it so it can act on the selection (hold, release). */
  pinned?: string | null;
  onPin?: (id: string | null) => void;
  /** Show only this time range (minutes after the programme day's midnight), filling the width.
   * Text stays the same size: changing the range zooms the way a calendar does, and blocks glide to their new places. */
  view?: { start: number; end: number } | null;
  className?: string;
};

/** The running order on paper: stages as rows, time left to right, every set sized to the minute. */
export function Sheet({ sets, stages, clashIds, ghosts, variant = 'full', emphasis = 'none', focusId = null, pinned = null, onPin, view = null, className }: Props) {
  const size = SIZES[variant];
  const interactive = variant === 'full';
  const { start, end } = useMemo(() => bounds(sets), [sets]);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth); // layout width, unaffected by the sheet's tilt
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Fonts and video posters change the page layout after first paint; measure again once they settle.
    document.fonts?.ready.then(measure);
    window.addEventListener('load', measure);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('load', measure); window.removeEventListener('resize', measure); };
  }, []);

  const fit = width ? (width - size.label) / (end - start) : 0.5;
  const origin = view?.start ?? start;
  const ppm = view ? Math.max(0.35, (width - size.label) / (view.end - view.start)) : size.fit ? Math.max(0.35, fit) : Math.max(2.2, fit);
  const timeline = view ? Math.max(0, width - size.label) : (end - start) * ppm;
  const hours = Math.round((end - start) / 60);

  const [hover, setHover] = useState<string | null>(null);
  const activeId = hover ?? pinned ?? focusId;
  const active = sets.find(s => s.id === activeId) ?? null;
  const together = useMemo(() => new Set(active ? concurrent(sets, active).map(s => s.id) : []), [sets, active]);

  const x = (min: number) => (min - origin) * ppm;
  const grid = { backgroundImage: 'linear-gradient(to right, var(--color-paper-line) 1px, transparent 1px)', backgroundSize: `${60 * ppm}px 100%`, backgroundPosition: `${x(start)}px 0` };

  const block = (s: Slot) => {
    const w = Math.max(4, (s.end - s.start) * ppm - 3);
    const isActive = s.id === activeId;
    const isTogether = together.has(s.id);
    const clash = clashIds?.has(s.id);
    const moved = ghosts?.some(g => g.id === s.id);
    const tone: Tone = clash ? 'clash' : moved ? 'moved' : s.b2b || s.unknown ? 'unknown' : 'known';
    const label = `${s.act}, ${s.stage}, ${span(s)}${s.held ? ', held' : ''}${moved ? ', moved' : ''}${s.b2b ? ', b2b set, identity unknown' : s.unknown ? ', identity unknown' : ''}${clash ? ', strong clash' : ''}`;
    const cls = cn(
      'event absolute top-1 bottom-1 overflow-hidden rounded-[7px] text-start transition-[left,width,opacity,background-color,color,box-shadow]', ZOOM,
      tone === 'unknown' && 'stripes',
      activeId && !isActive && !isTogether && 'opacity-35',
      !activeId && emphasis === 'holds' && !s.held && 'opacity-35',
      interactive && 'cursor-default focus-visible:z-10',
    );
    const style = { left: x(s.start) + 1.5, width: w, ...TONES[tone] };
    // A set that starts before the visible window keeps its text at the window's edge.
    const hidden = view ? Math.max(0, -(x(s.start) + 1.5)) : 0;
    const body = (
      <>
        <span aria-hidden="true" className="event-bar absolute inset-y-[5px] start-[4px] w-[3px] rounded-full" />
        <span className="block pe-2 pt-[5px]" style={{ paddingInlineStart: hidden + 12 }}>
          <span className="block truncate font-semibold leading-[1.2]" style={{ fontSize: size.name }}>{s.act}</span>
          {w - hidden >= 58 && (
            <span className="event-time mt-0.5 flex items-center gap-1 truncate text-[0.6875rem] leading-[1.2] tabular-nums">
              {span(s)}{s.held && <LockSimple aria-hidden="true" size={10} weight="fill" className="shrink-0" />}
            </span>
          )}
          {interactive && (clash || s.unknown) && w >= 40 && (
            <span className="mt-1 block truncate text-[0.6875rem] font-semibold leading-none">{clash ? 'Clash' : s.b2b ? 'b2b · unknown' : 'Unknown'}</span>
          )}
        </span>
      </>
    );
    return interactive ? (
      <button key={s.id} type="button" aria-label={label} aria-pressed={pinned === s.id} className={cls} style={style}
        data-selected={isActive || undefined} data-together={isTogether || undefined}
        onClick={() => onPin?.(pinned === s.id ? null : s.id)}
        onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(s.id)} onBlur={() => setHover(null)}>
        {body}
      </button>
    ) : (
      <div key={s.id} role="img" aria-label={label} className={cls} style={style} data-selected={isActive || undefined} data-together={isTogether || undefined}>{body}</div>
    );
  };

  return (
    <div className={cn('paper text-ink', className)}>
      <div ref={wrap} className={cn('relative', interactive && 'overflow-x-auto overscroll-x-contain')}>
        <div className="relative" style={{ width: size.label + timeline }}>
          <div className="flex" style={{ height: size.ruler }}>
            <div className={cn('shrink-0', interactive && 'sticky start-0 z-20 bg-paper')} style={{ width: size.label }} />
            <div className={cn('relative', view && 'overflow-hidden')} style={{ width: timeline }}>
              {Array.from({ length: hours + 1 }, (_, i) => i).filter(i => 60 * ppm >= 40 || i % 2 === 0).map(i => (
                <span key={i} className={cn('absolute top-0 text-[0.6875rem] font-medium text-ink-2/75 tabular-nums whitespace-nowrap transition-[left]', ZOOM, i === 0 && !view ? '' : '-translate-x-1/2')}
                  style={{ left: x(start + i * 60) }}>{hourLabel(start + i * 60)}</span>
              ))}
            </div>
          </div>
          {stages.map(st => (
            <div key={st} className="flex border-t border-paper-line" style={{ height: size.row }}>
              <div className={cn('flex shrink-0 items-center pe-3 font-medium leading-[1.15] text-ink-2', interactive ? 'sticky start-0 z-20 bg-paper text-[0.8125rem]' : 'text-[0.75rem]')}
                style={{ width: size.label }}>{st}</div>
              <div className={cn('relative transition-[background-size,background-position]', ZOOM, view && '[clip-path:inset(-12px_0_-12px_0)]')} style={{ width: timeline, ...grid }}>
                {ghosts?.filter(g => g.stage === st).map(g => (
                  <span key={`ghost-${g.id}`} aria-hidden="true" className={cn('pointer-events-none absolute top-1 bottom-1 rounded-[7px] border-[1.5px] border-dashed border-cue/75 transition-[left,width]', ZOOM)}
                    style={{ left: x(g.start) + 1.5, width: Math.max(4, (g.end - g.start) * ppm - 3) }} />
                ))}
                {sets.filter(s => s.stage === st).map(block)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {interactive && (
        <p aria-live="polite" className="mt-4 min-h-6 max-w-[72ch] text-pretty text-[0.875rem] leading-[1.6] text-ink-2">
          {active
            ? <><span className="font-semibold text-ink">{active.act}</span> · {active.stage} · <span className="tabular-nums">{span(active)}</span> · plays at the same time as {together.size} {together.size === 1 ? 'set' : 'sets'} on other stages.</>
            : null}
        </p>
      )}
    </div>
  );
}
