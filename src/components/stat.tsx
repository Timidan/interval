import { cn } from 'cn';
import { RollingNumber } from '@/components/rolling-number';

/** A counter. Real values roll; anything not calculated says so instead of showing zero. */
export function Stat({ label, value, note, className }: { label: string; value: number | null; note?: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="font-mono text-[0.6875rem] uppercase leading-4 tracking-[0.14em] text-chalk-2">{label}</p>
      {value === null
        ? <p className="mt-2 text-[1.125rem] font-medium leading-[1.2] text-chalk-2">Unavailable</p>
        : <RollingNumber value={String(value)} className="mt-1.5 font-display text-[clamp(1.875rem,3vw,2.625rem)] font-bold leading-none text-chalk" />}
      {note && <p className="mt-1 text-[0.75rem] text-chalk-2">{note}</p>}
    </div>
  );
}
