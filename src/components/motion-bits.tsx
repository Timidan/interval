// Pointer-driven motion kept outside React's render cycle (motion values), and off for touch and reduced motion.
import { useEffect, useRef } from 'react';
import { motion, useReducedMotion, useSpring } from 'motion/react';

const finePointer = () => window.matchMedia('(pointer: fine)').matches;

/** A control that leans a little toward the cursor. */
export function Magnetic({ children, strength = 0.22 }: { children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 160, damping: 16, mass: 0.3 });
  const y = useSpring(0, { stiffness: 160, damping: 16, mass: 0.3 });
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || !finePointer()) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x.set(Math.max(-14, Math.min(14, (e.clientX - r.left - r.width / 2) * strength)));
      y.set(Math.max(-10, Math.min(10, (e.clientY - r.top - r.height / 2) * strength)));
    };
    const leave = () => { x.set(0); y.set(0); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [reduce, strength, x, y]);
  return <motion.span ref={ref} style={{ x, y }} className="inline-block">{children}</motion.span>;
}

/** Tilts its contents a few degrees toward the cursor anywhere inside `area` (default: the nearest section). */
export function Tilt({ children, max = 3, className }: { children: React.ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rotateX = useSpring(0, { stiffness: 90, damping: 18 });
  const rotateY = useSpring(0, { stiffness: 90, damping: 18 });
  useEffect(() => {
    const el = ref.current;
    const area = el?.closest('section') ?? el;
    if (!el || !area || reduce || !finePointer()) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      rotateY.set(((e.clientX - r.left - r.width / 2) / window.innerWidth) * max * 2);
      rotateX.set(-((e.clientY - r.top - r.height / 2) / window.innerHeight) * max * 2);
    };
    const leave = () => { rotateX.set(0); rotateY.set(0); };
    area.addEventListener('pointermove', move as EventListener);
    area.addEventListener('pointerleave', leave);
    return () => { area.removeEventListener('pointermove', move as EventListener); area.removeEventListener('pointerleave', leave); };
  }, [reduce, max, rotateX, rotateY]);
  return <motion.div ref={ref} style={{ rotateX, rotateY, transformPerspective: 1400 }} className={className}>{children}</motion.div>;
}
