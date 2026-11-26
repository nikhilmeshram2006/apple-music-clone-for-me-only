import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { art, searchAll } from '../api';
import { stripScriptChars } from '../utils/studioCore';
import { useCatalog, usePlayer, usePlayerActions, usePlayerTime, useRouter, useSiteConfig } from '../store';
import { Close, Home, Library, Lyrics, Next, Pause, Play, Search, User } from './Icons';

export function TopBar({ onOpenMobileMenu }) {
  const { path, navigate } = useRouter();
  const catalog = useCatalog();
  const player = usePlayerActions();
  const siteConfig = useSiteConfig();
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState(null);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const on = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, []);

  useEffect(() => {
    const term = deferredQ.trim();
    if (term.length < 2) {
      setRemote(null);
      return;
    }
    const id = setTimeout(() => {
      searchAll(term).then(setRemote).catch(() => {});
    }, 220);
    return () => clearTimeout(id);
  }, [deferredQ]);

  const allSongs = useMemo(() => Object.values(catalog.songs), [catalog]);
  const allArtists = useMemo(() => Object.values(catalog.artists), [catalog]);

  const localSongs = useMemo(() => {
    const t = deferredQ.trim().toLowerCase();
    if (!t) return [];
    const out = [];
    for (let i = 0; i < allSongs.length; i++) {
      const s = allSongs[i];
      if ((s._q || `${s.title} ${s.artist} ${s.genre}`.toLowerCase()).includes(t)) {
        out.push(s);
        if (out.length >= 6) break;
      }
    }
    return out;
  }, [deferredQ, allSongs]);

  const localArtists = useMemo(() => {
    const t = deferredQ.trim().toLowerCase();
    if (!t) return [];
    const out = [];
    for (let i = 0; i < allArtists.length; i++) {
      const a = allArtists[i];
      if ((a._q || a.name.toLowerCase()).includes(t)) {
        out.push(a);
        if (out.length >= 5) break;
      }
    }
    return out;
  }, [deferredQ, allArtists]);

  const mergedArtists = useMemo(() => {
    const map = new Map();
    localArtists.forEach((a) => map.set(a.name.toLowerCase(), a));
    (remote?.artists || []).forEach((a) => {
      if (!map.has(a.name.toLowerCase())) map.set(a.name.toLowerCase(), a);
    });
    return [...map.values()].slice(0, 5);
  }, [localArtists, remote]);

  const mergedSongs = useMemo(() => {
    const map = new Map();
    localSongs.forEach((s) => map.set(`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`, s));
    (remote?.songs || []).forEach((s) => {
      const k = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
      if (!map.has(k)) map.set(k, s);
    });
    return [...map.values()].slice(0, 6);
  }, [localSongs, remote]);

  const submit = (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setOpen(false);
    navigate(`/search/${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="top-search-bar" ref={boxRef}>
      <div className="top-left-cluster">
        <button className="mobile-menu-btn" onClick={onOpenMobileMenu} aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <button className="top-logo-btn" onClick={() => navigate('/')} title="Go to Home">
          <img src={siteConfig?.logoUrl || 'logo.png'} alt={siteConfig?.siteName || 'AUREL'} decoding="async" />
          <span>{siteConfig?.siteName || 'AUREL'}</span>
        </button>
      </div>

      <div className="top-search-center">
        <form className={`top-search-form ${path.startsWith('/search') || open ? 'active' : ''}`} onSubmit={submit}>
          <Search size={16} />
          <input
            ref={inputRef}
            value={q}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(stripScriptChars(e.target.value, 120));
              setOpen(true);
            }}
            placeholder="Search songs, artists (SZA, YOASOBI, Indila…)"
            aria-label="Search AUREL"
          />
          {q ? (
            <button
              type="button"
              className="dock-clear"
              onClick={() => {
                setQ('');
                inputRef.current?.focus();
              }}
              aria-label="Clear"
            >
              <Close size={13} />
            </button>
          ) : (
            <button type="button" className="dock-go" onClick={() => navigate('/search')} title="Browse genres">
              Browse
            </button>
          )}
        </form>

        {open && q.trim() && (
          <div className="top-search-pop glass">
            {mergedArtists.length > 0 && (
              <div className="dp-sec">
                <div className="dp-label">Artists</div>
                {mergedArtists.map((a) => (
                  <div
                    key={a.id}
                    className="dp-row"
                    onClick={() => {
                      setOpen(false);
                      navigate(`/artist/${a.id}`);
                    }}
                  >
                    {a.image ? (
                      <img className="round" src={a.image} alt={a.name} loading="lazy" decoding="async" />
                    ) : (
                      <div className="dp-avatar-fallback">{(a.name || '?')[0]}</div>
                    )}
                    <div className="dp-meta">
                      <div className="t">{a.name}</div>
                      <div className="s">Artist · {a.genre || 'Music'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="dp-sec">
              <div className="dp-label">Full-Length Songs</div>
              {mergedSongs.map((s) => (
                <div
                  key={s.id}
                  className="dp-row"
                  onClick={() => {
                    player.playSong(s, mergedSongs);
                    setOpen(false);
                  }}
                >
                  <img src={art(s.art, 120)} alt={s.title} loading="lazy" decoding="async" />
                  <div className="dp-meta">
                    <div className="t">
                      {s.title} {s.lyrics === 'synced' && <Lyrics size={11} />}
                    </div>
                    <div className="s">{s.artist}</div>
                  </div>
                  <Play size={15} />
                </div>
              ))}
            </div>
            <button className="dp-all" onClick={submit}>
              See all results for “{q}” →
            </button>
          </div>
        )}
      </div>

      <div className="top-bar-spacer" />
    </div>
  );
}

function MiniPlayer() {
  const player = usePlayer();
  const { t, d } = usePlayerTime();
  const song = player.current;
  if (!song) return null;
  const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;

  return (
    <div className="mini-player glass" onClick={() => player.setNowOpen(true)}>
      <div className="mp-progress" style={{ width: `${pct}%` }} />
      <img className="mp-art" src={art(song.art, 160)} alt="" decoding="async" />
      <div className="mp-meta">
        <div className="mp-title">
          {song.title}
          {song.lyrics === 'synced' && <Lyrics size={12} />}
        </div>
        <div className="mp-sub">{song.artist}</div>
      </div>
      <div className="mp-btns" onClick={(e) => e.stopPropagation()}>
        <button className="mp-btn" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
          {player.playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="mp-btn" onClick={player.next} aria-label="Next">
          <Next size={20} />
        </button>
      </div>
    </div>
  );
}

export default function BottomDock() {
  const { path, navigate } = useRouter();

  const tab = path.startsWith('/library') || path.startsWith('/playlist')
    ? 'library'
    : path.startsWith('/profile')
    ? 'profile'
    : path === '/'
    ? 'home'
    : '';

  return (
    <div className="dock-wrap">
      <MiniPlayer />

      <nav className="bottom-dock-minimal" aria-label="Primary">
        <button className={`dock-tab-min ${tab === 'home' ? 'active' : ''}`} onClick={() => navigate('/')}>
          <Home size={19} />
          <span>Home</span>
        </button>

        <button className={`dock-tab-min ${tab === 'library' ? 'active' : ''}`} onClick={() => navigate('/library')}>
          <Library size={19} />
          <span>Library</span>
        </button>

        <button className={`dock-tab-min ${tab === 'profile' ? 'active' : ''}`} onClick={() => navigate('/profile')}>
          <User size={19} />
          <span>Profile</span>
        </button>
      </nav>
    </div>
  );
}
