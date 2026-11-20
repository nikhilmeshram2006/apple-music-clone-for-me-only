// Admin storage, PBKDF2-SHA256 password hashing (210k iterations + salt),
// in-memory expiring sessions, input/URL sanitization, and security audit logging

export const ADMIN_ROUTE = '/endministrator';

// Allowed username hashes (SHA-256 of normalized usernames)
const ALLOWED_USER_HASHES = new Set([
  'd61d2a3588dc176c0476ec4bce6be1fbcccfa99949f223591def2a2d13617bc0',
  'b7f620e83826f58bd2b3773010afd8133ea04605074d0af971fbe36e8975112f',
]);

// PBKDF2-HMAC-SHA256 (210,000 iterations) default salted verifier (plaintext never stored)
const PBKDF2_ITERATIONS = 210000;
const DEFAULT_PASS_SALT = 'am_endmin_v2_9f4c2a8e1b7d';
const DEFAULT_PASS_DK = '5dc5d0029827702a274d311c48f2e4e420f6e929677ebe7ad43136de45f3a39a';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30-minute session expiry

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
  passRecord: 'am_admin_pass_pbkdf2',
  auditLog: 'am_admin_audit_log',
};

// Strictly private in-memory auth state (cannot be spoofed via sessionStorage/localStorage)
let _inMemoryAuthed = false;
let _sessionExpiresAt = 0;
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

// ------------------------------------------------------------------ Input & URL Sanitization
export function sanitizeText(val, maxLen = 200) {
  return String(val ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function isSafeColor(val) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(val || '').trim());
}

