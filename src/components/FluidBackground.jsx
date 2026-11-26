import { useEffect, useRef } from 'react';
import { isMobilePerf, prefersReducedMotion } from '../utils/perf';

// Living-artwork ambient fluid background: several copies of a pre-softened
// sprite slowly orbit/rotate on a tiny 48x48 canvas, upscaled by the GPU.
// Automatically pauses its rAF loop when scrolled off-screen, hidden, or paused on mobile.

const W = 48;
const H = 48;

function bakeSprite(img) {
  try {
    const tmp = document.createElement('canvas');
    tmp.width = 16;
    tmp.height = 16;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(img, 0, 0, 16, 16);

    const sp = document.createElement('canvas');
    sp.width = W;
    sp.height = H;
    const sctx = sp.getContext('2d');
    if (typeof sctx.filter === 'string') {
      sctx.filter = 'blur(6px) saturate(1.75) contrast(1.08)';
    }
    sctx.drawImage(tmp, -4, -4, W + 8, H + 8);
    return sp;
  } catch {
    return img;
  }
}

const cache = new Map();
function loadImg(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => res(bakeSprite(img));
    img.onerror = () => {
      const i2 = new Image();
      i2.decoding = 'async';
      i2.onload = () => res(bakeSprite(i2));
      i2.onerror = () => res(null);
      i2.src = src;
    };
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

const blobs = [
  { x: 0.28, y: 0.3, s: 1.15, r: 0.05, ox: 0.08, oy: 0.06, f: 0.11 },
  { x: 0.78, y: 0.72, s: 1.0, r: -0.07, ox: 0.07, oy: 0.09, f: 0.09 },
  { x: 0.7, y: 0.22, s: 0.75, r: 0.12, ox: 0.1, oy: 0.05, f: 0.13 },
  { x: 0.22, y: 0.82, s: 0.85, r: -0.045, ox: 0.06, oy: 0.08, f: 0.07 },
  { x: 0.5, y: 0.5, s: 0.55, r: 0.16, ox: 0.12, oy: 0.12, f: 0.15 },
];

// One shared rAF clock drives every visible FluidBackground instead of one loop per instance.
const tickers = new Set();
let sharedRaf = 0;
function sharedLoop(now) {
  sharedRaf = 0;
  tickers.forEach((fn) => {
    if (fn(now) === false) tickers.delete(fn);
  });
  if (tickers.size) sharedRaf = requestAnimationFrame(sharedLoop);
}
function addTicker(fn) {
  tickers.add(fn);
  if (!sharedRaf) sharedRaf = requestAnimationFrame(sharedLoop);
}
function removeTicker(fn) {
  tickers.delete(fn);
  if (!tickers.size && sharedRaf) {
    cancelAnimationFrame(sharedRaf);
    sharedRaf = 0;
  }
}

const MOBILE_BLOBS = blobs.slice(0, 3);

function scene(ctx, img, t, activeBlobs) {
  ctx.globalAlpha = 1;
  ctx.drawImage(img, -W * 0.1, -H * 0.1, W * 1.2, H * 1.2);
  for (const b of activeBlobs) {
    const cx = (b.x + Math.sin(t * b.f + b.x * 9) * b.ox) * W;
    const cy = (b.y + Math.cos(t * b.f * 1.3 + b.y * 7) * b.oy) * H;
    const size = b.s * W * (1 + Math.sin(t * b.f * 0.7) * 0.08);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * b.r + b.x * 6);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

export default function FluidBackground({ src, className = '', speed = 1, dim = 0.3, paused = false, active = true }) {
  const wrapRef = useRef(null);
  const ref = useRef(null);
  const state = useRef({ cur: null, prev: null, fade: 1, speed, paused, active, inView: true, startLoop: null, mobile: isMobilePerf() });
  state.current.speed = speed;
  state.current.paused = paused;
  state.current.active = active;
  state.current.mobile = isMobilePerf();

  useEffect(() => {
    let alive = true;
    if (!src) return;
    loadImg(src).then((img) => {
      if (!alive || !img) return;
      const s = state.current;
      if (s.cur === img) return;
      s.prev = s.cur;
      s.cur = img;
      s.fadeStart = performance.now();
      s.drawOnce?.();
      s.startLoop?.();
    });
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    state.current.startLoop?.();
  }, [active, paused]);

  useEffect(() => {
    const cv = ref.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { alpha: false });
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d', { alpha: false });
    let running = false;
    let t = Math.random() * 100;
    let last = performance.now();
    let acc = 0;
    const reduced = prefersReducedMotion();

    const renderFrame = (now) => {
      const s = state.current;
      if (!s.cur) return;
      const activeBlobs = s.mobile ? MOBILE_BLOBS : blobs;
      const fade = s.fadeStart ? Math.min(1, (now - s.fadeStart) / 1200) : 1;
      if (s.prev && fade < 1) {
        scene(ctx, s.prev, t, activeBlobs);
        scene(octx, s.cur, t, activeBlobs);
        ctx.globalAlpha = fade;
        ctx.drawImage(off, 0, 0);
        ctx.globalAlpha = 1;
      } else {
        s.prev = null;
        scene(ctx, s.cur, t, activeBlobs);
      }
    };

    const shouldRun = () => {
      const s = state.current;
      if (reduced || !s.active || !s.inView || document.hidden || !s.cur) return false;
      if (s.mobile && s.paused) {
        const fading = s.prev && s.fadeStart && (performance.now() - s.fadeStart) < 1250;
        return Boolean(fading);
      }
      return true;
    };

    const loop = (now) => {
      if (!shouldRun()) {
        running = false;
        return false;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      const s = state.current;
      const interval = s.mobile ? (s.paused ? 1 / 6 : 1 / 10) : (s.paused ? 1 / 10 : 1 / 20);
      if (acc < interval) return true;
      t += acc * (s.paused ? 0.22 : 1) * s.speed;
      acc = 0;
      renderFrame(now);
      return true;
    };

    const startLoop = () => {
      if (!running && shouldRun()) {
        running = true;
        last = performance.now();
        addTicker(loop);
      }
    };

    state.current.drawOnce = () => renderFrame(performance.now());
    state.current.startLoop = startLoop;

    let io;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          state.current.inView = entry.isIntersecting;
          if (entry.isIntersecting) startLoop();
        },
        { rootMargin: '80px' }
      );
      io.observe(wrap);
    }

    const onVis = () => {
      if (!document.hidden) startLoop();
    };
    document.addEventListener('visibilitychange', onVis);
    startLoop();

    return () => {
      removeTicker(loop);
      running = false;
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`fluid ${className}`} aria-hidden="true">
      <canvas ref={ref} />
      <div className="fluid-dim" style={{ background: `rgba(0,0,0,${dim})` }} />
    </div>
  );
}
