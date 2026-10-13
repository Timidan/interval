import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Pause, Play } from '@phosphor-icons/react';
import { cn } from 'cn';
import { ShaderToy } from '@/components/inspira/shader-toy';

/** Shared GLSL: real stage-light footage (Mixkit, "Colored spotlights in a stage"), cover-fitted to the viewport and graded
 * into the stage palette. `q` is a viewport position (0–1, origin bottom left) and `view` the viewport size. */
export const STAGE_LIGHT = /* glsl */ `
uniform sampler2D iChannel0;
uniform vec2 iChannel0Size;
uniform float uClock;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec2 footageUv(vec2 q, vec2 view) {
  vec2 uv = q * 0.94 + 0.03 + vec2(sin(uClock * 0.07), cos(uClock * 0.05)) * 0.008;
  float sr = view.x / view.y;
  float vr = iChannel0Size.x / max(iChannel0Size.y, 1.0);
  if (sr > vr) { float s = vr / sr; uv.y = uv.y * s + (1.0 - s) * 0.5; }
  else { float s = sr / vr; uv.x = uv.x * s + (1.0 - s) * 0.5; }
  return uv;
}
vec3 tap(vec2 uv) { return texture(iChannel0, clamp(uv, 0.001, 0.999)).rgb; }

// The footage with a hint of lens split and a ring of bloom, graded toward blue-black shadows and warm work-light highlights.
vec3 stageLight(vec2 q, vec2 view) {
  vec2 uv = footageUv(q, view);
  vec3 col = vec3(tap(uv + vec2(0.0012, 0.0)).r, tap(uv).g, tap(uv - vec2(0.0012, 0.0)).b);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = 6.2831853 * float(i) / 8.0;
    glow += tap(uv + vec2(cos(a), sin(a)) * vec2(0.018, 0.032));
  }
  col = col * 0.55 + glow / 8.0 * 0.75;
  float l = luma(col);
  vec3 graded = mix(vec3(0.020, 0.026, 0.045), vec3(0.12, 0.17, 0.30), smoothstep(0.02, 0.35, l));
  graded = mix(graded, vec3(1.0, 0.86, 0.62), smoothstep(0.35, 1.0, l));
  return mix(graded, col, 0.38);
}

// Haze drifting up through the light. p is measured in viewport heights.
float haze(vec2 p) { return fbm(p * 2.2 + vec2(uClock * 0.015, -uClock * 0.05)); }
`;

const STAGE_SHADER = /* glsl */ `
uniform float uDim;
uniform float uExposure;
${STAGE_LIGHT}
// Highlights roll off below this luma, so no frame of the footage can wash out text on top (worst case 4.7:1 for captions).
const float CEILING = 0.34;
void mainImage(out vec4 c, in vec2 f) {
  vec2 q = f / iResolution.xy;
  vec3 col = stageLight(q, iResolution.xy);
  float l = luma(col);
  col += vec3(1.0, 0.9, 0.78) * haze(f / iResolution.y) * (0.025 + 0.22 * l);

  // Keep text readable: pull the light toward the upper right, darken the edges.
  float v = smoothstep(1.25, 0.2, length((q - vec2(0.66, 0.62)) * vec2(1.0, 1.25)));
  float side = mix(0.42, 1.0, smoothstep(0.05, 0.62, q.x));
  col *= mix(0.22, 1.0, v) * side * uDim * uExposure;

  // Like a camera that never blows out: compress highlights softly under the ceiling and warm what gets compressed,
  // so a flare reads as tungsten haze rather than white glare.
  float lum = luma(col);
  float soft = CEILING * (1.0 - exp(-lum / CEILING));
  col *= soft / max(lum, 1e-4);
  float squeeze = clamp(1.0 - soft / max(lum, 1e-4), 0.0, 1.0);
  col = mix(col, vec3(luma(col)) * vec3(1.25, 0.95, 0.62), 0.6 * squeeze);

  // Film grain.
  col += (hash(f + fract(iTime) * 100.0) - 0.5) * 0.035;
  c = vec4(max(col, 0.0), 1.0);
}
`;