export function isSafeExternalUrl(val) {
  const s = String(val || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeUrl(val, allowRelative = true) {
  const s = String(val || '').trim();
  if (!s) return true; // optional fields can be empty
  // Reject dangerous schemes immediately
  if (/^\s*(javascript|vbscript|data|file):/i.test(s)) return false;
  if (allowRelative && !s.includes('://') && !s.startsWith('//')) {
    return /^[a-zA-Z0-9._/\-{}]+$/.test(s) && !s.includes('..');
  }
  try {
    const u = new URL(s.replace(/\{s\}/g, '600'));
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

export function sanitizeSiteConfig(cfg) {
  const merged = { ...DEFAULT_SITE_CONFIG, ...(cfg || {}) };
  return {
    siteName: sanitizeText(merged.siteName, 60) || DEFAULT_SITE_CONFIG.siteName,
    tagline: sanitizeText(merged.tagline, 140),
    footerDesc: sanitizeText(merged.footerDesc, 300),
    logoUrl: isSafeUrl(merged.logoUrl) ? sanitizeText(merged.logoUrl, 300) || 'logo.jpg' : 'logo.jpg',
    accentColor: isSafeColor(merged.accentColor) ? merged.accentColor : DEFAULT_SITE_CONFIG.accentColor,
    accentColor2: isSafeColor(merged.accentColor2) ? merged.accentColor2 : DEFAULT_SITE_CONFIG.accentColor2,
    bgColor: isSafeColor(merged.bgColor) ? merged.bgColor : DEFAULT_SITE_CONFIG.bgColor,
    fluidIntensity: Math.max(0, Math.min(1, Number(merged.fluidIntensity) || 0)),
    enableFluidBg: Boolean(merged.enableFluidBg),
    enableMotionArt: Boolean(merged.enableMotionArt),
    enableLyrics: Boolean(merged.enableLyrics),
    enableSplash: Boolean(merged.enableSplash),
    announcement: sanitizeText(merged.announcement, 180),
    maintenanceMode: Boolean(merged.maintenanceMode),
    maintenanceMessage: sanitizeText(merged.maintenanceMessage, 240),
    defaultVolume: Math.max(0, Math.min(1, Number(merged.defaultVolume) || 0.9)),
    defaultLyricSize: Math.max(0.7, Math.min(1.6, Number(merged.defaultLyricSize) || 1)),
    hiddenGenres: Array.isArray(merged.hiddenGenres)
      ? merged.hiddenGenres.filter((g) => typeof g === 'string' && /^[a-z0-9_-]{1,32}$/i.test(g))
      : [],
  };
}

export function validateBackupPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out = {};
  if (parsed.siteConfig && typeof parsed.siteConfig === 'object') {
    out.siteConfig = sanitizeSiteConfig(parsed.siteConfig);
  }
  if (parsed.catalogPatch && typeof parsed.catalogPatch === 'object') {
    const p = parsed.catalogPatch;
    const cleanMap = (obj) => {
      const res = {};
      if (!obj || typeof obj !== 'object') return res;
      Object.entries(obj).forEach(([k, v]) => {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(k) || !v || typeof v !== 'object') return;
        if (v.audio && !isSafeUrl(v.audio)) return;
        if (v.art && !isSafeUrl(v.art)) return;
        if (v.videoArt && !isSafeUrl(v.videoArt)) return;
        if (v.image && !isSafeUrl(v.image)) return;
        res[k] = v;
      });
      return res;
    };
    out.catalogPatch = {
      addedSongs: cleanMap(p.addedSongs),
      editedSongs: cleanMap(p.editedSongs),
      deletedSongIds: Array.isArray(p.deletedSongIds) ? p.deletedSongIds.filter((x) => typeof x === 'string') : [],
      editedArtists: cleanMap(p.editedArtists),
      deletedArtistIds: Array.isArray(p.deletedArtistIds) ? p.deletedArtistIds.filter((x) => typeof x === 'string') : [],
    };
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ Security Audit Log
export function logSecurityEvent(event, detail = '') {
  const logs = readLS(KEYS.auditLog, []);
  logs.unshift({
    ts: new Date().toISOString(),
    event: sanitizeText(event, 40),
    detail: sanitizeText(detail, 120),
  });
  writeLS(KEYS.auditLog, logs.slice(0, 50));
}

export function getSecurityLogs() {
  return readLS(KEYS.auditLog, []);
}

export function clearSecurityLogs() {
  localStorage.removeItem(KEYS.auditLog);
}

// ------------------------------------------------------------------ Crypto & Auth (PBKDF2-SHA256)
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return toHex(hash);
}

async function pbkdf2Hex(password, salt, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyAdminPasscode(input) {
  const stored = readLS(KEYS.passRecord, null);
  const salt = stored?.salt || DEFAULT_PASS_SALT;
  const expected = stored?.dk || DEFAULT_PASS_DK;
  const iterations = stored?.iterations || PBKDF2_ITERATIONS;
  const derived = await pbkdf2Hex(String(input || '').trim(), salt, iterations);
  return timingSafeEqual(derived, expected);
}

export async function verifyAdminCredentials(username, password) {
  if (Date.now() < _lockedUntil) {
    const secs = Math.ceil((_lockedUntil - Date.now()) / 1000);
    logSecurityEvent('LOGIN_BLOCKED', `Rate-limited (${secs}s remaining)`);
    return { ok: false, lockedSeconds: secs };
  }
  const normalizedUser = String(username || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const userHash = await sha256Hex(normalizedUser);
  const passOk = await verifyAdminPasscode(password);
  if (ALLOWED_USER_HASHES.has(userHash) && passOk) {
    _failedAttempts = 0;
    _lockedUntil = 0;
    _inMemoryAuthed = true;
    _sessionExpiresAt = Date.now() + SESSION_TTL_MS;
    logSecurityEvent('LOGIN_SUCCESS', 'Endministrator session started');
    return { ok: true };
  }
  _failedAttempts += 1;
  if (_failedAttempts >= 5) {
    _lockedUntil = Date.now() + 30000;
    _failedAttempts = 0;
    logSecurityEvent('LOGIN_LOCKOUT', '5 failed attempts — locked for 30s');
    return { ok: false, lockedSeconds: 30 };
  }
  logSecurityEvent('LOGIN_FAILED', `Failed attempt ${_failedAttempts}/5`);
  return { ok: false };
}

export async function setAdminPasscode(newPasscode) {
  const randBytes = new Uint8Array(16);
  crypto.getRandomValues(randBytes);
  const salt = toHex(randBytes);
  const dk = await pbkdf2Hex(String(newPasscode || '').trim(), salt, PBKDF2_ITERATIONS);
  writeLS(KEYS.passRecord, { salt, dk, iterations: PBKDF2_ITERATIONS });
  logSecurityEvent('PASSWORD_CHANGED', 'Updated PBKDF2-SHA256 password hash');
}

export function isAdminAuthenticated() {
  if (!_inMemoryAuthed) return false;
  if (Date.now() > _sessionExpiresAt) {
    _inMemoryAuthed = false;
    _sessionExpiresAt = 0;
    logSecurityEvent('SESSION_EXPIRED', 'Auto-locked after 30 minutes');
    return false;
  }
  return true;
}

export function touchAdminSession() {
  if (_inMemoryAuthed && Date.now() <= _sessionExpiresAt) {
    _sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  }
}

export function setAdminAuthenticated(val) {
  _inMemoryAuthed = Boolean(val);
  _sessionExpiresAt = val ? Date.now() + SESSION_TTL_MS : 0;
  if (!val) logSecurityEvent('LOGOUT', 'Endministrator session locked');
}

// ------------------------------------------------------------------ Overrides & Catalog Merging
export function loadSiteConfigOverride() {
  const raw = readLS(KEYS.config, null);
  return raw ? sanitizeSiteConfig(raw) : null;
}

export function saveSiteConfigOverride(cfg) {
  writeLS(KEYS.config, sanitizeSiteConfig(cfg));
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
  logSecurityEvent('OVERRIDES_RESET', 'Cleared all local catalog/config overrides');
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
