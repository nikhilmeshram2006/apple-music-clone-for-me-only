import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';

function fullAudioMiddleware() {
  const cache = new Map();
  return {
    name: 'full-audio-resolver',
    configureServer(server) {
      // 1) Resolve full-length stream + animated cover for a single song
      server.middlewares.use('/api/resolve', async (req, res) => {
        try {
          const u = new URL(req.url, 'http://localhost');
          const artist = u.searchParams.get('artist') || '';
          const title = u.searchParams.get('title') || '';
          const albumUrl = u.searchParams.get('albumUrl') || '';
          const key = `res:${artist}|${title}|${albumUrl}`.toLowerCase();
          if (cache.has(key)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(cache.get(key)));
            return;
          }

          let audioUrl = null;
          let duration = null;
          let videoArt = null;

          if (albumUrl && albumUrl.includes('music.apple.com')) {
            try {
              const page = await fetch(albumUrl.split('?')[0], {
                headers: { 'User-Agent': 'Mozilla/5.0' },
              }).then((r) => r.text());
              const m3u8 = page.match(/https:\/\/mvod\.itunes\.apple\.com[^\s"'<>\\]+\.m3u8/)?.[0];
              if (m3u8) {
                const master = await fetch(m3u8).then((r) => r.text());
                const sub =
                  master.match(/CODECS="avc1[^"]*"[^\n]*\n(https:\/\/mvod\.itunes\.apple\.com[^\s]+\.m3u8)/)?.[1] ||
                  master.match(/https:\/\/mvod\.itunes\.apple\.com[^\s]+_(?:768x768|486x486|360x360)\.m3u8/)?.[0];
                if (sub) {
                  const subTxt = await fetch(sub).then((r) => r.text());
                  const mp4 = subTxt.match(/URI="([^"]+\.mp4)"/)?.[1];
                  if (mp4) videoArt = `${sub.slice(0, sub.lastIndexOf('/'))}/${mp4}`;
                }
              }
            } catch {
              /* ignore */
            }
          }

          await new Promise((resolve) => {
            const pyCode = `
import base64, json, re, sys, urllib.parse, urllib.request
from Crypto.Cipher import DES
q = urllib.parse.quote(sys.argv[1])
url = f"https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&p=1&q={q}"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
data = json.loads(urllib.request.urlopen(req, timeout=8).read().decode("utf-8"))
for it in data.get("results", []):
    mi = it.get("more_info") or {}
    enc = mi.get("encrypted_media_url")
    dur = float(mi.get("duration") or 0)
    if enc and dur >= 60:
        raw = base64.b64decode(enc.strip())
        dec = DES.new(b"38346591", DES.MODE_ECB).decrypt(raw)
        pad = dec[-1]
        if isinstance(pad, int) and 1 <= pad <= 8: dec = dec[:-pad]
        u = re.sub(r"_(96|160)\\.mp4$", "_320.mp4", dec.decode("utf-8", "ignore").strip()).replace("http://", "https://")
        print(json.dumps({"url": u, "duration": dur}))
        break
`;
            execFile('python', ['-c', pyCode, `${artist} ${title}`], { timeout: 9000 }, (err, stdout) => {
              if (!err && stdout.trim()) {
                try {
                  const parsed = JSON.parse(stdout.trim().split('\n').pop());
                  audioUrl = parsed.url;
                  duration = parsed.duration;
                } catch {
                  /* ignore */
                }
              }
              resolve();
            });
          });

          const out = { audio: audioUrl, duration, videoArt, isFull: Boolean(audioUrl) };
          cache.set(key, out);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(out));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // 2) Full Search endpoint (/api/search?q=...) returning decrypted 320kbps songs + artists + albums
      server.middlewares.use('/api/search', async (req, res) => {
        try {
          const u = new URL(req.url, 'http://localhost');
          const q = (u.searchParams.get('q') || '').trim();
          if (!q) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ songs: [], artists: [], albums: [] }));
            return;
          }
          const key = `search:${q.toLowerCase()}`;
          if (cache.has(key)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(cache.get(key)));
            return;
          }
          const pySearch = `
import base64, html, json, re, sys, urllib.parse, urllib.request
from Crypto.Cipher import DES
DES_C = DES.new(b"38346591", DES.MODE_ECB)
q = urllib.parse.quote(sys.argv[1])
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(req, timeout=8).read().decode("utf-8"))
s_data = get(f"https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=25&p=1&q={q}")
songs, artists_map, albums_map = [], {}, {}
for it in s_data.get("results", []):
    mi = it.get("more_info") or {}
    enc = mi.get("encrypted_media_url")
    dur = float(mi.get("duration") or 0)
    if not enc or dur < 30: continue
    raw = base64.b64decode(enc.strip())
    dec = DES_C.decrypt(raw)
    pad = dec[-1]
    if isinstance(pad, int) and 1 <= pad <= 8: dec = dec[:-pad]
    audio = re.sub(r"_(96|160)\\.mp4$", "_320.mp4", dec.decode("utf-8", "ignore").strip()).replace("http://", "https://")
    amap = mi.get("artistMap") or {}
    pas = amap.get("primary_artists") or amap.get("artists") or []
    pa = pas[0] if pas else {}
    a_id = f"sva_{pa.get('id') or '0'}"
    a_name = html.unescape(pa.get("name") or it.get("subtitle") or "Artist")
    a_img = re.sub(r"_\\d+x\\d+\\.(jpg|png|webp)$", "_500x500.jpg", pa.get("image") or "")
    art_hi = re.sub(r"-\\d+x\\d+\\.(jpg|png|webp)$", "-500x500.jpg", it.get("image") or "")
    alb_id = f"svb_{mi.get('album_id') or it.get('id')}"
    alb_title = html.unescape(mi.get("album") or it.get("title") or "")
    songs.append({
        "id": f"sv_{it.get('id')}",
        "title": html.unescape(it.get("title") or ""),
        "artist": a_name,
        "artistId": a_id,
        "album": alb_title,
        "albumId": alb_id,
        "art": art_hi,
        "audio": audio,
        "preview": audio,
        "isFull": True,
        "duration": dur,
        "genre": (it.get("language") or "Pop").title(),
        "explicit": it.get("explicit_content") == "1",
        "year": str(it.get("year") or ""),
        "appleUrl": it.get("perma_url") or "",
        "lyrics": "remote",
        "offset": 0
    })
    if pa.get("id") and a_id not in artists_map:
        artists_map[a_id] = {"id": a_id, "name": a_name, "genre": (it.get("language") or "Music").title(), "image": a_img or art_hi}
    if mi.get("album_id") and alb_id not in albums_map:
        albums_map[alb_id] = {"id": alb_id, "title": alb_title, "artist": a_name, "artistId": a_id, "art": art_hi, "year": str(it.get("year") or ""), "count": 1}
print(json.dumps({"songs": songs, "artists": list(artists_map.values()), "albums": list(albums_map.values())}))
`;
          const out = await new Promise((resolve) => {
            execFile('python', ['-c', pySearch, q], { timeout: 10000 }, (err, stdout) => {
              if (!err && stdout.trim()) {
                try {
                  resolve(JSON.parse(stdout.trim().split('\n').pop()));
                  return;
                } catch {
                  /* ignore */
                }
              }
              resolve({ songs: [], artists: [], albums: [] });
            });
          });
          cache.set(key, out);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(out));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ songs: [], artists: [], albums: [], error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
  },
  plugins: [react(), fullAudioMiddleware()],
  server: { port: 5173, open: false, allowedHosts: true },
});
