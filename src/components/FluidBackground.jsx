import { useEffect, useRef } from 'react';

// Apple-Music-style "living artwork" background: several copies of the image
// slowly orbit/rotate on a tiny canvas, which is then upscaled + blurred by CSS.
// Cheap (72x72 px of drawing per frame) yet looks like a fluid mesh gradient.

const cache = new Map();
function loadImg(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => {
      const i2 = new Image(); // retry without CORS (canvas gets tainted but still draws)
      i2.onload = () => res(i2);
      i2.onerror = () => res(null);
      i2.src = src;
    };
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

const W = 72;
const H = 72;
const blobs = [
  { x: 0.28, y: 0.3, s: 1.15, r: 0.05, ox: 0.08, oy: 0.06, f: 0.11 },
  { x: 0.78, y: 0.72, s: 1.0, r: -0.07, ox: 0.07, oy: 0.09, f: 0.09 },
  { x: 0.7, y: 0.22, s: 0.75, r: 0.12, ox: 0.1, oy: 0.05, f: 0.13 },
  { x: 0.22, y: 0.82, s: 0.85, r: -0.045, ox: 0.06, oy: 0.08, f: 0.07 },
  { x: 0.5, y: 0.5, s: 0.55, r: 0.16, ox: 0.12, oy: 0.12, f: 0.15 },
];

function scene(ctx, img, t) {
  ctx.globalAlpha = 1;
  ctx.drawImage(img, -W * 0.1, -H * 0.1, W * 1.2, H * 1.2);
  for (const b of blobs) {
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

export default function FluidBackground({ src, className = '', speed = 1, dim = 0.3, paused = false }) {
  const ref = useRef(null);
  const state = useRef({ cur: null, prev: null, fade: 1, speed, paused });
  state.current.speed = speed;
  state.current.paused = paused;

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
    });
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    const cv = ref.current;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    let raf;
    let t = Math.random() * 100;
    let last = performance.now();
    let acc = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc < 1 / 30) return; // 30fps is plenty for a blurred background
      const s = state.current;
      t += acc * (s.paused ? 0.25 : 1) * s.speed;
      acc = 0;
      if (!s.cur) return;
      const fade = s.fadeStart ? Math.min(1, (now - s.fadeStart) / 1200) : 1;
      if (s.prev && fade < 1) {
        scene(ctx, s.prev, t);
        octx.clearRect(0, 0, W, H);
        scene(octx, s.cur, t);
        ctx.globalAlpha = fade;
        ctx.drawImage(off, 0, 0);
        ctx.globalAlpha = 1;
      } else {
        scene(ctx, s.cur, t);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`fluid ${className}`} aria-hidden="true">
      <canvas ref={ref} />
      <div className="fluid-dim" style={{ background: `rgba(0,0,0,${dim})` }} />
    </div>
  );
}
