// Runtime access to free, key-less services + live full-song & word-sync converter:
//  - Curated catalog: 180+ full-length 320 kbps songs + pre-built word-by-word lyrics + animated Apple Music MP4 covers
//  - Live Search (iTunes + /api/resolve + LRCLIB): any song searched live is upgraded on-the-fly to full-length 320 kbps
//    audio AND its LRCLIB synced lyrics are converted in-browser into word-by-word karaoke timing!

export const art = (tpl, size = 600) => (tpl ? tpl.replace(/\{s\}/g, size) : '');

const toTpl = (u) => (u ? u.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/, '/{s}x{s}bb.jpg') : '');

let catalogRef = null;
export const setCatalogRef = (c) => (catalogRef = c);

export function normalizeTrack(r) {
  const id = String(r.trackId);
  if (catalogRef?.songs?.[id]) return catalogRef.songs[id];
  return {
    id,
    title: r.trackName,
    artist: r.artistName,
    artistId: String(r.artistId),
    album: r.collectionName || '',
    albumId: String(r.collectionId || ''),
    albumViewUrl: r.collectionViewUrl || '',
    art: toTpl(r.artworkUrl100),
    videoArt: null,
    audio: null, // resolved on play via /api/resolve
    preview: r.previewUrl,
    isFull: true, // resolved on play
    duration: (r.trackTimeMillis || 180000) / 1000,
    genre: r.primaryGenreName || '',
    explicit: r.trackExplicitness === 'explicit',
    year: (r.releaseDate || '').slice(0, 4),
    appleUrl: r.trackViewUrl,
    trackNumber: r.trackNumber,
    lyrics: 'remote',
    offset: 0,
  };
}

export function normalizeAlbum(r) {
  return {
    id: String(r.collectionId),
    title: r.collectionName,
    artist: r.artistName,
    artistId: String(r.artistId),
    art: toTpl(r.artworkUrl100),
    albumViewUrl: r.collectionViewUrl || '',
    year: (r.releaseDate || '').slice(0, 4),
    count: r.trackCount,
    genre: r.primaryGenreName,
  };
}

const memo = new Map();
async function getJSON(url) {
  if (memo.has(url)) return memo.get(url);
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .catch((e) => {
      memo.delete(url);
      throw e;
    });
  memo.set(url, p);
  return p;
}

let jsonpN = 0;
function jsonp(url) {
  if (memo.has(url)) return memo.get(url);
  const p = new Promise((resolve, reject) => {
    const cb = `__jp${Date.now()}_${jsonpN++}`;
    const s = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, 8000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      s.remove();
    }
    window[cb] = (d) => {
      cleanup();
      resolve(d);
    };
    s.onerror = () => {
      cleanup();
      reject(new Error('jsonp error'));
    };
    s.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
    document.head.appendChild(s);
  });
  memo.set(url, p);
  return p;
}

const IT = 'https://itunes.apple.com';

export async function searchAll(term) {
  const q = encodeURIComponent(term);
  const [saavn, itSongs, itArtists, itAlbums] = await Promise.all([
    getJSON(`/api/search?q=${q}`).catch(() => ({ songs: [], artists: [], albums: [] })),
    getJSON(`${IT}/search?term=${q}&entity=song&limit=25`).catch(() => ({ results: [] })),
    getJSON(`${IT}/search?term=${q}&entity=musicArtist&limit=10`).catch(() => ({ results: [] })),
    getJSON(`${IT}/search?term=${q}&entity=album&limit=12`).catch(() => ({ results: [] })),
  ]);
  const songMap = new Map();
  (saavn.songs || []).forEach((s) => songMap.set(`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`, s));
  itSongs.results
    .filter((r) => r.previewUrl)
    .map(normalizeTrack)
    .forEach((s) => {
      const k = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
      if (!songMap.has(k)) songMap.set(k, s);
    });

  const artistMap = new Map();
  (saavn.artists || []).forEach((a) => artistMap.set(a.name.toLowerCase(), a));
  itArtists.results.forEach((a) => {
    const k = a.artistName.toLowerCase();
    if (!artistMap.has(k)) {
      artistMap.set(k, {
        id: String(a.artistId),
        name: a.artistName,
        genre: a.primaryGenreName,
      });
    }
  });

  const albumMap = new Map();
  (saavn.albums || []).forEach((al) => albumMap.set(`${al.title.toLowerCase()}|${al.artist.toLowerCase()}`, al));
  itAlbums.results.map(normalizeAlbum).forEach((al) => {
    const k = `${al.title.toLowerCase()}|${al.artist.toLowerCase()}`;
    if (!albumMap.has(k)) albumMap.set(k, al);
  });

  return {
    songs: [...songMap.values()],
    artists: [...artistMap.values()],
    albums: [...albumMap.values()],
  };
}

