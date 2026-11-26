// Studio core configuration, PBKDF2-SHA256 verification (210k iterations + salt),
// PBKDF2-salted private route matching, strict anti-XSS/script-injection guards, and audit log.

// PBKDF2-HMAC-SHA256 (100,000 iterations) salted verifier for the private route
const ROUTE_SALT = '9d4f82c1a6e30b75f18e42d9c0a376b4';
const ROUTE_ITERATIONS = 100000;
const ROUTE_DK = '51b75e6cbaa668c8f937c6105ef95d077c3f768cc26f3a3477b958ca27b4a55f';

// Allowed operator username digests (SHA-256)
const ALLOWED_USER_HASHES = new Set([
  'd61d2a3588dc176c0476ec4bce6be1fbcccfa99949f223591def2a2d13617bc0',
  'b7f620e83826f58bd2b3773010afd8133ea04605074d0af971fbe36e8975112f',
]);

// PBKDF2-HMAC-SHA256 (210,000 iterations) salted verifier (plaintext never stored)
const PBKDF2_ITERATIONS = 210000;
const MAX_PBKDF2_ITERATIONS = 500000;
const DEFAULT_PASS_SALT = '7f3c91a0e4b28d6f1209c5a84e7b31d2';
const DEFAULT_PASS_DK = '1a2403ff3fc7e4daf5f4dbc2fde559519bf70b17a7560abf2bbc016ac64cb54f';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30-minute session expiry
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const DEFAULT_SITE_CONFIG = {
  siteName: 'AUREL',
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
  config: 'am_studio_site_config',
  catalogPatch: 'am_studio_catalog_patch',
  lyricsPatch: 'am_studio_lyrics_patch',
  passRecord: 'am_studio_pass_pbkdf2',
  auditLog: 'am_studio_audit_log',
};

// Strictly private in-memory auth state (cannot be spoofed via sessionStorage/localStorage)
let _inMemoryAuthed = false;
let _sessionExpiresAt = 0;
let _sessionProof = null;
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

// ------------------------------------------------------------------ Anti-Script & Input Sanitization
const SCRIPT_INJECTION_RE =
  /(<\s*\/?\s*(script|iframe|svg|object|embed|img|style|link|meta|base|form|input|math)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|on[a-z]{2,20}\s*=|\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|document\s*\.\s*(cookie|write|domain|location)|window\s*\.\s*(location|open|eval)|innerHTML|outerHTML|\\x3c|&#x3c;|%3c\s*script)/i;

export function containsScriptPayload(val) {
  return SCRIPT_INJECTION_RE.test(String(val ?? ''));
}

export function stripScriptChars(val, maxLen = 200) {
  return String(val ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .slice(0, maxLen);
}

export function sanitizeText(val, maxLen = 200) {
  return stripScriptChars(val, maxLen).trim();
}

export function isSafeColor(val) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(val || '').trim());
}

