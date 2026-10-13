import { cn } from 'cn';

const DIGITS = '0123456789';

/** Money and prices that roll digit by digit when they change (Number Flow pattern). Non-digits stay still. */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('inline-flex tnum', className)} aria-label={value} role="text">
      {value.split('').map((char, i) => {
        const digit = DIGITS.indexOf(char);
        if (digit < 0) return <span key={`${i}-${char}`} aria-hidden="true" className="inline-block h-[1.15em] leading-[1.15]">{char}</span>;
        return (
          <span key={i} aria-hidden="true" className="relative inline-block h-[1.15em] overflow-hidden leading-[1.15]">
            <span className="block transition-transform duration-500 ease-out-quint" style={{ transform: `translateY(-${digit * 10}%)` }}>
              {DIGITS.split('').map(d => <span key={d} className="block">{d}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