export async function artistLookup(id, fallbackName = '') {
  if (String(id).startsWith('sva_') || fallbackName) {
    const name = fallbackName || catalogRef?.artists?.[id]?.name || '';
    if (name) {
      const res = await getJSON(`/api/search?q=${encodeURIComponent(name)}`).catch(() => ({ songs: [], albums: [] }));
      return {
        name,
        genre: catalogRef?.artists?.[id]?.genre || 'Music',
        songs: res.songs || [],
        albums: res.albums || [],
      };
    }
  }
  const [songs, albums] = await Promise.all([
    getJSON(`${IT}/lookup?id=${id}&entity=song&limit=50`).catch(() => ({ results: [] })),
    getJSON(`${IT}/lookup?id=${id}&entity=album&limit=30`).catch(() => ({ results: [] })),
  ]);
  const info = songs.results.find((r) => r.wrapperType === 'artist') || albums.results.find((r) => r.wrapperType === 'artist');
  const seen = new Set();
  const trackList = songs.results
    .filter((r) => r.wrapperType === 'track' && r.previewUrl)
    .filter((r) => {
      const k = r.trackName.toLowerCase().replace(/\s*[([].*$/, '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(normalizeTrack);
  const albumList = albums.results
    .filter((r) => r.wrapperType === 'collection')
    .map(normalizeAlbum)
    .sort((a, b) => (b.year || '').localeCompare(a.year || ''));
  return {
    name: info?.artistName,
    genre: info?.primaryGenreName,
    songs: trackList,
    albums: albumList,
  };
}

export async function albumLookup(id) {
  if (String(id).startsWith('svb_')) {
    const allSongs = Object.values(catalogRef?.songs || {}).filter((s) => s.albumId === id);
    if (allSongs.length) {
      const f = allSongs[0];
      return {
        album: {
          id,
          title: f.album || f.title,
          artist: f.artist,
          artistId: f.artistId,
          art: f.art,
          year: f.year || '2025',
          count: allSongs.length,
          genre: f.genre,
        },
        songs: allSongs,
      };
    }
  }
  const d = await getJSON(`${IT}/lookup?id=${id}&entity=song&limit=100`).catch(() => ({ results: [] }));
  const info = d.results.find((r) => r.wrapperType === 'collection');
  return {
    album: info ? { ...normalizeAlbum(info), copyright: info.copyright, released: info.releaseDate } : null,
    songs: d.results.filter((r) => r.wrapperType === 'track').map(normalizeTrack),
  };
}

export async function artistImage(name) {
  try {
    const d = await jsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=3`);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff\uac00-\ud7af]/g, '');
    const hit = (d.data || []).find((a) => norm(a.name) === norm(name)) || d.data?.[0];
    return hit ? { image: hit.picture_xl, fans: hit.nb_fan } : null;
  } catch {
    return null;
  }
}

/** Resolve full-length stream & Apple Music animated cover on the fly for non-catalog tracks */
export async function resolveFullStream(song) {
  if (song.audio) return { audio: song.audio, duration: song.duration, videoArt: song.videoArt, isFull: song.isFull };
  try {
    const params = new URLSearchParams({
      artist: song.artist,
      title: song.title,
      albumUrl: song.albumViewUrl || song.appleUrl || '',
    });
    const r = await getJSON(`/api/resolve?${params}`);
    if (r?.audio) {
      song.audio = r.audio;
      song.duration = r.duration || song.duration;
      song.videoArt = r.videoArt || song.videoArt;
      song.isFull = true;
      return r;
    }
  } catch {
    /* fall through */
  }
  return { audio: song.preview, duration: song.duration || 30, videoArt: song.videoArt, isFull: false };
}

// ------------------------------------------------------------------ Client-side LRC -> Word-by-Word converter
const JA_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u30fc\uff66-\uff9f]/;
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
const VOWELS = /[aeiouyáéíóúàèìòùâêîôûäëïöüãõœæ]+/gi;
const TS_RE = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
const WTS_RE = /<(\d+):(\d+(?:\.\d+)?)>/;

function splitUnits(text) {
  const units = [];
  for (const m of text.matchAll(/\S+\s*/g)) {
    const w = m[0];
    if (!JA_RE.test(w)) {
      units.push(w);
      continue;
    }
    let buf = '';
    for (const c of w) {
      if (JA_RE.test(c)) {
        if (buf) {
          if (/\w/.test(buf) || !units.length) units.push(buf);
          else units[units.length - 1] += buf;
          buf = '';
        }
        units.push(c);
      } else if (!/\w/.test(c) && !buf && units.length) {
        units[units.length - 1] += c;
      } else {
        buf += c;
      }
    }
    if (buf) {
      if (/\w/.test(buf) || !units.length) units.push(buf);
      else units[units.length - 1] += buf;
    }
  }
  return units;
}

function unitWeight(u) {
  const s = u.trim();
  const core = s.replace(/\W/g, '');
  if (!core) return 0.25;
  const pause = /[,;—-]$/.test(s) ? 0.85 : /[.!?…]$/.test(s) ? 1.25 : 0;
  if (JA_RE.test(core)) return (core.includes('ー') ? 2.8 : 2.1) + pause;
  if (HANGUL_RE.test(core)) return 2.0 * core.length + pause;
  const syl = (core.match(VOWELS) || [1]).length;
  return syl * 1.45 + core.length * 0.28 + pause;
}

export function buildWordSyncedFromLrc(lrcText, songDur = 200) {
  const parsed = [];
  for (const raw of (lrcText || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TS_RE)];
    if (!stamps.length) continue;
    const body = raw.replace(TS_RE, '').trim();
    for (const st of stamps) {
      parsed.push({ t: parseInt(st[1], 10) * 60 + parseFloat(st[2].replace(':', '.')), raw: body });
    }
  }
  parsed.sort((a, b) => a.t - b.t);
  if (!parsed.length) return [];

  const out = [];
  if (parsed[0].t > 3.5) out.push({ t: 0, e: +(parsed[0].t - 0.15).toFixed(2), inst: true });

  for (let i = 0; i < parsed.length; i++) {
    const pl = parsed[i];
    const nxt = i + 1 < parsed.length ? parsed[i + 1].t : Math.max(songDur, pl.t + 6);
    const raw = pl.raw.trim();
    if (!raw || raw === '♪' || raw === '…' || raw === '...') {
      if (nxt - pl.t >= 1.5) out.push({ t: +pl.t.toFixed(2), e: +(nxt - 0.1).toFixed(2), inst: true });
      continue;
    }
    const words = [];
    if (WTS_RE.test(raw)) {
      const parts = raw.split(/<(\d+):(\d+(?:\.\d+)?)>/);
      for (let k = 1; k + 2 <= parts.length; k += 3) {
        const t0 = parseInt(parts[k], 10) * 60 + parseFloat(parts[k + 1]);
        const txt = parts[k + 2];
        if (txt.trim()) words.push({ w: txt, t: +t0.toFixed(3), e: 0 });
      }
      words.forEach((w, j) => {
        w.e = +(j + 1 < words.length ? words[j + 1].t : Math.min(nxt - 0.05, w.t + 1)).toFixed(3);
      });
    } else {
      const units = splitUnits(raw);
      const weights = units.map(unitWeight);
      const W = weights.reduce((a, b) => a + b, 0) || 1;
      const span = Math.max(0.45, nxt - pl.t);
      const natural = W * 0.11 + 0.35;
      const singDur = Math.min(span * 0.92, Math.max(Math.min(span * 0.78, 1.1), natural));
      let cum = 0;
      units.forEach((u, idx) => {
        const wt = weights[idx];
        const ws = pl.t + singDur * (cum / W);
        const we = pl.t + singDur * ((cum + wt) / W);
        words.push({ w: u, t: +ws.toFixed(3), e: +Math.max(ws + 0.06, we).toFixed(3) });
        cum += wt;
      });
    }
    if (!words.length) continue;
    const lineE = words[words.length - 1].e;
    out.push({ t: +pl.t.toFixed(2), e: +lineE.toFixed(2), words });
    if (nxt - lineE > 7 && i + 1 < parsed.length) {
      out.push({ t: +(lineE + 0.4).toFixed(2), e: +(nxt - 0.2).toFixed(2), inst: true });
    }
  }
  return out;
}

/** Lyrics: curated -> local pre-aligned JSON; live search -> LRCLIB converted into word-by-word sync! */
export async function loadLyrics(song) {
  if (song.lyrics === 'synced' || song.lyrics === 'plain') {
    try {
      const local = await getJSON(`data/lyrics/${song.id}.json`);
      if (local) return local;
    } catch {
      /* fall through to live LRCLIB */
    }
  }
  try {
    const params = new URLSearchParams({
      artist_name: song.artist,
      track_name: song.title,
      album_name: song.album || '',
      duration: Math.round(song.duration || 200),
    });
    let d = await getJSON(`https://lrclib.net/api/get?${params}`).catch(() => null);
    if (!d || (!d.syncedLyrics && !d.plainLyrics)) {
      const s = await getJSON(
        `https://lrclib.net/api/search?${new URLSearchParams({
          track_name: song.title.replace(/\s*[([].*$/, ''),
          artist_name: song.artist.split(/[&,]/)[0],
        })}`
      ).catch(() => []);
      d = s.find((x) => x.syncedLyrics) || s.find((x) => x.plainLyrics) || null;
    }
    if (!d) return null;
    if (d.syncedLyrics) {
      const lines = buildWordSyncedFromLrc(d.syncedLyrics, song.duration || d.duration || 200);
      return { id: song.id, synced: true, offset: 0, lines, plain: d.plainLyrics || '' };
    }
    if (d.plainLyrics) {
      return { id: song.id, synced: false, offset: 0, lines: [], plain: d.plainLyrics };
    }
    return null;
  } catch {
    return null;
  }
}
