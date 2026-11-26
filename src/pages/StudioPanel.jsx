import { useEffect, useMemo, useState } from 'react';
import { art, buildWordSyncedFromLrc } from '../api';
import {
  clearSecurityLogs,
  containsScriptPayload,
  DEFAULT_SITE_CONFIG,
  downloadJSON,
  getLyricsOverride,
  getSecurityLogs,
  getSessionAuthProof,
  isAdminAuthenticated,
  isSafeUrl,
  loadCatalogPatch,
  loadLyricsPatch,
  logSecurityEvent,
  resetAllAdminOverrides,
  sanitizeText,
  saveLyricsOverride,
  setAdminAuthenticated,
  setAdminPasscode,
  stripInternalCatalogFields,
  stripScriptChars,
  touchAdminSession,
  validateBackupPayload,
  verifyAdminCredentials,
  verifyAdminPasscode,
} from '../utils/studioCore';
import { Check, Close, Gear, Lyrics, Music, Play, Plus, Search, Trash, User } from '../components/Icons';
import { useAdminCatalog, useCatalog, useLibrary, usePlayerActions, useRouter, useSiteConfig } from '../store';

const EMPTY_SONG = {
  id: '',
  title: '',
  artist: '',
  artistId: '',
  album: '',
  albumId: '',
  art: '',
  videoArt: '',
  audio: '',
  preview: '',
  isFull: true,
  duration: 200,
  genre: 'pop',
  lang: 'en',
  explicit: false,
  year: String(new Date().getFullYear()),
  appleUrl: '',
  lyrics: 'synced',
  offset: 0,
  aliases: '',
};