type Stage = { paused: boolean; setPaused: (p: boolean) => void; video: HTMLVideoElement | null; setVideo: (v: HTMLVideoElement | null) => void };
const StageContext = createContext<Stage>({ paused: false, setPaused: () => {}, video: null, setVideo: () => {} });
export const useStage = () => useContext(StageContext);

export function StageProvider({ children }: { children: React.ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // One switch for every ambient loop on the page (WCAG 2.2.2): CSS loops read this attribute.
  useEffect(() => {
    if (paused) document.documentElement.dataset.motion = 'paused';
    else delete document.documentElement.dataset.motion;
  }, [paused]);
  return <StageContext.Provider value={{ paused, setPaused, video, setVideo }}>{children}</StageContext.Provider>;
}

/** Keeps a decorative video in step with the page's pause control and the reduced-motion setting. */
export function useStageVideo(video: HTMLVideoElement | null) {
  const { paused } = useStage();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!video) return;
    if (paused || reduce) video.pause();
    else video.play().catch(() => {});
  }, [video, paused, reduce]);
  return { stopped: paused || !!reduce };
}

// Median brightness of the footage (16x9 probe, measured 2026-10-13); frames brighter than this get less exposure.
const FOOTAGE_MEDIAN = 0.381;

/** Reads the video's brightness a few times a second and eases exposure down when the footage flares. Never brightens. */
function useAutoExposure(video: HTMLVideoElement | null) {
  const state = useRef({ target: 1, value: 1 });
  useEffect(() => {
    if (!video) return;
    const probe = document.createElement('canvas');
    probe.width = 16; probe.height = 9;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    const read = () => {
      if (!ctx || video.readyState < video.HAVE_CURRENT_DATA) return;
      ctx.drawImage(video, 0, 0, 16, 9);
      const d = ctx.getImageData(0, 0, 16, 9).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const mean = sum / (255 * 144);
      state.current.target = Math.min(1, Math.max(0.5, (FOOTAGE_MEDIAN / Math.max(mean, 0.01)) ** 0.75));
    };
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [video]);
  return useCallback(() => {
    const s = state.current;
    s.value += (s.target - s.value) * 0.08;
    return { uExposure: s.value };
  }, []);
}

export function StageBackground({ dim = 0.9 }: { dim?: number }) {
  const { paused, setPaused, video, setVideo } = useStage();
  const reduce = useReducedMotion();
  const [webgl, setWebgl] = useState(true);
  const { stopped } = useStageVideo(video);
  const uniforms = useRef({ uDim: dim, uExposure: 1 }).current;
  const exposure = useAutoExposure(video);

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-stage">
        <video
          ref={setVideo}
          src="/media/stage-beams.mp4"
          poster="/media/stage-beams.jpg"
          muted loop playsInline autoPlay={!stopped} preload="auto"
          className={cn('absolute inset-0 size-full object-cover', webgl && !reduce ? 'opacity-0' : 'opacity-60 [filter:saturate(0.55)_brightness(0.42)_sepia(0.3)]')}
        />
        {webgl && !reduce && (
          <ShaderToy className="absolute inset-0" shaderCode={STAGE_SHADER} video={video} uniforms={uniforms} onFrame={exposure}
            frameRate={30} pixelRatio={0.85} paused={paused} onError={() => setWebgl(false)} />
        )}
        <div className="absolute inset-x-0 bottom-0 h-[40vh] bg-gradient-to-b from-transparent to-stage/80" />
      </div>
      <div aria-hidden="true" className="grain-overlay" />
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? 'Play motion' : 'Pause motion'}
        className="fixed end-3 bottom-3 z-40 inline-flex size-11 items-center justify-center gap-2 rounded-[3px] border border-chalk/20 bg-stage/70 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-chalk-2 backdrop-blur transition-[color,border-color,scale] duration-200 ease-push hover:border-chalk/50 hover:text-chalk active:scale-[0.96] motion-reduce:hidden sm:end-4 sm:bottom-4 sm:w-auto sm:px-4"
      >
        <span className="relative grid size-4 place-items-center">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={paused ? 'play' : 'pause'} className="absolute inset-0 grid place-items-center"
              initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
              {paused ? <Play size={16} weight="fill" /> : <Pause size={16} weight="fill" />}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="hidden sm:inline">{paused ? 'Play motion' : 'Pause motion'}</span>
      </button>
    </>
  );
}