export function isSafeExternalUrl(val) {
  const s = String(val || '').trim();
  if (!s || containsScriptPayload(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeUrl(val, allowRelative = true) {
  const s = String(val || '').trim();
  if (!s) return true;
  if (containsScriptPayload(s)) return false;
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

export function safeCssUrl(val) {
  const s = String(val || '').trim();
  if (!s || !isSafeUrl(s)) return undefined;
  return `url("${encodeURI(s).replace(/["'()\\]/g, '')}")`;
}

export function sanitizeSongEntry(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};
  Object.keys(s).forEach((k) => {
    if (!FORBIDDEN_KEYS.has(k)) out[k] = s[k];
  });
  if (out.title != null) out.title = sanitizeText(out.title, 160);
  if (out.artist != null) out.artist = sanitizeText(out.artist, 160);
  if (out.album != null) out.album = sanitizeText(out.album, 160);
  if (out.aliases != null) out.aliases = sanitizeText(out.aliases, 240);
  if (out.audio && !isSafeUrl(out.audio)) delete out.audio;
  if (out.preview && !isSafeUrl(out.preview)) delete out.preview;
  if (out.art && !isSafeUrl(out.art)) delete out.art;
  if (out.videoArt && !isSafeUrl(out.videoArt)) out.videoArt = null;
  if (out.appleUrl && !isSafeExternalUrl(out.appleUrl)) out.appleUrl = '';
  if (out.albumViewUrl && !isSafeExternalUrl(out.albumViewUrl)) out.albumViewUrl = '';
  if (out.ArtistImageHint && !isSafeUrl(out.ArtistImageHint)) delete out.ArtistImageHint;
  if (Array.isArray(out.colors)) out.colors = out.colors.filter(isSafeColor);
  return out;
}

export function sanitizeArtistEntry(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const out = {};
  Object.keys(a).forEach((k) => {
    if (!FORBIDDEN_KEYS.has(k)) out[k] = a[k];
  });
  if (out.name != null) out.name = sanitizeText(out.name, 120);
  if (out.genre != null) out.genre = sanitizeText(out.genre, 60);
  if (out.bio != null) out.bio = sanitizeText(out.bio, 600);
  if (out.image && !isSafeUrl(out.image)) out.image = '';
  if (out.heroImage && !isSafeUrl(out.heroImage)) delete out.heroImage;
  if (out.heroVideo && !isSafeUrl(out.heroVideo)) delete out.heroVideo;
  if (out.heroVideo4k && !isSafeUrl(out.heroVideo4k)) delete out.heroVideo4k;
  if (out.logo && !isSafeUrl(out.logo)) delete out.logo;
  if (out.appleUrl && !isSafeExternalUrl(out.appleUrl)) out.appleUrl = '';
  if (Array.isArray(out.colors)) out.colors = out.colors.filter(isSafeColor);
  return out;
}

export function sanitizeSiteConfig(cfg) {
  const merged = { ...DEFAULT_SITE_CONFIG, ...(cfg || {}) };
  const rawName = sanitizeText(merged.siteName, 60);
  const migratedName = !rawName || /^apple\s*music$/i.test(rawName) ? DEFAULT_SITE_CONFIG.siteName : rawName;
  return {
    siteName: migratedName,
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
  if (parsed.siteConfig && typeof parsed.siteConfig === 'object' && !Array.isArray(parsed.siteConfig)) {
    out.siteConfig = sanitizeSiteConfig(parsed.siteConfig);
  }
  if (parsed.catalogPatch && typeof parsed.catalogPatch === 'object' && !Array.isArray(parsed.catalogPatch)) {
    const p = parsed.catalogPatch;
    const cleanMap = (obj, sanitizer) => {
      const res = Object.create(null);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
      Object.entries(obj).forEach(([k, v]) => {
        if (FORBIDDEN_KEYS.has(k) || !/^[a-zA-Z0-9_-]{1,64}$/.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) {
          return;
        }
        if (v.audio && !isSafeUrl(v.audio)) return;
        if (v.preview && !isSafeUrl(v.preview)) return;
        if (v.art && !isSafeUrl(v.art)) return;
        if (v.videoArt && !isSafeUrl(v.videoArt)) return;
        if (v.image && !isSafeUrl(v.image)) return;
        if (v.heroImage && !isSafeUrl(v.heroImage)) return;
        if (v.heroVideo && !isSafeUrl(v.heroVideo)) return;
        if (v.heroVideo4k && !isSafeUrl(v.heroVideo4k)) return;
        if (v.logo && !isSafeUrl(v.logo)) return;
        const cleanVal = sanitizer(v);
        if (cleanVal) res[k] = cleanVal;
      });
      return { ...res };
    };
    out.catalogPatch = {
      addedSongs: cleanMap(p.addedSongs, sanitizeSongEntry),
      editedSongs: cleanMap(p.editedSongs, sanitizeSongEntry),
      deletedSongIds: Array.isArray(p.deletedSongIds)
        ? p.deletedSongIds.filter((x) => typeof x === 'string' && !FORBIDDEN_KEYS.has(x) && /^[a-zA-Z0-9_-]{1,64}$/.test(x))
        : [],
      editedArtists: cleanMap(p.editedArtists, sanitizeArtistEntry),
      deletedArtistIds: Array.isArray(p.deletedArtistIds)
        ? p.deletedArtistIds.filter((x) => typeof x === 'string' && !FORBIDDEN_KEYS.has(x) && /^[a-zA-Z0-9_-]{1,64}$/.test(x))
        : [],
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

// ------------------------------------------------------------------ Crypto, Route Hash & Auth
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return toHex(hash);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function matchesPrivateRoute(path) {
  const norm = String(path || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!norm || norm === '/' || norm.length > 64) return false;
  const derived = await pbkdf2Hex(norm, ROUTE_SALT, ROUTE_ITERATIONS);
  return timingSafeEqual(derived, ROUTE_DK);
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

async function verifyPasscodeInternal(input) {
  if (containsScriptPayload(input)) {
    logSecurityEvent('SCRIPT_INJECTION_BLOCKED', 'Blocked script payload in passcode check');
    return { ok: false, derived: null };
  }
  const stored = readLS(KEYS.passRecord, null);
  const validStored =
    stored &&
    typeof stored === 'object' &&
    typeof stored.salt === 'string' &&
    stored.salt.length >= 16 &&
    stored.salt.length <= 128 &&
    typeof stored.dk === 'string' &&
    /^[0-9a-f]{64}$/i.test(stored.dk);

  const salt = validStored ? stored.salt : DEFAULT_PASS_SALT;
  const expected = validStored ? stored.dk.toLowerCase() : DEFAULT_PASS_DK;
  const rawIter = validStored ? Number(stored.iterations) : PBKDF2_ITERATIONS;
  const iterations = Number.isFinite(rawIter)
    ? Math.max(PBKDF2_ITERATIONS, Math.min(MAX_PBKDF2_ITERATIONS, Math.floor(rawIter)))
    : PBKDF2_ITERATIONS;

  const derived = await pbkdf2Hex(String(input || '').trim(), salt, iterations);
  const ok = timingSafeEqual(derived, expected);
  return { ok, derived: ok ? derived : null };
}

export async function verifyAdminPasscode(input) {
  const res = await verifyPasscodeInternal(input);
  return res.ok;
}

export async function verifyAdminCredentials(username, password) {
  if (containsScriptPayload(username) || containsScriptPayload(password)) {
    logSecurityEvent('SCRIPT_INJECTION_BLOCKED', 'Blocked script payload in login form');
    return { ok: false, blockedScript: true };
  }
  if (Date.now() < _lockedUntil) {
    const secs = Math.ceil((_lockedUntil - Date.now()) / 1000);
    logSecurityEvent('LOGIN_BLOCKED', `Rate-limited (${secs}s remaining)`);
    return { ok: false, lockedSeconds: secs };
  }
  const normalizedUser = String(username || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const userHash = await sha256Hex(normalizedUser);
  const passRes = await verifyPasscodeInternal(password);
  if (ALLOWED_USER_HASHES.has(userHash) && passRes.ok) {
    _failedAttempts = 0;
    _lockedUntil = 0;
    _inMemoryAuthed = true;
    _sessionExpiresAt = Date.now() + SESSION_TTL_MS;
    _sessionProof = passRes.derived;
    logSecurityEvent('LOGIN_SUCCESS', 'Studio session started');
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
  if (containsScriptPayload(newPasscode)) {
    logSecurityEvent('SCRIPT_INJECTION_BLOCKED', 'Blocked script payload in password change');
    throw new Error('Unsafe characters in password');
  }
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
    _sessionProof = null;
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

export function getSessionAuthProof() {
  return isAdminAuthenticated() ? _sessionProof : null;
}

export function setAdminAuthenticated(val) {
  _inMemoryAuthed = Boolean(val);
  _sessionExpiresAt = val ? Date.now() + SESSION_TTL_MS : 0;
  if (!val) {
    _sessionProof = null;
    logSecurityEvent('LOGOUT', 'Studio session locked');
  }
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
    if (typeof id === 'string' && !FORBIDDEN_KEYS.has(id) && Object.hasOwn(songs, id)) {
      delete songs[id];
    }
  });

  Object.entries(p.editedSongs || {}).forEach(([id, changes]) => {
    if (FORBIDDEN_KEYS.has(id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !Object.hasOwn(songs, id)) return;
    const cleanChanges = sanitizeSongEntry(changes);
    if (cleanChanges) songs[id] = { ...songs[id], ...cleanChanges, id };
  });

  Object.entries(p.addedSongs || {}).forEach(([id, song]) => {
    if (FORBIDDEN_KEYS.has(id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return;
    const cleanSong = sanitizeSongEntry(song);
    if (cleanSong) songs[id] = { ...cleanSong, id };
  });

  (p.deletedArtistIds || []).forEach((id) => {
    if (typeof id === 'string' && !FORBIDDEN_KEYS.has(id) && Object.hasOwn(artists, id)) {
      delete artists[id];
    }
  });

  Object.entries(p.editedArtists || {}).forEach(([id, changes]) => {
    if (FORBIDDEN_KEYS.has(id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return;
    const cleanChanges = sanitizeArtistEntry(changes);
    if (!cleanChanges) return;
    if (Object.hasOwn(artists, id)) artists[id] = { ...artists[id], ...cleanChanges, id };
    else artists[id] = { id, ...cleanChanges };
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
