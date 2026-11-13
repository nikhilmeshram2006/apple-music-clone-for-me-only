import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { art, resolveFullStream } from './api';

// ------------------------------------------------------------------ persistence
const load = (k, d) => {
  try {
    const v = localStorage.getItem('am_' + k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem('am_' + k, JSON.stringify(v));
  } catch {
    /* quota */
  }
};
function usePersisted(key, initial) {
  const [v, setV] = useState(() => load(key, initial));
  useEffect(() => save(key, v), [key, v]);
  return [v, setV];
}

// ------------------------------------------------------------------ router (hash)
const RouterCtx = createContext(null);
export function RouterProvider({ children }) {
  const get = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [path, setPath] = useState(get);
  useEffect(() => {
    const on = () => {
      setPath(get());
      document.querySelector('.page-scroll')?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((p) => (window.location.hash = p), []);
  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
}
export const useRouter = () => useContext(RouterCtx);

// ------------------------------------------------------------------ catalog
const CatalogCtx = createContext(null);
export const useCatalog = () => useContext(CatalogCtx);
export function CatalogProvider({ value, children }) {
  return <CatalogCtx.Provider value={value}>{children}</CatalogCtx.Provider>;
}

// ------------------------------------------------------------------ library
const LibraryCtx = createContext(null);
export const useLibrary = () => useContext(LibraryCtx);
export function LibraryProvider({ children }) {
  const [liked, setLiked] = usePersisted('liked', []); // song objects
  const [recent, setRecent] = usePersisted('recent', []); // song objects
  const [playlists, setPlaylists] = usePersisted('playlists', []); // {id,name,songs:[]}
  const [following, setFollowing] = usePersisted('following', []); // artist {id,name,image}
  const [stats, setStats] = usePersisted('stats', { seconds: 0, plays: 0, byArtist: {}, byGenre: {} });
  const [profile, setProfile] = usePersisted('profile', { name: 'Music Lover', handle: '@listener', color: '#fa2d48' });
  const [settings, setSettings] = usePersisted('settings', { lyricSize: 1, autoLyrics: false, crossfade: true });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(0);

  const notify = useCallback((msg, type = 'success') => {
    setToast({ msg, type, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const slim = (s) => ({ ...s });
  const isLiked = useCallback((id) => liked.some((s) => s.id === id), [liked]);
  const toggleLike = useCallback(
    (song) => {
      setLiked((l) => {
        const exists = l.some((s) => s.id === song.id);
        notify(exists ? `Removed “${song.title}” from Favorites` : `Added “${song.title}” to Favorites`, 'success');
        return exists ? l.filter((s) => s.id !== song.id) : [slim(song), ...l];
      });
    },
    [setLiked, notify]
  );
  const pushRecent = useCallback(
    (song) => setRecent((r) => [slim(song), ...r.filter((s) => s.id !== song.id)].slice(0, 40)),
    [setRecent]
  );
  const isFollowing = useCallback((id) => following.some((a) => a.id === id), [following]);
  const toggleFollow = useCallback(
    (a) => {
      setFollowing((f) => {
        const exists = f.some((x) => x.id === a.id);
        notify(exists ? `Unfollowed ${a.name}` : `Now following ${a.name}`, 'success');
        return exists ? f.filter((x) => x.id !== a.id) : [a, ...f];
      });
    },
    [setFollowing, notify]
  );
  const createPlaylist = useCallback(
    (name, songs = []) => {
      const p = { id: 'pl' + Date.now(), name: name || 'New Playlist', songs, created: Date.now() };
      setPlaylists((ps) => [p, ...ps]);
      notify(`Created playlist “${p.name}”`, 'success');
      return p;
    },
    [setPlaylists, notify]
  );
  const addToPlaylist = useCallback(
    (pid, song) =>
      setPlaylists((ps) =>
        ps.map((p) => {
          if (p.id === pid) {
            if (p.songs.some((s) => s.id === song.id)) {
              notify(`“${song.title}” is already in ${p.name}`, 'error');
              return p;
            }
            notify(`Added “${song.title}” to ${p.name}`, 'success');
            return { ...p, songs: [...p.songs, slim(song)] };
          }
          return p;
        })
      ),
    [setPlaylists, notify]
  );
  const removeFromPlaylist = useCallback(
    (pid, sid) => {
      setPlaylists((ps) => ps.map((p) => (p.id === pid ? { ...p, songs: p.songs.filter((s) => s.id !== sid) } : p)));
      notify('Removed song from playlist', 'success');
    },
    [setPlaylists, notify]
  );
  const deletePlaylist = useCallback(
    (pid) => {
      setPlaylists((ps) => ps.filter((p) => p.id !== pid));
      notify('Playlist deleted', 'success');
    },
    [setPlaylists, notify]
  );
  const addListen = useCallback(
    (song, secs) =>
      setStats((st) => ({
        ...st,
        seconds: st.seconds + secs,
        byArtist: { ...st.byArtist, [song.artistId]: { name: song.artist, art: song.art, s: (st.byArtist[song.artistId]?.s || 0) + secs } },
        byGenre: song.genre ? { ...st.byGenre, [song.genre]: (st.byGenre[song.genre] || 0) + secs } : st.byGenre,
      })),
    [setStats]
  );
  const countPlay = useCallback(() => setStats((st) => ({ ...st, plays: st.plays + 1 })), [setStats]);
  const resetAll = () => {
    setLiked([]);
    setRecent([]);
    setPlaylists([]);
    setFollowing([]);
    setStats({ seconds: 0, plays: 0, byArtist: {}, byGenre: {} });
    notify('Cleared local library & listening history', 'success');
  };

  const value = {
    liked, isLiked, toggleLike, recent, pushRecent, playlists, createPlaylist, addToPlaylist, removeFromPlaylist,
    deletePlaylist, following, isFollowing, toggleFollow, stats, addListen, countPlay, profile, setProfile,
    settings, setSettings, resetAll, toast, notify,
  };
  return <LibraryCtx.Provider value={value}>{children}</LibraryCtx.Provider>;
}

// ------------------------------------------------------------------ player
const PlayerCtx = createContext(null);
const TimeCtx = createContext(null);
export const usePlayer = () => useContext(PlayerCtx);
export const usePlayerTime = () => useContext(TimeCtx);

export const audio = typeof Audio !== 'undefined' ? new Audio() : null;
if (audio) {
  audio.preload = 'auto';
}

export function PlayerProvider({ children }) {
  const lib = useLibrary();
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [volume, setVolumeS] = useState(() => load('volume', 0.9));
  const [time, setTime] = useState({ t: 0, d: 30 });
  const [nowOpen, setNowOpen] = useState(false);
  const [error, setError] = useState(null);
  const listenRef = useRef({ last: 0 });
  const st = useRef({});
  const current = queue[index] || null;
  st.current = { queue, index, repeat, shuffle, current };

  useEffect(() => {
    if (audio) audio.volume = volume;
    save('volume', volume);
  }, [volume]);

  // load full-length source when the current song changes
  useEffect(() => {
    if (!audio || !current) return;
    let cancelled = false;
    if (audio.dataset.id !== current.id) {
      audio.dataset.id = current.id;
      setTime({ t: 0, d: current.duration || 180 });
      setError(null);
      setLoading(true);
      lib.pushRecent(current);
      lib.countPlay();

      const startStream = (src, dur) => {
        if (cancelled) return;
        audio.src = src;
        if (dur) setTime((prev) => ({ ...prev, d: dur }));
        audio.play().catch(() => {
          // If full stream fails for any reason, fallback cleanly to Apple 256kbps stream
          if (current.preview && audio.src !== current.preview) {
            audio.src = current.preview;
            audio.play().catch(() => setPlaying(false));
          } else {
            setPlaying(false);
          }
        });
      };

      if (current.audio) {
        startStream(current.audio, current.duration);
      } else {
        resolveFullStream(current).then((res) => {
          startStream(res.audio || current.preview, res.duration || current.duration);
        });
      }
    }
    // media session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album,
        artwork: [256, 512, 1000].map((s) => ({ src: art(current.art, s), sizes: `${s}x${s}`, type: 'image/jpeg' })),
      });
    }
    document.title = `${current.title} · ${current.artist} — Apple Music`;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const next = useCallback((auto = false) => {
    const { queue: q, index: i, repeat: r } = st.current;
    if (!q.length) return;
    if (auto && r === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }
    if (i + 1 < q.length) setIndex(i + 1);
    else if (r === 'all' || !auto) setIndex(0);
    else setPlaying(false);
  }, []);

  const prev = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const { queue: q, index: i } = st.current;
    if (i > 0) setIndex(i - 1);
    else audio.currentTime = 0;
  }, []);

  useEffect(() => {
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setTime({ t: audio.currentTime, d: audio.duration || 30 });
      const cur = st.current.current;
      if (cur && !audio.paused) {
        const now = audio.currentTime;
        const delta = now - listenRef.current.last;
        if (delta > 0 && delta < 2) {
          listenRef.current.acc = (listenRef.current.acc || 0) + delta;
          if (listenRef.current.acc >= 5) {
            lib.addListen(cur, listenRef.current.acc);
            listenRef.current.acc = 0;
          }
        }
        listenRef.current.last = now;
      }
    };
    const onEnded = () => next(true);
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onErr = () => {
      setLoading(false);
      setError('Audio stream could not be loaded. Please try another track.');
      lib.notify('Audio stream could not be loaded.', 'error');
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onCanPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onErr);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    }
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onCanPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, prev]);

  const playList = useCallback((songs, start = 0, opts = {}) => {
    const list = songs.filter((s) => s?.audio || s?.preview);
    if (!list.length) return;
    let q = list;
    let i = Math.max(0, list.findIndex((s) => s.id === songs[start]?.id));
    if (opts.shuffle) {
      q = [...list].sort(() => Math.random() - 0.5);
      i = 0;
      setShuffle(true);
    }
    const same = st.current.current && q[i]?.id === st.current.current.id;
    setQueue(q);
    setIndex(i);
    if (same) {
      audio.currentTime = 0;
      audio.play();
    }
  }, []);

  const playSong = useCallback(
    (song, context) => {
      if (context?.length) return playList(context, context.findIndex((s) => s.id === song.id));
      playList([song], 0);
    },
    [playList]
  );

  const toggle = useCallback(() => {
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seek = useCallback((t) => {
    if (!audio.src) return;
    audio.currentTime = Math.max(0, Math.min(t, (audio.duration || 30) - 0.05));
    if (audio.paused) audio.play().catch(() => {});
  }, []);

  const addNext = useCallback(
    (song) => {
      setQueue((q) => {
        const { index: i } = st.current;
        if (!q.length) {
          setIndex(0);
          return [song];
        }
        const rest = q.filter((s, k) => k <= i || s.id !== song.id);
        rest.splice(i + 1, 0, song);
        return rest;
      });
      lib.notify(`Playing “${song.title}” next`, 'success');
    },
    [lib]
  );

  const addLater = useCallback(
    (song) => {
      setQueue((q) => {
        if (!q.length) {
          setIndex(0);
          return [song];
        }
        return [...q, song];
      });
      lib.notify(`Added “${song.title}” to the end of queue`, 'success');
    },
    [lib]
  );

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      const { queue: q, index: i } = st.current;
      if (!on && q.length > 1) {
        const cur = q[i];
        const rest = q.filter((_, k) => k !== i).sort(() => Math.random() - 0.5);
        setQueue([cur, ...rest]);
        setIndex(0);
      }
      return !on;
    });
  }, []);

  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), []);

  // keyboard shortcuts
  useEffect(() => {
    const on = (e) => {
      if (/input|textarea/i.test(e.target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowRight' && e.shiftKey) next();
      else if (e.code === 'ArrowLeft' && e.shiftKey) prev();
      else if (e.code === 'ArrowRight') seek(audio.currentTime + 5);
      else if (e.code === 'ArrowLeft') seek(audio.currentTime - 5);
      else if (e.code === 'Escape') setNowOpen(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [toggle, next, prev, seek]);

  const value = useMemo(
    () => ({
      queue, index, current, playing, loading, shuffle, repeat, volume, nowOpen, error,
      setVolume: setVolumeS, setNowOpen, playList, playSong, toggle, next: () => next(false), prev, seek,
      addNext, addLater, toggleShuffle, cycleRepeat, jumpTo: setIndex,
    }),
    [queue, index, current, playing, loading, shuffle, repeat, volume, nowOpen, error, playList, playSong, toggle, next, prev, seek, addNext, addLater, toggleShuffle, cycleRepeat]
  );
  return (
    <PlayerCtx.Provider value={value}>
      <TimeCtx.Provider value={time}>{children}</TimeCtx.Provider>
    </PlayerCtx.Provider>
  );
}

export const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
