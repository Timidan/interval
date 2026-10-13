import { cn } from 'cn';

/** Squared, uppercase, tracked: the button grammar of club and festival sites (Boiler Room, Awakenings, Sónar).
 * The primary is lamp white so the only saturated colour on the page stays the clash red. */
export function buttonClass(variant: 'primary' | 'ghost' | 'link' = 'primary', className?: string) {
  return cn(
    'group inline-flex items-center gap-3 font-sans text-[0.8125rem] font-semibold uppercase tracking-[0.16em] transition-[background-color,border-color,box-shadow,color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:translate-y-0 active:scale-[0.96]',
    variant === 'primary' && 'h-13 rounded-[3px] bg-chalk px-6 text-ink shadow-[0_16px_36px_-16px_oklch(0.122_0.009_268.083_/_0.9)] hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_22px_44px_-18px_oklch(0.122_0.009_268.083_/_0.95)]',
    variant === 'ghost' && 'h-13 rounded-[3px] border border-chalk/30 bg-stage/30 px-6 text-chalk shadow-[inset_0_1px_0_oklch(0.955_0.016_79.351_/_0.08)] backdrop-blur-sm hover:border-chalk/70 hover:bg-chalk/10',
    variant === 'link' && 'h-13 px-1 text-chalk/80 underline decoration-chalk/30 underline-offset-[6px] hover:text-chalk hover:decoration-chalk',
    'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:scale-100',
    className,
  );
}

/** The arrow that slides on hover inside a button. */
export const arrowClass = 'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1';
