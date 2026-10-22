import { ArrowRight } from '@phosphor-icons/react';
import { cn } from 'cn';
import { RollingNumber } from '@/components/rolling-number';

/** A counter. Real values roll; anything not calculated says so instead of showing zero. `after` is where a previewed change takes it. */
export function Stat({ label, value, after, note, className }: { label: string; value: number | null; after?: number; note?: string; className?: string }) {
  const changes = value !== null && after !== undefined && after !== value;
  return (
    <div className={cn('min-w-0', className)}>
      <p className="min-h-8 font-mono text-[0.75rem] uppercase leading-4 tracking-[0.14em] text-chalk-2">{label}</p>
      {value === null
        ? <p className="mt-2 text-[1.125rem] font-medium leading-[1.2] text-chalk-2">Unavailable</p>
        : (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 font-display text-[clamp(1.875rem,3vw,2.625rem)] font-bold leading-none">
            <RollingNumber value={String(value)} className={changes ? 'text-chalk-2' : 'text-chalk'} />
            {changes && <><span className="sr-only">to</span><ArrowRight aria-hidden="true" weight="bold" className="size-[0.5em] text-chalk-2" /><RollingNumber value={String(after)} className="text-cue-dark" /></>}
          </p>
        )}
      {note && <p className="mt-1 text-[0.75rem] text-chalk-2">{note}</p>}
    </div>
  );
}
