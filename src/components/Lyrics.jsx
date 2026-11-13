import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audio, useLibrary, usePlayer } from '../store';

// precise playback clock (timeupdate only fires ~4x/s; we extrapolate between reads)
let lastA = -1;
let lastP = 0;
function preciseTime() {
  const a = audio.currentTime;
  const now = performance.now();
  if (a !== lastA) {
    lastA = a;
    lastP = now;
    return a;
  }
  if (audio.paused) return a;
  return a + Math.min(0.25, (now - lastP) / 1000) * audio.playbackRate;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const isCJK = (s) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(s);
const isLatinWord = (s) => /^[\p{L}\p{N}'’,.!?-]+\s*$/u.test(s) && !isCJK(s);

function Word({ w, glow, refFn }) {
  if (glow) {
    const trail = w.w.match(/\s*$/)[0];
    const letters = [...w.w.trimEnd()];
    return (
      <span className="lw glow" ref={refFn} data-letters={letters.length}>
        {letters.map((c, i) => (
          <span key={i} className="ll">
            {c}
          </span>
        ))}
        {trail}
      </span>
    );
  }
  return (
    <span className="lw" ref={refFn}>
      {w.w}
    </span>
  );
}

export default function LyricsView({ data, loading, song }) {
  const player = usePlayer();
  const { settings } = useLibrary();
  const lines = data?.synced ? data.lines : null;
  const offset = data?.offset || 0;
  const wrapRef = useRef(null);
  const lineEls = useRef([]);
  const wordEls = useRef({});
  const [active, setActive] = useState(-1);
  const [scrollY, setScrollY] = useState(0);
  const [manual, setManual] = useState(false);
  const manualTimer = useRef(0);
  const activeRef = useRef(-1);
  const lastFill = useRef(new Map());

  // glow (per-letter) for long, sustained latin words – like Apple Music
  const glowSet = useMemo(() => {
    const s = new Set();
    lines?.forEach((l, li) =>
      l.words?.forEach((w, wi) => {
        const len = w.w.trim().length;
        if (w.e - w.t >= 1.05 && len >= 2 && len <= 10 && isLatinWord(w.w)) s.add(`${li}-${wi}`);
      })
    );
    return s;
  }, [lines]);

  useEffect(() => {
    setActive(-1);
    activeRef.current = -1;
    setScrollY(0);
    lastFill.current.clear();
  }, [data]);

  // --------------------------------------------------- animation loop
  useEffect(() => {
    if (!lines) return;
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = preciseTime() + offset;
      // find active line (last line that has started)
      let a = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= t + 0.05) a = i;
        else break;
      }
      if (a >= 0 && lines[a].inst && t > lines[a].e + 0.3 && a + 1 < lines.length) a = a; // stay until next
      if (a !== activeRef.current) {
        const prevA = activeRef.current;
        activeRef.current = a;
        setActive(a);
        if (prevA >= 0) {
          lines[prevA]?.words?.forEach((_, wi) => {
            const el = wordEls.current[`${prevA}-${wi}`];
            if (el) {
              el.style.setProperty('--p', 0);
              el.querySelectorAll('.ll').forEach((x) => x.style.setProperty('--p', 0));
            }
          });
        }
        lastFill.current.clear();
      }
      if (a < 0) return;
      const line = lines[a];
      if (line.inst) {
        const el = lineEls.current[a];
        if (el) el.style.setProperty('--p', clamp01((t - line.t) / Math.max(0.5, line.e - line.t)));
        return;
      }
      line.words.forEach((w, wi) => {
        const key = `${a}-${wi}`;
        const p = clamp01((t - w.t) / Math.max(0.05, w.e - w.t));
        if (lastFill.current.get(key) === p) return;
        lastFill.current.set(key, p);
        const el = wordEls.current[key];
        if (!el) return;
        el.style.setProperty('--p', p.toFixed(4));
        if (glowSet.has(key)) {
          const ls = el.querySelectorAll('.ll');
          const n = ls.length;
          ls.forEach((x, k) => x.style.setProperty('--p', clamp01(p * n - k).toFixed(3)));
        }
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines, offset, glowSet]);

  // --------------------------------------------------- auto scroll
  const targetFor = useCallback((a) => {
    const wrap = wrapRef.current;
    const el = lineEls.current[Math.max(0, a)];
    if (!wrap || !el) return 0;
    return Math.max(0, el.offsetTop - wrap.clientHeight * 0.26);
  }, []);

  useLayoutEffect(() => {
    if (!manual) setScrollY(targetFor(active));
  }, [active, manual, targetFor]);

  useEffect(() => {
    const on = () => !manual && setScrollY(targetFor(activeRef.current));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [manual, targetFor]);

  const bumpManual = () => {
    setManual(true);
    clearTimeout(manualTimer.current);
    manualTimer.current = setTimeout(() => setManual(false), 2800);
  };
  const maxScroll = () => {
    const wrap = wrapRef.current;
    const last = lineEls.current[lines.length - 1];
    return last ? Math.max(0, last.offsetTop + last.offsetHeight - wrap.clientHeight * 0.5) : 0;
  };
  const onWheel = (e) => {
    bumpManual();
    setScrollY((y) => Math.max(0, Math.min(maxScroll(), y + e.deltaY)));
  };
  const touch = useRef(0);
  const onTouchStart = (e) => (touch.current = e.touches[0].clientY);
  const onTouchMove = (e) => {
    const y = e.touches[0].clientY;
    const d = touch.current - y;
    touch.current = y;
    bumpManual();
    setScrollY((s) => Math.max(0, Math.min(maxScroll(), s + d)));
  };

  const fontScale = settings?.lyricSize || 1;

  if (loading) {
    return (
      <div className="lyrics-wrap center">
        <div className="lyrics-loading">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (!data || (!lines && !data.plain && !data.lines?.length)) {
    return (
      <div className="lyrics-wrap center">
        <p className="lyrics-empty">Lyrics aren’t available for this song.</p>
      </div>
    );
  }

  // ------- unsynced fallback (song outside curated catalog)
  if (!lines) {
    const text = data.plain || data.lines.filter((l) => l.words).map((l) => l.words.map((w) => w.w).join('')).join('\n');
    return (
      <div className="lyrics-wrap plain" style={{ '--ls': fontScale }}>
        <div className="lyrics-note">Static lyrics · live sync is available on catalog tracks marked with the lyrics badge</div>
        {text.split('\n').map((l, i) => (l.trim() ? <p key={i} className="pl">{l}</p> : <div key={i} className="pl-gap" />))}
        <div className="lyrics-credit">Lyrics provided by LRCLIB</div>
      </div>
    );
  }

  // Full-song playback: every line in the song is directly clickable & seekable!
  const inWindow = () => true;

  return (
    <div
      className={`lyrics-wrap synced ${manual ? 'manual' : ''}`}
      ref={wrapRef}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      style={{ '--ls': fontScale }}
    >
      {lines.map((l, i) => {
        const dist = Math.abs(i - active);
        const delay = manual ? 0 : Math.max(0, Math.min(i - active + 1, 9)) * 42;
        const playable = inWindow(l);
        const style = {
          transform: `translate3d(0, ${-scrollY}px, 0)`,
          transitionDelay: `${delay}ms, ${delay}ms, 0ms, 0ms`,
          '--blur': manual || i === active ? '0px' : `${Math.min(dist, 5) * 0.55}px`,
        };
        if (l.inst) {
          return (
            <div key={i} ref={(el) => (lineEls.current[i] = el)} className={`ll-line inst ${i === active ? 'active' : ''}`} style={style}>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          );
        }
        const cjk = isCJK(l.words.map((w) => w.w).join(''));
        return (
          <div
            key={i}
            ref={(el) => (lineEls.current[i] = el)}
            className={`ll-line ${i === active ? 'active' : ''} ${i < active ? 'past' : ''} ${playable ? 'playable' : ''} ${cjk ? 'cjk' : ''}`}
            style={style}
            onClick={() => playable && player.seek(l.t - offset + 0.02)}
          >
            {l.words.map((w, wi) => (
              <Word key={wi} w={w} glow={glowSet.has(`${i}-${wi}`)} refFn={(el) => (wordEls.current[`${i}-${wi}`] = el)} />
            ))}
          </div>
        );
      })}
      <div className="ll-line credit" style={{ transform: `translate3d(0, ${-scrollY}px, 0)` }}>
        <div className="lyrics-credit">
          Lyrics: LRCLIB · Full-song word-by-word sync{song ? ` · ${song.title}` : ''}
        </div>
      </div>
    </div>
  );
}
