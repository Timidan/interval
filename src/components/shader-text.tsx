// Display type lit by the stage: the footage behind the page lights the letters too, with the same bloom, haze and grain.
// The DOM text stays for selection and screen readers, and shows whenever the shader isn't drawing.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from 'cn';
import { ShaderToy } from '@/components/inspira/shader-toy';
import { STAGE_LIGHT, useStage } from '@/components/stage';

const PAD = 56; // room around the letters for the halo, in CSS pixels

const TEXT_SHADER = /* glsl */ `
uniform sampler2D iChannel1;
uniform vec2 uOrigin; // this canvas's top left on the viewport, in CSS pixels
uniform vec2 uView;   // viewport size in CSS pixels
${STAGE_LIGHT}
float ink(vec2 uv) { return texture(iChannel1, uv).a; }

void mainImage(out vec4 c, in vec2 f) {
  vec2 uv = f / iResolution.xy;
  vec2 css = vec2(iResolution.z) / iResolution.xy; // one CSS pixel, in uv
  float m = ink(uv);
  float halo = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = 1.5707963 * float(i) + 0.785;
    halo += textureLod(iChannel1, uv + vec2(cos(a), sin(a)) * css * 7.0, 4.5).a;
  }
  halo *= 0.25;
  if (m < 0.002 && halo < 0.004) { c = vec4(0.0); return; }

  // The same light that falls on the background at this point of the viewport.
  vec2 s = uOrigin + vec2(f.x, iResolution.y - f.y) / iResolution.z;
  vec3 L = stageLight(vec2(s.x / uView.x, 1.0 - s.y / uView.y), uView);
  float l = luma(L);

  // Lamp-white letters: never too dark to read, hotter and tinted where a beam crosses them.
  vec3 lamp = vec3(0.965, 0.937, 0.894);
  vec3 fill = lamp * (0.86 + 0.30 * l) + L * 0.6;
  fill = mix(fill, fill * 0.82 + vec3(1.0, 0.9, 0.78) * 0.2, haze(vec2(s.x, uView.y - s.y) / uView.y) * 0.5);
  float glow = halo * (0.28 + 0.6 * l);
  vec3 col = fill * m + mix(lamp, L * 1.6, 0.55) * (0.35 + 1.1 * l) * glow * (1.0 - m);
  float a = max(m, glow);
  col += (hash(f + fract(iTime) * 100.0) - 0.5) * 0.06 * a;
  c = vec4(clamp(col / max(a, 0.001), 0.0, 1.0), a);
}
`;

export function ShaderText({ lines, className }: { lines: string[]; className?: string }) {
  const { paused, video } = useStage();
  const reduce = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const live = !reduce && !failed;
  const on = live && drawn && !paused;
  const key = lines.join('\n');

  // Draw the letters into a canvas the size of the shader's, exactly where the DOM lays them out.
  useLayoutEffect(() => {
    if (!live) return;
    let alive = true;
    const paint = async () => {
      const el = box.current, gl = layer.current;
      // Word by word, at each word's laid-out position, so lines that wrap on narrow screens still line up.
      const spans = el ? [...el.querySelectorAll<HTMLElement>('[data-word]')] : [];
      if (!gl || !spans.length) return;
      const cs = getComputedStyle(spans[0]);
      const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      await document.fonts?.load(font).catch(() => []);
      const w = gl.clientWidth, h = gl.clientHeight;
      if (!alive || !w || !h) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(canvas.width / w, canvas.height / h);
      ctx.font = font;
      if (cs.letterSpacing !== 'normal' && 'letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing;
      ctx.fillStyle = '#fff';
      const origin = gl.getBoundingClientRect();
      for (const span of spans) {
        const r = span.getBoundingClientRect();
        const text = (span.textContent ?? '').toUpperCase();
        ctx.fillText(text, r.left - origin.left, r.top - origin.top + ctx.measureText(text).fontBoundingBoxAscent);
      }
      setMask(canvas);
    };
    paint();
    // Web fonts can arrive after the first paint without changing the box size, so repaint when any finish loading.
    document.fonts?.addEventListener('loadingdone', paint);
    const ro = new ResizeObserver(() => paint());
    if (box.current) ro.observe(box.current);
    window.addEventListener('resize', paint);
    return () => {
      alive = false;
      document.fonts?.removeEventListener('loadingdone', paint);
      ro.disconnect();
      window.removeEventListener('resize', paint);
    };
  }, [key, live, dpr]);

  const onFrame = useCallback(() => {
    const r = layer.current?.getBoundingClientRect();
    const view = document.documentElement;
    return { uOrigin: [r?.left ?? 0, r?.top ?? 0], uView: [view.clientWidth, view.clientHeight] };
  }, []);

  return (
    <span className={cn('relative block', className)}>
      <span ref={box} data-shader-text={on ? 'on' : 'off'} className="block transition-[color] duration-700 ease-push">
        {lines.map((l, i) => (
          <span key={i} data-line className="block">
            {l.split(' ').map((w, j) => <span key={j}>{j > 0 && ' '}<span data-word>{w}</span></span>)}
          </span>
        ))}
      </span>
      {live && (
        <div ref={layer} aria-hidden="true" style={{ inset: -PAD }}
          className={cn('pointer-events-none absolute transition-opacity duration-700 ease-push', on ? 'opacity-100' : 'opacity-0')}>
          <ShaderToy className="absolute inset-0" shaderCode={TEXT_SHADER} video={video} channel1={mask} pixelRatio={dpr} frameRate={30}
            paused={paused} onFrame={onFrame} onDrawn={() => setDrawn(true)} onError={() => setFailed(true)} />
        </div>
      )}
    </span>
  );
}