export default function StudioPanel() {
  const catalog = useCatalog();
  const admin = useAdminCatalog();
  const siteConfig = useSiteConfig();
  const player = usePlayerActions();
  const lib = useLibrary();
  const { navigate } = useRouter();

  const [authed, setAuthed] = useState(() => isAdminAuthenticated());
  const [userInput, setUserInput] = useState('');
  const [passInput, setPassInput] = useState('');
  const [authErr, setAuthErr] = useState('');

  const [tab, setTab] = useState('songs'); // 'songs' | 'add' | 'artists' | 'settings' | 'system'
  const [songQuery, setSongQuery] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [onlyModified, setOnlyModified] = useState(false);

  const [editingSong, setEditingSong] = useState(null);
  const [editingLrc, setEditingLrc] = useState('');

  const [newSong, setNewSong] = useState({ ...EMPTY_SONG });
  const [newLrc, setNewLrc] = useState('');
  const [itQuery, setItQuery] = useState('');
  const [itResults, setItResults] = useState([]);
  const [itBusy, setItBusy] = useState(false);

  const [artistQuery, setArtistQuery] = useState('');
  const [editingArtist, setEditingArtist] = useState(null);

  const [curPass, setCurPass] = useState('');
  const [nextPass, setNextPass] = useState('');
  const [savingDisk, setSavingDisk] = useState(false);
  const [secLogs, setSecLogs] = useState(() => getSecurityLogs());

  // Enforce automatic 30-minute session expiry while open
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(() => {
      if (!isAdminAuthenticated()) {
        setAuthed(false);
        setSecLogs(getSecurityLogs());
        lib.notify('Studio session expired — please sign in again', 'error');
      }
    }, 15000);
    return () => clearInterval(id);
  }, [authed, lib]);

  const allSongs = useMemo(() => Object.values(catalog?.songs || {}), [catalog]);
  const allArtists = useMemo(
    () => Object.values(catalog?.artists || {}).sort((a, b) => (b.fans || 0) - (a.fans || 0)),
    [catalog]
  );

  const patch = loadCatalogPatch();
  const modifiedIds = useMemo(
    () => new Set([...Object.keys(patch.addedSongs || {}), ...Object.keys(patch.editedSongs || {})]),
    [catalog] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const filteredSongs = useMemo(() => {
    const q = songQuery.trim().toLowerCase();
    return allSongs.filter((s) => {
      if (genreFilter !== 'all' && s.genre !== genreFilter) return false;
      if (onlyModified && !modifiedIds.has(s.id)) return false;
      if (!q) return true;
      return (
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q) ||
        String(s.id).toLowerCase().includes(q)
      );
    });
  }, [allSongs, songQuery, genreFilter, onlyModified, modifiedIds]);

  const filteredArtists = useMemo(() => {
    const q = artistQuery.trim().toLowerCase();
    if (!q) return allArtists;
    return allArtists.filter(
      (a) => (a.name || '').toLowerCase().includes(q) || String(a.id).toLowerCase().includes(q)
    );
  }, [allArtists, artistQuery]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (containsScriptPayload(userInput) || containsScriptPayload(passInput)) {
      logSecurityEvent('SCRIPT_INJECTION_BLOCKED', 'Blocked script attempt in Console login');
      setUserInput('');
      setPassInput('');
      setSecLogs(getSecurityLogs());
      setAuthErr('Blocked: scripts are not allowed in login inputs.');
      return;
    }
    setAuthErr('');
    const res = await verifyAdminCredentials(userInput, passInput);
    if (res.ok) {
      setAuthed(true);
      setUserInput('');
      setPassInput('');
      setSecLogs(getSecurityLogs());
      lib.notify('Studio Console unlocked', 'success');
    } else if (res.blockedScript) {
      setUserInput('');
      setPassInput('');
      setSecLogs(getSecurityLogs());
      setAuthErr('Blocked: scripts are not allowed in login inputs.');
    } else if (res.lockedSeconds) {
      setSecLogs(getSecurityLogs());
      setAuthErr(`Too many failed attempts. Try again in ${res.lockedSeconds}s.`);
    } else {
      setSecLogs(getSecurityLogs());
      setAuthErr('Incorrect username or password.');
    }
  };

  const handleLock = () => {
    setAdminAuthenticated(false);
    setAuthed(false);
    setSecLogs(getSecurityLogs());
    lib.notify('Studio Console locked', 'success');
  };

  const openSongEditor = (song) => {
    setEditingSong({
      ...EMPTY_SONG,
      ...song,
      videoArt: song.videoArt || '',
      aliases: song.aliases || '',
    });
    const ov = getLyricsOverride(song.id);
    setEditingLrc(ov?.rawLrc || ov?.plain || '');
  };

  const saveLyricsFromText = (songId, rawText, duration) => {
    const trimmed = stripScriptChars(rawText, 25000).trim();
    if (!trimmed) return null;
    const hasTimestamps = /\[\d+:\d+(?:[.:]\d+)?\]/.test(trimmed);
    if (hasTimestamps) {
      const lines = buildWordSyncedFromLrc(trimmed, Number(duration) || 200);
      const plain = trimmed.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, '').trim();
      const payload = { id: songId, synced: true, offset: 0, source: 'studio', lines, plain, rawLrc: trimmed };
      saveLyricsOverride(songId, payload);
      return 'synced';
    }
    const payload = { id: songId, synced: false, offset: 0, source: 'studio', lines: [], plain: trimmed };
    saveLyricsOverride(songId, payload);
    return 'plain';
  };

  const handleSaveEditedSong = (e) => {
    e.preventDefault();
    touchAdminSession();
    const title = sanitizeText(editingSong?.title, 160);
    const artist = sanitizeText(editingSong?.artist, 160);
    if (!title || !artist) {
      lib.notify('Title and Artist are required', 'error');
      return;
    }
    if (!isSafeUrl(editingSong.audio) || !isSafeUrl(editingSong.art) || !isSafeUrl(editingSong.videoArt)) {
      lib.notify('Invalid or unsafe URL detected (only https:// or safe data/... paths allowed)', 'error');
      return;
    }
    const updated = {
      ...editingSong,
      title,
      artist,
      album: sanitizeText(editingSong.album, 160),
      aliases: sanitizeText(editingSong.aliases, 240),
      duration: Math.max(1, Math.min(7200, Number(editingSong.duration) || 180)),
      offset: Math.max(-60, Math.min(60, Number(editingSong.offset) || 0)),
      videoArt: editingSong.videoArt?.trim() || null,
    };
    if (editingLrc.trim()) {
      updated.lyrics = saveLyricsFromText(updated.id, editingLrc, updated.duration) || updated.lyrics;
    }
    admin.upsertSong(updated, false);
    logSecurityEvent('SONG_EDITED', `${updated.title} (${updated.id})`);
    setSecLogs(getSecurityLogs());
    setEditingSong(null);
    setEditingLrc('');
    lib.notify(`Updated “${updated.title}”`, 'success');
  };

  const handleAddSong = (e) => {
    e.preventDefault();
    touchAdminSession();
    const title = sanitizeText(newSong.title, 160);
    const artist = sanitizeText(newSong.artist, 160);
    if (!title || !artist) {
      lib.notify('Song Title and Artist are required', 'error');
      return;
    }
    if (!newSong.audio.trim() && !newSong.preview.trim()) {
      lib.notify('Provide an Audio URL (e.g. data/audio/song.m4a or https://...)', 'error');
      return;
    }
    if (!isSafeUrl(newSong.audio) || !isSafeUrl(newSong.preview) || !isSafeUrl(newSong.art) || !isSafeUrl(newSong.videoArt)) {
      lib.notify('Invalid or unsafe URL detected (only https:// or safe data/... paths allowed)', 'error');
      return;
    }
    const rawId = sanitizeText(newSong.id, 64).replace(/[^a-zA-Z0-9_-]/g, '');
    const id = rawId || `custom_${Date.now()}`;
    const artistId =
      sanitizeText(newSong.artistId, 64).replace(/[^a-zA-Z0-9_-]/g, '') ||
      `art_${artist.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    const songObj = {
      ...newSong,
      id,
      title,
      artist,
      artistId,
      album: sanitizeText(newSong.album, 160),
      albumId: sanitizeText(newSong.albumId, 64).replace(/[^a-zA-Z0-9_-]/g, '') || `alb_${id}`,
      aliases: sanitizeText(newSong.aliases, 240),
      audio: newSong.audio.trim() || newSong.preview.trim(),
      preview: newSong.preview.trim() || newSong.audio.trim(),
      videoArt: newSong.videoArt.trim() || null,
      duration: Math.max(1, Math.min(7200, Number(newSong.duration) || 200)),
      offset: Math.max(-60, Math.min(60, Number(newSong.offset) || 0)),
      colors: ['#fa2d48', '#5e5ce6', '#1c1c1e'],
    };
    if (newLrc.trim()) {
      songObj.lyrics = saveLyricsFromText(id, newLrc, songObj.duration) || songObj.lyrics;
    }
    admin.upsertSong(songObj, true);
    logSecurityEvent('SONG_ADDED', `${songObj.title} (${songObj.id})`);
    setSecLogs(getSecurityLogs());
    setNewSong({ ...EMPTY_SONG });
    setNewLrc('');
    lib.notify(`Added “${songObj.title}” to catalog`, 'success');
    setTab('songs');
  };

  const searchItunesForAdd = async (e) => {
    e.preventDefault();
    const cleaned = sanitizeText(itQuery, 120);
    if (!cleaned) return;
    setItBusy(true);
    try {
      const r = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleaned)}&entity=song&limit=8`
      ).then((x) => x.json());
      setItResults(r.results || []);
    } catch {
      lib.notify('iTunes lookup failed', 'error');
    } finally {
      setItBusy(false);
    }
  };

  const applyItunesPick = (r) => {
    const artTpl = (r.artworkUrl100 || '').replace(/\/\d+x\d+bb\.(jpg|png|webp)$/, '/{s}x{s}bb.jpg');
    setNewSong((prev) => ({
      ...prev,
      id: String(r.trackId),
      title: r.trackName || '',
      artist: r.artistName || '',
      artistId: String(r.artistId || ''),
      album: r.collectionName || '',
      albumId: String(r.collectionId || ''),
      art: artTpl,
      preview: r.previewUrl || '',
      audio: prev.audio || r.previewUrl || '',
      duration: Math.round((r.trackTimeMillis || 180000) / 1000),
      explicit: r.trackExplicitness === 'explicit',
      year: (r.releaseDate || '').slice(0, 4) || prev.year,
      appleUrl: r.trackViewUrl || '',
    }));
    setItResults([]);
    lib.notify(`Auto-filled metadata for “${r.trackName}” — paste your full audio URL if needed`, 'success');
  };

  const handleSaveArtist = (e) => {
    e.preventDefault();
    touchAdminSession();
    const cleanName = sanitizeText(editingArtist?.name, 120);
    if (!cleanName) {
      lib.notify('Artist name is required', 'error');
      return;
    }
    if (editingArtist.image && !isSafeUrl(editingArtist.image)) {
      lib.notify('Invalid or unsafe portrait URL', 'error');
      return;
    }
    admin.upsertArtist({
      ...editingArtist,
      name: cleanName,
      genre: sanitizeText(editingArtist.genre, 60),
      fans: Math.max(0, Number(editingArtist.fans) || 0),
    });
    setEditingArtist(null);
    lib.notify(`Updated artist “${cleanName}”`, 'success');
  };

  const handleSaveToLocalProject = async () => {
    touchAdminSession();
    setSavingDisk(true);
    try {
      const res = await fetch('/__studio/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Proof': getSessionAuthProof() || '',
        },
        body: JSON.stringify({
          catalog: stripInternalCatalogFields(catalog),
          siteConfig,
          lyricsOverrides: loadLyricsPatch(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lib.notify('Saved catalog.json, site-config.json & lyrics directly to public/data/', 'success');
    } catch {
      lib.notify('Direct disk save only works on local Vite dev server. Use Export JSON below for static hosting.', 'error');
    } finally {
      setSavingDisk(false);
    }
  };

  const handleImportBackup = (e) => {
    touchAdminSession();
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      lib.notify('Only .json backup files are allowed', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      lib.notify('Backup file exceeds 5 MB security limit', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const validated = validateBackupPayload(parsed);
        if (!validated) {
          lib.notify('Backup file failed schema/security validation', 'error');
          return;
        }
        if (validated.siteConfig) admin.updateSiteConfig(validated.siteConfig);
        if (validated.catalogPatch) admin.replacePatch(validated.catalogPatch);
        logSecurityEvent('BACKUP_IMPORTED', file.name);
        setSecLogs(getSecurityLogs());
        lib.notify('Imported validated backup successfully', 'success');
      } catch {
        lib.notify('Invalid JSON backup file', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleChangePasscode = async (e) => {
    e.preventDefault();
    touchAdminSession();
    if (containsScriptPayload(curPass) || containsScriptPayload(nextPass)) {
      lib.notify('Blocked: scripts are not allowed in password fields', 'error');
      return;
    }
    if (!(await verifyAdminPasscode(curPass))) {
      lib.notify('Current passcode is incorrect', 'error');
      return;
    }
    if (nextPass.trim().length < 8) {
      lib.notify('New password must be at least 8 characters', 'error');
      return;
    }
    await setAdminPasscode(nextPass.trim());
    setCurPass('');
    setNextPass('');
    setSecLogs(getSecurityLogs());
    lib.notify('Password updated (PBKDF2-SHA256, 210k iterations + random salt)', 'success');
  };

  // ------------------------------------------------------------------ FRAME-BUSTING & LOCKED SCREEN
  if (typeof window !== 'undefined' && window.self !== window.top) {
    return (
      <div className="page sp-gate-page">
        <div className="sp-gate-card glass">
          <div className="sp-badge">SECURITY BLOCK</div>
          <h1>Embedding Not Allowed</h1>
          <p>Private Console cannot run inside an embedded frame.</p>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="page sp-gate-page">
        <div className="sp-gate-card glass">
          <div className="sp-badge">PRIVATE ACCESS</div>
          <h1>Studio Console</h1>
          <p>Sign in with your operator credentials to manage songs, artists, lyrics, and global website settings.</p>
          <form onSubmit={handleLogin} className="sp-gate-form">
            <input
              type="text"
              value={userInput}
              onChange={(e) => {
                const val = e.target.value;
                if (containsScriptPayload(val)) {
                  setAuthErr('Blocked: script or HTML injection is not allowed.');
                  setUserInput(stripScriptChars(val, 64));
                  return;
                }
                setAuthErr('');
                setUserInput(stripScriptChars(val, 64));
              }}
              placeholder="Username"
              autoComplete="username"
              maxLength={64}
              autoFocus
              required
            />
            <input
              type="password"
              value={passInput}
              onChange={(e) => {
                const val = e.target.value;
                if (containsScriptPayload(val)) {
                  setAuthErr('Blocked: script or HTML injection is not allowed.');
                  setPassInput(stripScriptChars(val, 128));
                  return;
                }
                setAuthErr('');
                setPassInput(stripScriptChars(val, 128));
              }}
              placeholder="Password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
            {authErr && <div className="sp-err">{authErr}</div>}
            <button type="submit" className="pill-btn primary">
              <Check size={16} /> Sign In
            </button>
          </form>
          <button className="sp-back-link" onClick={() => navigate('/')}>
            ← Return to Music Player
          </button>
        </div>
      </div>
    );
  }

  const toggleGenreHidden = (gid) => {
    const cur = siteConfig.hiddenGenres || [];
    const next = cur.includes(gid) ? cur.filter((x) => x !== gid) : [...cur, gid];
    admin.updateSiteConfig({ ...siteConfig, hiddenGenres: next });
  };

  return (
    <div className="page sp-page">
      <header className="sp-header">
        <div>
          <div className="eyebrow">PRIVATE CONSOLE</div>
          <h1>Website & Catalog Control</h1>
        </div>
        <div className="sp-header-actions">
          <button className="pill-btn sm" onClick={() => navigate('/')}>
            View Website
          </button>
          <button className="pill-btn sm primary" onClick={handleSaveToLocalProject} disabled={savingDisk}>
            {savingDisk ? 'Saving…' : 'Save to Project Files'}
          </button>
          <button className="pill-btn sm" onClick={handleLock}>
            Lock Console
          </button>
        </div>
      </header>

      <div className="sp-stats">
        <div className="sp-stat-card">
          <span>Total Songs</span>
          <b>{allSongs.length}</b>
        </div>
        <div className="sp-stat-card">
          <span>Total Artists</span>
          <b>{allArtists.length}</b>
        </div>
        <div className="sp-stat-card">
          <span>Word-Synced Lyrics</span>
          <b>{allSongs.filter((s) => s.lyrics === 'synced').length}</b>
        </div>
        <div className="sp-stat-card">
          <span>Local Console Edits</span>
          <b>{modifiedIds.size + (patch.deletedSongIds?.length || 0)}</b>
        </div>
      </div>

      <div className="sp-tabs">
        <button className={tab === 'songs' ? 'on' : ''} onClick={() => setTab('songs')}>
          <Music size={16} /> Songs ({allSongs.length})
        </button>
        <button className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')}>
          <Plus size={16} /> Add Song
        </button>
        <button className={tab === 'artists' ? 'on' : ''} onClick={() => setTab('artists')}>
          <User size={16} /> Artists ({allArtists.length})
        </button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          <Gear size={16} /> Website Settings
        </button>
        <button className={tab === 'system' ? 'on' : ''} onClick={() => setTab('system')}>
          <Lyrics size={16} /> Export & Security
        </button>
      </div>

      {/* ============================ TAB 1: SONGS */}
      {tab === 'songs' && (
        <section className="sp-panel glass">
          <div className="sp-toolbar">
            <div className="sp-search-box">
              <Search size={15} />
              <input
                value={songQuery}
                onChange={(e) => setSongQuery(stripScriptChars(e.target.value, 120))}
                placeholder="Search any song by title, artist, album, or ID…"
              />
            </div>
            <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
              <option value="all">All Genres</option>
              {(catalog.genres || []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <label className="sp-check">
              <input type="checkbox" checked={onlyModified} onChange={(e) => setOnlyModified(e.target.checked)} />
              <span>Edited / Added Only</span>
            </label>
          </div>

          <div className="sp-table-wrap">
            {filteredSongs.slice(0, 120).map((s) => (
              <div key={s.id} className="sp-song-row">
                <img src={art(s.art, 120)} alt="" />
                <div className="asr-info">
                  <div className="asr-title">
                    {s.title} {modifiedIds.has(s.id) && <span className="asr-tag">EDITED</span>}
                  </div>
                  <div className="asr-sub">
                    {s.artist} · {s.album || 'Single'} · <code>{s.genre}</code> · {Math.round(s.duration || 0)}s · ID: <code>{s.id}</code>
                  </div>
                </div>
                <div className="asr-actions">
                  <button className="pill-btn sm" onClick={() => player.playSong(s, filteredSongs)} title="Preview Play">
                    <Play size={13} />
                  </button>
                  <button className="pill-btn sm" onClick={() => openSongEditor(s)}>
                    Edit
                  </button>
                  <button
                    className="pill-btn sm danger"
                    onClick={() => {
                      if (window.confirm(`Delete “${s.title}” by ${s.artist} from catalog?`)) {
                        admin.deleteSong(s.id);
                        lib.notify(`Deleted “${s.title}”`, 'success');
                      }
                    }}
                    title="Delete Song"
                  >
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            ))}
            {filteredSongs.length > 120 && (
              <div className="sp-note">Showing first 120 of {filteredSongs.length} songs — use search to filter.</div>
            )}
          </div>
        </section>
      )}

      {/* ============================ TAB 2: ADD NEW SONG */}
      {tab === 'add' && (
        <section className="sp-panel glass">
          <h2>Auto-Fill Metadata from iTunes (Optional)</h2>
          <form className="sp-itunes-bar" onSubmit={searchItunesForAdd}>
            <input
              value={itQuery}
              onChange={(e) => setItQuery(stripScriptChars(e.target.value, 120))}
              placeholder="Search song + artist on iTunes (e.g. Blinding Lights The Weeknd)…"
            />
            <button type="submit" className="pill-btn sm primary" disabled={itBusy}>
              {itBusy ? 'Searching…' : 'Search iTunes'}
            </button>
          </form>
          {itResults.length > 0 && (
            <div className="sp-it-results">
              {itResults.map((r) => (
                <div key={r.trackId} className="sp-it-item" onClick={() => applyItunesPick(r)}>
                  <img src={r.artworkUrl100} alt="" />
                  <div>
                    <b>{r.trackName}</b>
                    <span>{r.artistName} · {r.collectionName}</span>
                  </div>
                  <button type="button" className="pill-btn sm">Use</button>
                </div>
              ))}
            </div>
          )}

          <h2 style={{ marginTop: 20 }}>Song Details</h2>
          <form className="sp-form-grid" onSubmit={handleAddSong}>
            <label>
              Title *
              <input value={newSong.title} onChange={(e) => setNewSong({ ...newSong, title: stripScriptChars(e.target.value, 160) })} required />
            </label>
            <label>
              Artist *
              <input value={newSong.artist} onChange={(e) => setNewSong({ ...newSong, artist: stripScriptChars(e.target.value, 160) })} required />
            </label>
            <label>
              Album
              <input value={newSong.album} onChange={(e) => setNewSong({ ...newSong, album: stripScriptChars(e.target.value, 160) })} />
            </label>
            <label>
              Genre
              <select value={newSong.genre} onChange={(e) => setNewSong({ ...newSong, genre: e.target.value })}>
                {(catalog.genres || []).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Full-Length Audio URL / Path * (e.g. <code>data/audio/my_song.m4a</code> or direct MP3/M4A URL)
              <input value={newSong.audio} onChange={(e) => setNewSong({ ...newSong, audio: stripScriptChars(e.target.value, 500) })} required />
            </label>
            <label className="span-2">
              Cover Artwork URL (supports <code>{'{s}'}</code> template or direct JPG/PNG URL)
              <input value={newSong.art} onChange={(e) => setNewSong({ ...newSong, art: stripScriptChars(e.target.value, 500) })} />
            </label>
            <label className="span-2">
              Animated Motion Video URL (optional MP4)
              <input value={newSong.videoArt} onChange={(e) => setNewSong({ ...newSong, videoArt: stripScriptChars(e.target.value, 500) })} />
            </label>
            <label>
              Duration (seconds)
              <input type="number" value={newSong.duration} onChange={(e) => setNewSong({ ...newSong, duration: e.target.value })} />
            </label>
            <label>
              Release Year
              <input value={newSong.year} onChange={(e) => setNewSong({ ...newSong, year: stripScriptChars(e.target.value, 10) })} />
            </label>
            <label>
              Custom Track ID (optional)
              <input value={newSong.id} onChange={(e) => setNewSong({ ...newSong, id: stripScriptChars(e.target.value, 64) })} placeholder="Auto-generated if empty" />
            </label>
            <label>
              Search Aliases (optional)
              <input value={newSong.aliases} onChange={(e) => setNewSong({ ...newSong, aliases: stripScriptChars(e.target.value, 240) })} placeholder="Alt spellings, movie name…" />
            </label>
            <label className="span-2">
              Synced LRC or Plain Lyrics (optional — paste <code>[00:12.34] Line</code> for word-by-word karaoke sync)
              <textarea rows={5} value={newLrc} onChange={(e) => setNewLrc(stripScriptChars(e.target.value, 25000))} placeholder="[00:05.00] First line of lyrics..." />
            </label>
            <label className="sp-check">
              <input type="checkbox" checked={newSong.explicit} onChange={(e) => setNewSong({ ...newSong, explicit: e.target.checked })} />
              <span>Explicit Track</span>
            </label>
            <div className="span-2">
              <button type="submit" className="pill-btn primary">
                <Plus size={16} /> Add Song to Live Catalog
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ============================ TAB 3: ARTISTS */}
      {tab === 'artists' && (
        <section className="sp-panel glass">
          <div className="sp-toolbar">
            <div className="sp-search-box">
              <Search size={15} />
              <input value={artistQuery} onChange={(e) => setArtistQuery(stripScriptChars(e.target.value, 120))} placeholder="Search artists…" />
            </div>
          </div>
          <div className="sp-table-wrap">
            {filteredArtists.slice(0, 100).map((a) => (
              <div key={a.id} className="sp-song-row">
                <img className="round" src={a.image || 'logo.png'} alt="" />
                <div className="asr-info">
                  <div className="asr-title">{a.name}</div>
                  <div className="asr-sub">
                    {a.genre} · {(a.fans || 0).toLocaleString()} fans · ID: <code>{a.id}</code>
                  </div>
                </div>
                <div className="asr-actions">
                  <button className="pill-btn sm" onClick={() => setEditingArtist({ ...a })}>Edit</button>
                  <button
                    className="pill-btn sm danger"
                    onClick={() => {
                      if (window.confirm(`Delete artist “${a.name}”?`)) {
                        admin.deleteArtist(a.id);
                        lib.notify(`Deleted artist “${a.name}”`, 'success');
                      }
                    }}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============================ TAB 4: WEBSITE SETTINGS */}
      {tab === 'settings' && (
        <section className="sp-panel glass">
          <h2>Global Website Branding & Appearance</h2>
          <div className="sp-form-grid">
            <label>
              Website Brand Name
              <input
                value={siteConfig.siteName}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, siteName: stripScriptChars(e.target.value, 60) })}
              />
            </label>
            <label>
              Logo URL / Path
              <input
                value={siteConfig.logoUrl}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, logoUrl: stripScriptChars(e.target.value, 300) })}
              />
            </label>
            <label className="span-2">
              Splash Tagline
              <input
                value={siteConfig.tagline}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, tagline: stripScriptChars(e.target.value, 140) })}
              />
            </label>
            <label className="span-2">
              Footer Description
              <input
                value={siteConfig.footerDesc}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, footerDesc: stripScriptChars(e.target.value, 300) })}
              />
            </label>
            <label className="span-2">
              Top Site Announcement Banner (leave empty to hide)
              <input
                value={siteConfig.announcement}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, announcement: stripScriptChars(e.target.value, 180) })}
                placeholder="e.g. New Tamil & J-Pop songs just added!"
              />
            </label>
            <label>
              Primary Accent Color ({siteConfig.accentColor})
              <input
                type="color"
                value={siteConfig.accentColor}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, accentColor: e.target.value })}
              />
            </label>
            <label>
              Secondary Accent Color ({siteConfig.accentColor2})
              <input
                type="color"
                value={siteConfig.accentColor2}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, accentColor2: e.target.value })}
              />
            </label>
            <label>
              Background Color ({siteConfig.bgColor})
              <input
                type="color"
                value={siteConfig.bgColor}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, bgColor: e.target.value })}
              />
            </label>
            <label>
              Ambient Fluid Glow Opacity ({Math.round((siteConfig.fluidIntensity ?? 0.75) * 100)}%)
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={siteConfig.fluidIntensity ?? 0.75}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, fluidIntensity: parseFloat(e.target.value) })}
              />
            </label>
          </div>

          <h2 style={{ marginTop: 24 }}>Feature Switches</h2>
          <div className="sp-toggle-grid">
            {[
              ['enableFluidBg', 'Animated Fluid Background'],
              ['enableMotionArt', 'Animated Motion Album Covers'],
              ['enableLyrics', 'Word-by-Word Synced Lyrics'],
              ['enableSplash', 'Opening Splash Screen'],
              ['maintenanceMode', 'Maintenance Mode (blocks public visitors, keeps Private Console open)'],
            ].map(([key, label]) => (
              <label key={key} className="sp-check card">
                <input
                  type="checkbox"
                  checked={Boolean(siteConfig[key])}
                  onChange={(e) => admin.updateSiteConfig({ ...siteConfig, [key]: e.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {siteConfig.maintenanceMode && (
            <div className="sp-form-grid" style={{ marginTop: 14 }}>
              <label className="span-2">
                Maintenance Message
                <input
                  value={siteConfig.maintenanceMessage}
                  onChange={(e) => admin.updateSiteConfig({ ...siteConfig, maintenanceMessage: stripScriptChars(e.target.value, 240) })}
                />
              </label>
            </div>
          )}

          <h2 style={{ marginTop: 24 }}>Visible Genres</h2>
          <div className="sp-genre-pills">
            {(catalog.genres || []).map((g) => {
              const hidden = (siteConfig.hiddenGenres || []).includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`g-pill ${!hidden ? 'on' : ''}`}
                  onClick={() => toggleGenreHidden(g.id)}
                >
                  {hidden ? 'Hidden: ' : 'Shown: '} {g.name}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 22 }}>
            <button
              type="button"
              className="pill-btn sm"
              onClick={() => {
                admin.updateSiteConfig({ ...DEFAULT_SITE_CONFIG });
                lib.notify('Restored default site settings', 'success');
              }}
            >
              Reset Settings to Default
            </button>
          </div>
        </section>
      )}

      {/* ============================ TAB 5: EXPORT & SECURITY */}
      {tab === 'system' && (
        <section className="sp-panel glass">
          <h2>Export & Deploy Changes</h2>
          <p className="sp-note">
            All changes you make apply immediately in your browser. To publish them for every visitor on static hosting,
            click <b>Save to Project Files</b> (when running locally) or export the JSON files below and place them in{' '}
            <code>public/data/</code>.
          </p>
          <div className="sp-export-row">
            <button
              className="pill-btn primary"
              onClick={() => downloadJSON('catalog.json', stripInternalCatalogFields(catalog))}
            >
              Download catalog.json
            </button>
            <button className="pill-btn" onClick={() => downloadJSON('site-config.json', siteConfig)}>
              Download site-config.json
            </button>
            <button
              className="pill-btn"
              onClick={() =>
                downloadJSON('studio-backup.json', {
                  siteConfig,
                  catalogPatch: loadCatalogPatch(),
                  lyricsPatch: loadLyricsPatch(),
                })
              }
            >
              Export Full Backup
            </button>
            <label className="pill-btn" style={{ cursor: 'pointer' }}>
              Import Backup JSON
              <input type="file" accept="application/json" onChange={handleImportBackup} style={{ display: 'none' }} />
            </label>
          </div>

          <h2 style={{ marginTop: 28 }}>Change Console Passcode</h2>
          <form className="sp-form-grid" onSubmit={handleChangePasscode} style={{ maxWidth: 520 }}>
            <label>
              Current Passcode
              <input
                type="password"
                value={curPass}
                onChange={(e) => setCurPass(stripScriptChars(e.target.value, 128))}
                maxLength={128}
                required
              />
            </label>
            <label>
              New Passcode
              <input
                type="password"
                value={nextPass}
                onChange={(e) => setNextPass(stripScriptChars(e.target.value, 128))}
                maxLength={128}
                required
              />
            </label>
            <div className="span-2">
              <button type="submit" className="pill-btn primary">Update Passcode</button>
            </div>
          </form>

          <h2 style={{ marginTop: 28 }}>Security Activity Monitor ({secLogs.length})</h2>
          <div className="sp-table-wrap" style={{ maxHeight: 220, marginBottom: 12 }}>
            {secLogs.length === 0 ? (
              <div className="sp-note">No security events recorded yet.</div>
            ) : (
              secLogs.map((l, idx) => (
                <div key={idx} className="sp-song-row">
                  <div className="asr-info">
                    <div className="asr-title">
                      <code>{l.event}</code>
                    </div>
                    <div className="asr-sub">
                      {l.ts.replace('T', ' ').slice(0, 19)} UTC · {l.detail}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {secLogs.length > 0 && (
            <button
              type="button"
              className="pill-btn sm"
              onClick={() => {
                clearSecurityLogs();
                setSecLogs([]);
                lib.notify('Cleared security activity log', 'success');
              }}
            >
              Clear Security Log
            </button>
          )}

          <h2 style={{ marginTop: 28 }}>Danger Zone</h2>
          <button
            className="pill-btn danger"
            onClick={() => {
              if (window.confirm('Reset all local browser overrides (songs, artists, lyrics, settings)?')) {
                resetAllAdminOverrides();
                admin.reloadFromBase();
                lib.notify('All local overrides cleared', 'success');
              }
            }}
          >
            <Trash size={15} /> Reset All Local Overrides
          </button>
        </section>
      )}

      {/* ============================ SONG EDITOR MODAL */}
      {editingSong && (
        <div className="sp-modal-backdrop" onClick={() => setEditingSong(null)}>
          <div className="sp-modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-head">
              <h2>Edit Song</h2>
              <button className="icon-btn" onClick={() => setEditingSong(null)}><Close size={18} /></button>
            </div>
            <form className="sp-form-grid" onSubmit={handleSaveEditedSong}>
              <label>
                Title
                <input value={editingSong.title} onChange={(e) => setEditingSong({ ...editingSong, title: stripScriptChars(e.target.value, 160) })} required />
              </label>
              <label>
                Artist
                <input value={editingSong.artist} onChange={(e) => setEditingSong({ ...editingSong, artist: stripScriptChars(e.target.value, 160) })} required />
              </label>
              <label>
                Album
                <input value={editingSong.album} onChange={(e) => setEditingSong({ ...editingSong, album: stripScriptChars(e.target.value, 160) })} />
              </label>
              <label>
                Genre
                <select value={editingSong.genre} onChange={(e) => setEditingSong({ ...editingSong, genre: e.target.value })}>
                  {(catalog.genres || []).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Audio URL / Local Path
                <input value={editingSong.audio || ''} onChange={(e) => setEditingSong({ ...editingSong, audio: stripScriptChars(e.target.value, 500) })} />
              </label>
              <label className="span-2">
                Artwork URL
                <input value={editingSong.art || ''} onChange={(e) => setEditingSong({ ...editingSong, art: stripScriptChars(e.target.value, 500) })} />
              </label>
              <label className="span-2">
                Animated Motion Video URL (optional MP4)
                <input value={editingSong.videoArt || ''} onChange={(e) => setEditingSong({ ...editingSong, videoArt: stripScriptChars(e.target.value, 500) })} />
              </label>
              <label>
                Duration (s)
                <input type="number" step="0.1" value={editingSong.duration} onChange={(e) => setEditingSong({ ...editingSong, duration: e.target.value })} />
              </label>
              <label>
                Year
                <input value={editingSong.year || ''} onChange={(e) => setEditingSong({ ...editingSong, year: stripScriptChars(e.target.value, 10) })} />
              </label>
              <label>
                Lyrics Offset (s)
                <input type="number" step="0.1" value={editingSong.offset || 0} onChange={(e) => setEditingSong({ ...editingSong, offset: e.target.value })} />
              </label>
              <label>
                Search Aliases
                <input value={editingSong.aliases || ''} onChange={(e) => setEditingSong({ ...editingSong, aliases: stripScriptChars(e.target.value, 240) })} />
              </label>
              <label className="span-2">
                Override Lyrics (paste LRC <code>[mm:ss.xx]</code> for word-by-word sync, or plain text)
                <textarea rows={4} value={editingLrc} onChange={(e) => setEditingLrc(stripScriptChars(e.target.value, 25000))} placeholder="Leave empty to keep existing lyrics" />
              </label>
              <label className="sp-check">
                <input type="checkbox" checked={Boolean(editingSong.explicit)} onChange={(e) => setEditingSong({ ...editingSong, explicit: e.target.checked })} />
                <span>Explicit</span>
              </label>
              <div className="span-2 sp-modal-foot">
                <button type="button" className="pill-btn" onClick={() => setEditingSong(null)}>Cancel</button>
                <button type="submit" className="pill-btn primary"><Check size={15} /> Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================ ARTIST EDITOR MODAL */}
      {editingArtist && (
        <div className="sp-modal-backdrop" onClick={() => setEditingArtist(null)}>
          <div className="sp-modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-head">
              <h2>Edit Artist</h2>
              <button className="icon-btn" onClick={() => setEditingArtist(null)}><Close size={18} /></button>
            </div>
            <form className="sp-form-grid" onSubmit={handleSaveArtist}>
              <label>
                Artist Name
                <input value={editingArtist.name} onChange={(e) => setEditingArtist({ ...editingArtist, name: stripScriptChars(e.target.value, 120) })} required />
              </label>
              <label>
                Primary Genre
                <input value={editingArtist.genre || ''} onChange={(e) => setEditingArtist({ ...editingArtist, genre: stripScriptChars(e.target.value, 60) })} />
              </label>
              <label className="span-2">
                Portrait Image URL
                <input value={editingArtist.image || ''} onChange={(e) => setEditingArtist({ ...editingArtist, image: stripScriptChars(e.target.value, 500) })} />
              </label>
              <label>
                Fans Count (affects Top Artists order)
                <input type="number" value={editingArtist.fans || 0} onChange={(e) => setEditingArtist({ ...editingArtist, fans: e.target.value })} />
              </label>
              <div className="span-2 sp-modal-foot">
                <button type="button" className="pill-btn" onClick={() => setEditingArtist(null)}>Cancel</button>
                <button type="submit" className="pill-btn primary"><Check size={15} /> Save Artist</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
