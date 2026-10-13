// React port of Inspira UI's ShaderToy component (MIT, rahulv.dev), with an optional video channel and image channel.
import { useEffect, useRef } from 'react';
import { Texture } from 'ogl';
import { cn } from 'cn';
import { InspiraShaderToy, type ShaderUniforms } from '@/lib/inspira-shader-toy';

type Props = {
  shaderCode: string;
  uniforms?: ShaderUniforms;
  /** Sampled as `iChannel0`, with its size in `iChannel0Size`. */
  video?: HTMLVideoElement | null;
  /** A still canvas sampled as `iChannel1` (mipmapped). Pass a new canvas to replace it. */
  channel1?: HTMLCanvasElement | null;
  /** Called before every frame; the uniforms it returns are applied to that frame. */
  onFrame?: () => ShaderUniforms;
  /** Called once a frame has been drawn with the current `channel1`. */
  onDrawn?: () => void;
  frameRate?: number;
  pixelRatio?: number;
  paused?: boolean;
  className?: string;
  onError?: (message: string) => void;
};

/** Runs a Shadertoy-style fragment shader on a full-size canvas. Stops while off-screen or when the tab is hidden. */
export function ShaderToy({ shaderCode, uniforms, video, channel1, onFrame, onDrawn, frameRate = 60, pixelRatio = 1, paused = false, className, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ inView: true, visible: true, paused });
  const shaderRef = useRef<InspiraShaderToy | null>(null);
  const latest = useRef({ channel1, onFrame, onDrawn });
  live.current.paused = paused;
  latest.current = { channel1, onFrame, onDrawn };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let shader: InspiraShaderToy;
    try {
      shader = new InspiraShaderToy(el, 'hover', frameRate, pixelRatio);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'WebGL 2 is unavailable');
      return;
    }
    shaderRef.current = shader;
    const gl = shader.context;
    const blank = () => new Texture(gl, { image: new Uint8Array([0, 0, 0, 0]), width: 1, height: 1, generateMipmaps: false });
    const channels: ShaderUniforms = { iChannel0: blank(), iChannel0Size: [1, 1], iChannel1: blank(), iChannel1Size: [1, 1] };
    let videoTexture: Texture | null = null;
    let image: HTMLCanvasElement | null = null;
    let imageTexture: Texture | null = null;

    shader.setOnDraw(() => {
      if (video && video.readyState >= video.HAVE_CURRENT_DATA) {
        if (!videoTexture) {
          videoTexture = new Texture(gl, {
            image: video, generateMipmaps: false,
            minFilter: gl.LINEAR, magFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
          });
          channels.iChannel0 = videoTexture;
          channels.iChannel0Size = [video.videoWidth, video.videoHeight];
        }
        videoTexture.needsUpdate = true;
      }
      const { channel1: next, onFrame: frame, onDrawn: drawn } = latest.current;
      let fresh = false;
      if (next && next !== image) {
        if (imageTexture) gl.deleteTexture(imageTexture.texture);
        image = next;
        imageTexture = new Texture(gl, {
          image: next, minFilter: gl.LINEAR_MIPMAP_LINEAR, magFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
        });
        channels.iChannel1 = imageTexture;
        channels.iChannel1Size = [next.width, next.height];
        fresh = true;
      }
      // A shared clock, so shaders layered on one page stay in step.
      shader.setUniforms({ ...uniforms, ...channels, uClock: performance.now() / 1000, ...frame?.() });
      if (fresh) requestAnimationFrame(() => drawn?.());
    });

    if (!shader.setShader({ source: shaderCode, uniforms: { ...uniforms, ...channels, uClock: 0 } })) {
      onError?.('The shader failed to compile');
      shader.dispose();
      return;
    }

    const sync = () => {
      const s = live.current;
      if (!s.paused && s.inView && s.visible) shader.play();
      else shader.pause();
    };
    const io = new IntersectionObserver(([entry]) => { live.current.inView = entry?.isIntersecting ?? true; sync(); });
    io.observe(el);
    const onVisibility = () => { live.current.visible = document.visibilityState === 'visible'; sync(); };
    document.addEventListener('visibilitychange', onVisibility);
    sync();
    (el as HTMLDivElement & { __sync?: () => void }).__sync = sync;

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      shader.dispose();
      shaderRef.current = null;
    };
    // Rebuilt only when the shader, the video or the canvas settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shaderCode, video, frameRate, pixelRatio]);

  useEffect(() => {
    (ref.current as (HTMLDivElement & { __sync?: () => void }) | null)?.__sync?.();
  }, [paused]);

  return <div ref={ref} className={cn('[&>canvas]:block [&>canvas]:size-full', className)} />;
}
