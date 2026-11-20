// Admin storage, passcode hashing (Web Crypto SHA-256), catalog/lyrics overrides & site config

export const ADMIN_ROUTE = '/endministrator';

// SHA-256 hashes of allowed usernames & default password (plaintext is never stored in bundle)
const ALLOWED_USER_HASHES = new Set([
  'd61d2a3588dc176c0476ec4bce6be1fbcccfa99949f223591def2a2d13617bc0',
  'b7f620e83826f58bd2b3773010afd8133ea04605074d0af971fbe36e8975112f',
]);
const DEFAULT_PASS_HASH = '4dbb1f9b930e42ee1e6a41789412c2ef45c4e6e8f34b743c479b6085ab498a9c';

export const DEFAULT_SITE_CONFIG = {
  siteName: 'apple music',
  tagline: 'Lossless · Word-Synced Lyrics · Animated Motion',
  footerDesc:
    'Personal full-length 320 kbps streaming experience with word-by-word synchronized karaoke lyrics and animated motion artwork.',
  logoUrl: 'logo.jpg',
  accentColor: '#fa2d48',
  accentColor2: '#ff375f',
  bgColor: '#000000',
  fluidIntensity: 0.75,
  enableFluidBg: true,
  enableMotionArt: true,
  enableLyrics: true,
  enableSplash: true,
  announcement: '',
  maintenanceMode: false,
  maintenanceMessage: 'We are updating the music catalog. Please check back shortly.',
  defaultVolume: 0.9,
  defaultLyricSize: 1,
  hiddenGenres: [],
};

const KEYS = {
  config: 'am_admin_site_config',
  catalogPatch: 'am_admin_catalog_patch',
  lyricsPatch: 'am_admin_lyrics_patch',
  passHash: 'am_admin_pass_hash',
};

// Strictly private in-memory auth state (cannot be spoofed via sessionStorage/localStorage)
let _inMemoryAuthed = false;
let _failedAttempts = 0;
let _lockedUntil = 0;

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyAdminPasscode(input) {
  const h = await sha256Hex(String(input || '').trim());
  const stored = localStorage.getItem(KEYS.passHash) || DEFAULT_PASS_HASH;
  return h === stored;
}

export async function verifyAdminCredentials(username, password) {
  if (Date.now() < _lockedUntil) {
    return { ok: false, lockedSeconds: Math.ceil((_lockedUntil - Date.now()) / 1000) };
  }
  const normalizedUser = String(username || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const userHash = await sha256Hex(normalizedUser);
  const passOk = await verifyAdminPasscode(password);
  if (ALLOWED_USER_HASHES.has(userHash) && passOk) {
    _failedAttempts = 0;
    _lockedUntil = 0;
    _inMemoryAuthed = true;
    return { ok: true };
  }
  _failedAttempts += 1;
  if (_failedAttempts >= 5) {
    _lockedUntil = Date.now() + 15000;
    _failedAttempts = 0;
    return { ok: false, lockedSeconds: 15 };
  }
  return { ok: false };
}

export async function setAdminPasscode(newPasscode) {
  const h = await sha256Hex(String(newPasscode || '').trim());
  localStorage.setItem(KEYS.passHash, h);
}

export function isAdminAuthenticated() {
  return _inMemoryAuthed;
}

export function setAdminAuthenticated(val) {
  _inMemoryAuthed = Boolean(val);
}

export function loadSiteConfigOverride() {
  return readLS(KEYS.config, null);
}

export function saveSiteConfigOverride(cfg) {
  writeLS(KEYS.config, cfg);
}

export function loadCatalogPatch() {
  return readLS(KEYS.catalogPatch, {
    addedSongs: {},
    editedSongs: {},
    deletedSongIds: [],
    editedArtists: {},
    deletedArtistIds: [],
  });
}

export function saveCatalogPatch(patch) {
  writeLS(KEYS.catalogPatch, patch);
}

export function loadLyricsPatch() {
  return readLS(KEYS.lyricsPatch, {});
}

export function saveLyricsOverride(songId, payload) {
  const all = loadLyricsPatch();
  if (payload === null) delete all[songId];
  else all[songId] = payload;
  writeLS(KEYS.lyricsPatch, all);
}

export function getLyricsOverride(songId) {
  const all = loadLyricsPatch();
  return all[String(songId)] || null;
}

export function resetAllAdminOverrides() {
  localStorage.removeItem(KEYS.config);
  localStorage.removeItem(KEYS.catalogPatch);
  localStorage.removeItem(KEYS.lyricsPatch);
}

export function applyCatalogPatch(baseCatalog, patch) {
  if (!baseCatalog) return baseCatalog;
  const p = patch || loadCatalogPatch();
  const songs = { ...baseCatalog.songs };
  const artists = { ...baseCatalog.artists };

  (p.deletedSongIds || []).forEach((id) => {
    delete songs[id];
  });

  Object.entries(p.editedSongs || {}).forEach(([id, changes]) => {
    if (songs[id]) songs[id] = { ...songs[id], ...changes };
  });

  Object.entries(p.addedSongs || {}).forEach(([id, song]) => {
    songs[id] = { ...song };
  });

  (p.deletedArtistIds || []).forEach((id) => {
    delete artists[id];
  });

  Object.entries(p.editedArtists || {}).forEach(([id, changes]) => {
    if (artists[id]) artists[id] = { ...artists[id], ...changes };
    else artists[id] = { id, ...changes };
  });

  // Ensure every song's artist exists in artists map
  Object.values(songs).forEach((s) => {
    if (s.artistId && !artists[s.artistId]) {
      artists[s.artistId] = {
        id: s.artistId,
        name: s.artist || 'Unknown Artist',
        genre: (s.genre || 'pop').toUpperCase(),
        image: s.art ? s.art.replace(/\{s\}/g, '600') : '',
        fans: 10000,
        colors: s.colors || ['#fa2d48', '#5e5ce6'],
        genres: s.genre ? [s.genre] : ['pop'],
      };
    }
  });

  // Index search strings
  Object.values(songs).forEach((s) => {
    const raw = `${s.title || ''} ${s.artist || ''} ${s.album || ''} ${s.genre || ''} ${s.aliases || ''}`.toLowerCase();
    s._q = `${raw} ${raw.replace(/['’]/g, '')} ${raw.replace(/fujii/g, 'fuji')}`;
  });
  Object.values(artists).forEach((a) => {
    const raw = (a.name || '').toLowerCase();
    a._q = `${raw} ${raw.replace(/['’]/g, '')} ${raw.replace(/fujii/g, 'fuji')}`;
  });

  const genres = (baseCatalog.genres || []).map((g) => ({
    ...g,
    songIds: Object.values(songs)
      .filter((s) => s.genre === g.id)
      .map((s) => s.id),
  }));

  return {
    ...baseCatalog,
    genres,
    songs,
    artists,
  };
}

export function stripInternalCatalogFields(catalog) {
  const cleanSongs = {};
  Object.entries(catalog.songs || {}).forEach(([id, s]) => {
    const copy = { ...s };
    delete copy._q;
    cleanSongs[id] = copy;
  });
  const cleanArtists = {};
  Object.entries(catalog.artists || {}).forEach(([id, a]) => {
    const copy = { ...a };
    delete copy._q;
    cleanArtists[id] = copy;
  });
  return {
    generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    genres: catalog.genres || [],
    songs: cleanSongs,
    artists: cleanArtists,
  };
}

export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
