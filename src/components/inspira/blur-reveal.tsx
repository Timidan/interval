// React port of Inspira UI's Blur Reveal (MIT, rahulv.dev): children fade in from a blur when they scroll into view.
// The motion is a CSS transition switched on by an IntersectionObserver, so content never stays hidden if animation frames stall.
import { Children, useEffect, useRef, useState } from 'react';
import { cn } from 'cn';

type Props = { children: React.ReactNode; stagger?: number; className?: string };

export function BlurReveal({ children, stagger = 0.12, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => { setShown(true); stop(); };
    const check = () => { if (el.getBoundingClientRect().top < window.innerHeight * 0.88) reveal(); };
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) reveal(); }, { rootMargin: '0px 0px -12% 0px' });
    const stop = () => { io.disconnect(); window.removeEventListener('scroll', check); };
    io.observe(el);
    window.addEventListener('scroll', check, { passive: true });
    check();
    return stop;
  }, []);
  return (
    <div ref={ref} className={className}>
      {Children.toArray(children).map((child, i) => (
        <div key={i} className={cn('blur-reveal', shown && 'is-shown')} style={{ transitionDelay: shown ? `${i * stagger}s` : '0s' }}>{child}</div>
      ))}
    </div>
  );
}
