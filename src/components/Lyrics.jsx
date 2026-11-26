import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audio, useLibrary, usePlayerActions } from '../store';

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
const getLetters = (el) => el._ll || (el._ll = [...el.querySelectorAll('.ll')]);

// Memoized: word spans never re-render on scroll / line changes (fill & glow are driven imperatively)
const Word = memo(function Word({ w, glow, store, k }) {
  const refFn = (el) => {
    if (el) store.current[k] = el;
    else if (store.current[k]) delete store.current[k];
  };
  const trail = w.w.match(/\s*$/)[0];
  const core = w.w.trimEnd();
  if (glow) {
    const letters = [...core];
    return (
      <>
        <span className="lw glow" ref={refFn} data-letters={letters.length}>
          {letters.map((c, i) => (
            <span key={i} className="ll">
              {c}
            </span>
          ))}
        </span>
        {trail}
      </>
    );
  }
  return (
    <>
      <span className="lw" ref={refFn}>
        {core}
      </span>
      {trail}
    </>
  );
});

export default function LyricsView({ data, loading, song, visible = true }) {
  const { seek } = usePlayerActions();
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

  // glow (per-letter) for sustained words
  const glowSet = useMemo(() => {
    const s = new Set();
    lines?.forEach((l, li) =>
      l.words?.forEach((w, wi) => {
        const len = w.w.trim().length;
        if (w.e - w.t >= 0.48 && len >= 2 && len <= 12 && isLatinWord(w.w)) s.add(`${li}-${wi}`);
      })
    );
    return s;
  }, [lines]);

  // Precompute CJK flags once per song instead of per-render regex
  const cjkFlags = useMemo(
    () => (lines ? lines.map((l) => (l.inst ? false : isCJK(l.words.map((w) => w.w).join('')))) : []),
    [lines]
  );

  useEffect(() => {
    setActive(-1);
    activeRef.current = -1;
    setScrollY(0);
    lastFill.current.clear();
    Object.values(wordEls.current).forEach((el) => el && delete el._ll);
  }, [data]);

  // --------------------------------------------------- animation loop (only runs when visible)
  useEffect(() => {
    if (!lines || !visible) return;
    let raf = 0;

    const updateSync = () => {
      const t = preciseTime() + offset;
      let a = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= t + 0.05) a = i;
        else break;
      }
      if (a >= 0 && lines[a].inst && t > lines[a].e + 0.3 && a + 1 < lines.length) a = a;
      if (a !== activeRef.current) {
        const prevA = activeRef.current;
        activeRef.current = a;
        setActive(a);
        if (prevA >= 0) {
          lines[prevA]?.words?.forEach((_, wi) => {
            const el = wordEls.current[`${prevA}-${wi}`];
            if (el) {
              el.style.setProperty('--p', 0);
              el.style.setProperty('--g', 0);
              el.style.setProperty('--lift', 0);
              getLetters(el).forEach((x) => {
                x.style.setProperty('--p', 0);
                x.style.setProperty('--g', 0);
                x.style.setProperty('--lift', 0);
              });
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
        const rawP = clamp01((t - w.t) / Math.max(0.05, w.e - w.t));
        const p = rawP <= 0 ? 0 : rawP >= 1 ? 1 : Math.round(rawP * 250) / 250;
        if (lastFill.current.get(key) === p) return;
        lastFill.current.set(key, p);
        const el = wordEls.current[key];
        if (!el) return;
        const bell = p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0;
        const g = p <= 0 ? 0 : p >= 1 ? 0.65 : Math.min(1, p * 0.6 + bell * 0.72);
        el.style.setProperty('--p', p);
        el.style.setProperty('--g', g.toFixed(3));
        el.style.setProperty('--lift', bell.toFixed(3));
        if (glowSet.has(key)) {
          const ls = getLetters(el);
          const n = ls.length;
          for (let k = 0; k < n; k++) {
            const lp = clamp01(p * n - k);
            const lBell = lp > 0 && lp < 1 ? Math.sin(lp * Math.PI) : 0;
            const lg = lp <= 0 ? 0 : lp >= 1 ? 0.72 : Math.min(1, lp * 0.55 + lBell * 0.85);
            ls[k].style.setProperty('--p', lp.toFixed(3));
            ls[k].style.setProperty('--g', lg.toFixed(3));
            ls[k].style.setProperty('--lift', lBell.toFixed(3));
          }
        }
      });
    };

    const tick = () => {
      updateSync();
      if (!audio.paused && !document.hidden) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const start = () => {
      updateSync();
      if (!raf && !audio.paused && !document.hidden) {
        raf = requestAnimationFrame(tick);
      }
    };

    start();
    audio?.addEventListener('play', start);
    audio?.addEventListener('playing', start);
    audio?.addEventListener('seeked', start);
    audio?.addEventListener('timeupdate', updateSync);
    document.addEventListener('visibilitychange', start);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      audio?.removeEventListener('play', start);
      audio?.removeEventListener('playing', start);
      audio?.removeEventListener('seeked', start);
      audio?.removeEventListener('timeupdate', updateSync);
      document.removeEventListener('visibilitychange', start);
    };
  }, [lines, offset, glowSet, visible]);

  // --------------------------------------------------- auto scroll
  const targetFor = useCallback((a) => {
    const wrap = wrapRef.current;
    const el = lineEls.current[Math.max(0, a)];
    if (!wrap || !el) return 0;
    return Math.max(0, el.offsetTop - wrap.clientHeight * 0.26);
  }, []);

  useLayoutEffect(() => {
    if (visible && !manual) setScrollY(targetFor(active));
  }, [active, manual, visible, targetFor]);

  useEffect(() => {
    if (!visible) return;
    const on = () => !manual && setScrollY(targetFor(activeRef.current));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [manual, visible, targetFor]);

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
        const farOffscreen = !manual && active >= 0 && (i < active - 5 || i > active + 9);
        const delay = manual || farOffscreen ? 0 : Math.max(0, Math.min(i - active + 1, 9)) * 42;
        const style = {
          transform: `translate3d(0, ${-scrollY}px, 0)`,
          transitionDelay: `${delay}ms, ${delay}ms, 0ms, 0ms`,
          '--blur': manual || farOffscreen || i === active ? '0px' : `${Math.min(dist, 5) * 0.55}px`,
          visibility: farOffscreen ? 'hidden' : 'visible',
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
        return (
          <div
            key={i}
            ref={(el) => (lineEls.current[i] = el)}
            className={`ll-line ${i === active ? 'active' : ''} ${i < active ? 'past' : ''} playable ${cjkFlags[i] ? 'cjk' : ''}`}
            style={style}
            onClick={() => seek(l.t - offset + 0.02)}
          >
            {l.words.map((w, wi) => (
              <Word key={wi} w={w} glow={glowSet.has(`${i}-${wi}`)} store={wordEls} k={`${i}-${wi}`} />
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
