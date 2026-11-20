import { useEffect, useMemo, useState } from 'react';
import { art, buildWordSyncedFromLrc } from '../api';
import {
  clearSecurityLogs,
  DEFAULT_SITE_CONFIG,
  downloadJSON,
  getLyricsOverride,
  getSecurityLogs,
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
  touchAdminSession,
  validateBackupPayload,
  verifyAdminCredentials,
  verifyAdminPasscode,
} from '../adminStore';
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

export default function AdminPage() {
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
        lib.notify('Endministrator session expired — please sign in again', 'error');
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
    setAuthErr('');
    const res = await verifyAdminCredentials(userInput, passInput);
    if (res.ok) {
      setAuthed(true);
      setUserInput('');
      setPassInput('');
      lib.notify('Endministrator unlocked', 'success');
    } else if (res.lockedSeconds) {
      setAuthErr(`Too many failed attempts. Try again in ${res.lockedSeconds}s.`);
    } else {
      setAuthErr('Incorrect username or password.');
    }
  };

  const handleLock = () => {
    setAdminAuthenticated(false);
    setAuthed(false);
    lib.notify('Endministrator locked', 'success');
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
    const trimmed = (rawText || '').trim();
    if (!trimmed) return null;
    const hasTimestamps = /\[\d+:\d+(?:[.:]\d+)?\]/.test(trimmed);
    if (hasTimestamps) {
      const lines = buildWordSyncedFromLrc(trimmed, Number(duration) || 200);
      const plain = trimmed.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, '').trim();
      const payload = { id: songId, synced: true, offset: 0, source: 'admin', lines, plain, rawLrc: trimmed };
      saveLyricsOverride(songId, payload);
      return 'synced';
    }
    const payload = { id: songId, synced: false, offset: 0, source: 'admin', lines: [], plain: trimmed };
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
    if (!itQuery.trim()) return;
    setItBusy(true);
    try {
      const r = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(itQuery.trim())}&entity=song&limit=8`
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
    if (!editingArtist?.name?.trim()) return;
    admin.upsertArtist({
      ...editingArtist,
      fans: Number(editingArtist.fans) || 0,
    });
    setEditingArtist(null);
    lib.notify(`Updated artist “${editingArtist.name}”`, 'success');
  };

  const handleSaveToLocalProject = async () => {
    setSavingDisk(true);
    try {
      const res = await fetch('/__admin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        lib.notify('Imported validated admin backup successfully', 'success');
      } catch {
        lib.notify('Invalid JSON backup file', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleChangePasscode = async (e) => {
    e.preventDefault();
    touchAdminSession();
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

  // ------------------------------------------------------------------ LOCKED SCREEN
  if (!authed) {
    return (
      <div className="page admin-gate-page">
        <div className="admin-gate-card glass">
          <div className="admin-badge">PRIVATE ACCESS</div>
          <h1>Endministrator</h1>
          <p>Sign in with your Endministrator credentials to manage songs, artists, lyrics, and global website settings.</p>
          <form onSubmit={handleLogin} className="admin-gate-form">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              autoFocus
              required
            />
            <input
              type="password"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            {authErr && <div className="admin-err">{authErr}</div>}
            <button type="submit" className="pill-btn primary">
              <Check size={16} /> Sign In
            </button>
          </form>
          <button className="admin-back-link" onClick={() => navigate('/')}>
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
    <div className="page admin-page">
      <header className="admin-header">
        <div>
          <div className="eyebrow">ENDMINISTRATOR</div>
          <h1>Website & Catalog Control</h1>
        </div>
        <div className="admin-header-actions">
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

      <div className="admin-stats">
        <div className="admin-stat-card">
          <span>Total Songs</span>
          <b>{allSongs.length}</b>
        </div>
        <div className="admin-stat-card">
          <span>Total Artists</span>
          <b>{allArtists.length}</b>
        </div>
        <div className="admin-stat-card">
          <span>Word-Synced Lyrics</span>
          <b>{allSongs.filter((s) => s.lyrics === 'synced').length}</b>
        </div>
        <div className="admin-stat-card">
          <span>Local Admin Edits</span>
          <b>{modifiedIds.size + (patch.deletedSongIds?.length || 0)}</b>
        </div>
      </div>

      <div className="admin-tabs">
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
        <section className="admin-panel glass">
          <div className="admin-toolbar">
            <div className="admin-search-box">
              <Search size={15} />
              <input
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
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
            <label className="admin-check">
              <input type="checkbox" checked={onlyModified} onChange={(e) => setOnlyModified(e.target.checked)} />
              <span>Edited / Added Only</span>
            </label>
          </div>

          <div className="admin-table-wrap">
            {filteredSongs.slice(0, 120).map((s) => (
              <div key={s.id} className="admin-song-row">
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
              <div className="admin-note">Showing first 120 of {filteredSongs.length} songs — use search to filter.</div>
            )}
          </div>
        </section>
      )}

      {/* ============================ TAB 2: ADD NEW SONG */}
      {tab === 'add' && (
        <section className="admin-panel glass">
          <h2>Auto-Fill Metadata from iTunes (Optional)</h2>
          <form className="admin-itunes-bar" onSubmit={searchItunesForAdd}>
            <input
              value={itQuery}
              onChange={(e) => setItQuery(e.target.value)}
              placeholder="Search song + artist on iTunes (e.g. Blinding Lights The Weeknd)…"
            />
            <button type="submit" className="pill-btn sm primary" disabled={itBusy}>
              {itBusy ? 'Searching…' : 'Search iTunes'}
            </button>
          </form>
          {itResults.length > 0 && (
            <div className="admin-it-results">
              {itResults.map((r) => (
                <div key={r.trackId} className="admin-it-item" onClick={() => applyItunesPick(r)}>
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
          <form className="admin-form-grid" onSubmit={handleAddSong}>
            <label>
              Title *
              <input value={newSong.title} onChange={(e) => setNewSong({ ...newSong, title: e.target.value })} required />
            </label>
            <label>
              Artist *
              <input value={newSong.artist} onChange={(e) => setNewSong({ ...newSong, artist: e.target.value })} required />
            </label>
            <label>
              Album
              <input value={newSong.album} onChange={(e) => setNewSong({ ...newSong, album: e.target.value })} />
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
              <input value={newSong.audio} onChange={(e) => setNewSong({ ...newSong, audio: e.target.value })} required />
            </label>
            <label className="span-2">
              Cover Artwork URL (supports <code>{'{s}'}</code> template or direct JPG/PNG URL)
              <input value={newSong.art} onChange={(e) => setNewSong({ ...newSong, art: e.target.value })} />
            </label>
            <label className="span-2">
              Animated Motion Video URL (optional MP4)
              <input value={newSong.videoArt} onChange={(e) => setNewSong({ ...newSong, videoArt: e.target.value })} />
            </label>
            <label>
              Duration (seconds)
              <input type="number" value={newSong.duration} onChange={(e) => setNewSong({ ...newSong, duration: e.target.value })} />
            </label>
            <label>
              Release Year
              <input value={newSong.year} onChange={(e) => setNewSong({ ...newSong, year: e.target.value })} />
            </label>
            <label>
              Custom Track ID (optional)
              <input value={newSong.id} onChange={(e) => setNewSong({ ...newSong, id: e.target.value })} placeholder="Auto-generated if empty" />
            </label>
            <label>
              Search Aliases (optional)
              <input value={newSong.aliases} onChange={(e) => setNewSong({ ...newSong, aliases: e.target.value })} placeholder="Alt spellings, movie name…" />
            </label>
            <label className="span-2">
              Synced LRC or Plain Lyrics (optional — paste <code>[00:12.34] Line</code> for word-by-word karaoke sync)
              <textarea rows={5} value={newLrc} onChange={(e) => setNewLrc(e.target.value)} placeholder="[00:05.00] First line of lyrics..." />
            </label>
            <label className="admin-check">
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
        <section className="admin-panel glass">
          <div className="admin-toolbar">
            <div className="admin-search-box">
              <Search size={15} />
              <input value={artistQuery} onChange={(e) => setArtistQuery(e.target.value)} placeholder="Search artists…" />
            </div>
          </div>
          <div className="admin-table-wrap">
            {filteredArtists.slice(0, 100).map((a) => (
              <div key={a.id} className="admin-song-row">
                <img className="round" src={a.image || 'logo.jpg'} alt="" />
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
        <section className="admin-panel glass">
          <h2>Global Website Branding & Appearance</h2>
          <div className="admin-form-grid">
            <label>
              Website Brand Name
              <input
                value={siteConfig.siteName}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, siteName: e.target.value })}
              />
            </label>
            <label>
              Logo URL / Path
              <input
                value={siteConfig.logoUrl}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, logoUrl: e.target.value })}
              />
            </label>
            <label className="span-2">
              Splash Tagline
              <input
                value={siteConfig.tagline}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, tagline: e.target.value })}
              />
            </label>
            <label className="span-2">
              Footer Description
              <input
                value={siteConfig.footerDesc}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, footerDesc: e.target.value })}
              />
            </label>
            <label className="span-2">
              Top Site Announcement Banner (leave empty to hide)
              <input
                value={siteConfig.announcement}
                onChange={(e) => admin.updateSiteConfig({ ...siteConfig, announcement: e.target.value })}
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
          <div className="admin-toggle-grid">
            {[
              ['enableFluidBg', 'Animated Fluid Background'],
              ['enableMotionArt', 'Animated Motion Album Covers'],
              ['enableLyrics', 'Word-by-Word Synced Lyrics'],
              ['enableSplash', 'Opening Splash Screen'],
              ['maintenanceMode', 'Maintenance Mode (blocks regular users, keeps Admin open)'],
            ].map(([key, label]) => (
              <label key={key} className="admin-check card">
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
            <div className="admin-form-grid" style={{ marginTop: 14 }}>
              <label className="span-2">
                Maintenance Message
                <input
                  value={siteConfig.maintenanceMessage}
                  onChange={(e) => admin.updateSiteConfig({ ...siteConfig, maintenanceMessage: e.target.value })}
                />
              </label>
            </div>
          )}

          <h2 style={{ marginTop: 24 }}>Visible Genres</h2>
          <div className="admin-genre-pills">
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
        <section className="admin-panel glass">
          <h2>Export & Deploy Changes</h2>
          <p className="admin-note">
            All changes you make apply immediately in your browser. To publish them for every visitor on static hosting,
            click <b>Save to Project Files</b> (when running locally) or export the JSON files below and place them in{' '}
            <code>public/data/</code>.
          </p>
          <div className="admin-export-row">
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
                downloadJSON('admin-backup.json', {
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

          <h2 style={{ marginTop: 28 }}>Change Admin Passcode</h2>
          <form className="admin-form-grid" onSubmit={handleChangePasscode} style={{ maxWidth: 520 }}>
            <label>
              Current Passcode
              <input type="password" value={curPass} onChange={(e) => setCurPass(e.target.value)} required />
            </label>
            <label>
              New Passcode
              <input type="password" value={nextPass} onChange={(e) => setNextPass(e.target.value)} required />
            </label>
            <div className="span-2">
              <button type="submit" className="pill-btn primary">Update Passcode</button>
            </div>
          </form>

          <h2 style={{ marginTop: 28 }}>Security Activity Monitor ({secLogs.length})</h2>
          <div className="admin-table-wrap" style={{ maxHeight: 220, marginBottom: 12 }}>
            {secLogs.length === 0 ? (
              <div className="admin-note">No security events recorded yet.</div>
            ) : (
              secLogs.map((l, idx) => (
                <div key={idx} className="admin-song-row">
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
              if (window.confirm('Reset all local browser admin overrides (songs, artists, lyrics, settings)?')) {
                resetAllAdminOverrides();
                admin.reloadFromBase();
                lib.notify('All local admin overrides cleared', 'success');
              }
            }}
          >
            <Trash size={15} /> Reset All Local Admin Overrides
          </button>
        </section>
      )}

      {/* ============================ SONG EDITOR MODAL */}
      {editingSong && (
        <div className="admin-modal-backdrop" onClick={() => setEditingSong(null)}>
          <div className="admin-modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <h2>Edit Song</h2>
              <button className="icon-btn" onClick={() => setEditingSong(null)}><Close size={18} /></button>
            </div>
            <form className="admin-form-grid" onSubmit={handleSaveEditedSong}>
              <label>
                Title
                <input value={editingSong.title} onChange={(e) => setEditingSong({ ...editingSong, title: e.target.value })} required />
              </label>
              <label>
                Artist
                <input value={editingSong.artist} onChange={(e) => setEditingSong({ ...editingSong, artist: e.target.value })} required />
              </label>
              <label>
                Album
                <input value={editingSong.album} onChange={(e) => setEditingSong({ ...editingSong, album: e.target.value })} />
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
                <input value={editingSong.audio || ''} onChange={(e) => setEditingSong({ ...editingSong, audio: e.target.value })} />
              </label>
              <label className="span-2">
                Artwork URL
                <input value={editingSong.art || ''} onChange={(e) => setEditingSong({ ...editingSong, art: e.target.value })} />
              </label>
              <label className="span-2">
                Animated Motion Video URL (optional MP4)
                <input value={editingSong.videoArt || ''} onChange={(e) => setEditingSong({ ...editingSong, videoArt: e.target.value })} />
              </label>
              <label>
                Duration (s)
                <input type="number" step="0.1" value={editingSong.duration} onChange={(e) => setEditingSong({ ...editingSong, duration: e.target.value })} />
              </label>
              <label>
                Year
                <input value={editingSong.year || ''} onChange={(e) => setEditingSong({ ...editingSong, year: e.target.value })} />
              </label>
              <label>
                Lyrics Offset (s)
                <input type="number" step="0.1" value={editingSong.offset || 0} onChange={(e) => setEditingSong({ ...editingSong, offset: e.target.value })} />
              </label>
              <label>
                Search Aliases
                <input value={editingSong.aliases || ''} onChange={(e) => setEditingSong({ ...editingSong, aliases: e.target.value })} />
              </label>
              <label className="span-2">
                Override Lyrics (paste LRC <code>[mm:ss.xx]</code> for word-by-word sync, or plain text)
                <textarea rows={4} value={editingLrc} onChange={(e) => setEditingLrc(e.target.value)} placeholder="Leave empty to keep existing lyrics" />
              </label>
              <label className="admin-check">
                <input type="checkbox" checked={Boolean(editingSong.explicit)} onChange={(e) => setEditingSong({ ...editingSong, explicit: e.target.checked })} />
                <span>Explicit</span>
              </label>
              <div className="span-2 admin-modal-foot">
                <button type="button" className="pill-btn" onClick={() => setEditingSong(null)}>Cancel</button>
                <button type="submit" className="pill-btn primary"><Check size={15} /> Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================ ARTIST EDITOR MODAL */}
      {editingArtist && (
        <div className="admin-modal-backdrop" onClick={() => setEditingArtist(null)}>
          <div className="admin-modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <h2>Edit Artist</h2>
              <button className="icon-btn" onClick={() => setEditingArtist(null)}><Close size={18} /></button>
            </div>
            <form className="admin-form-grid" onSubmit={handleSaveArtist}>
              <label>
                Artist Name
                <input value={editingArtist.name} onChange={(e) => setEditingArtist({ ...editingArtist, name: e.target.value })} required />
              </label>
              <label>
                Primary Genre
                <input value={editingArtist.genre || ''} onChange={(e) => setEditingArtist({ ...editingArtist, genre: e.target.value })} />
              </label>
              <label className="span-2">
                Portrait Image URL
                <input value={editingArtist.image || ''} onChange={(e) => setEditingArtist({ ...editingArtist, image: e.target.value })} />
              </label>
              <label>
                Fans Count (affects Top Artists order)
                <input type="number" value={editingArtist.fans || 0} onChange={(e) => setEditingArtist({ ...editingArtist, fans: e.target.value })} />
              </label>
              <div className="span-2 admin-modal-foot">
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
