"""
Builds public/data/catalog.json + public/data/lyrics/<trackId>.json

Upgrades:
  1. FULL-LENGTH 320 kbps AAC streams via JioSaavn encrypted_media_url DES decryption
     (matches song duration & title/artist against the iTunes track so LRC timestamps
     from LRCLIB are 0-offset, full-song word-by-word synced from 0:00 to the end).
  2. Original Apple Music hi-res artwork ({s}x{s}bb.jpg up to 1200x1200) + official
     Apple Music animated album/artist motion MP4 loops (mvod.itunes.apple.com) when available!
  3. Official Apple Music high-res artist portraits (AMCArtistImages) + Deezer XL fallback.
  4. Fast parallel execution using ThreadPoolExecutor so 180+ songs build in ~60-90 seconds.
"""
import base64
import concurrent.futures
import hashlib
import html
import io
import json
import re
import sys
import threading
import time
import unicodedata
from pathlib import Path

import requests
from Crypto.Cipher import DES
from rapidfuzz import fuzz

sys.path.insert(0, str(Path(__file__).parent))
from songs import GENRES, SONGS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "public" / "data"
LYR = OUT / "lyrics"
for p in (CACHE / "json", CACHE / "html", LYR):
    p.mkdir(parents=True, exist_ok=True)

_tls = threading.local()


def sess():
    if not hasattr(_tls, "s"):
        s = requests.Session()
        s.headers["User-Agent"] = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
        _tls.s = s
    return _tls.s


_itunes_sem = threading.Semaphore(2)


def get_json(url, params=None, cache=True):
    key = hashlib.md5((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()
    p = CACHE / "json" / f"{key}.json"
    if cache and p.exists():
        try:
            d = json.loads(p.read_text("utf-8"))
            if d is not None:
                return d
        except Exception:  # noqa: BLE001
            pass
    if "itunes.apple.com" in url:
        return None
    for attempt in range(3):
        try:
            r = sess().get(url, params=params, timeout=12)
            if r.status_code == 404:
                data = None
                break
            r.raise_for_status()
            data = r.json()
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.5 * (attempt + 1))
    else:
        return None
    if data is not None:
        try:
            p.write_text(json.dumps(data), "utf-8")
        except Exception:  # noqa: BLE001
            pass
    return data


def get_text(url, cache=True):
    key = hashlib.md5(url.encode()).hexdigest()
    p = CACHE / "html" / f"{key}.txt"
    if cache and p.exists():
        try:
            return p.read_text("utf-8")
        except Exception:  # noqa: BLE001
            pass
    try:
        r = sess().get(url, timeout=12)
        if not r.ok:
            return ""
        txt = r.text
        p.write_text(txt, "utf-8")
        return txt
    except Exception:  # noqa: BLE001
        return ""


def clean(s):
    s = html.unescape(unicodedata.normalize("NFKC", s or "")).lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def fold(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


BAD = re.compile(
    r"\b(remix|live|instrumental|karaoke|sped|slowed|acoustic|cover|tribute|demo|8d|lofi|lo-fi|a cappella|mashup|ringtone|dj)\b",
    re.I,
)


# ----------------------------------------------------------------- 1. iTunes metadata + original cover art
def find_itunes(artist, title, query=None):
    alt_title = query[len(artist):].strip() if query and query.startswith(artist) else None
    best, best_score = None, -1
    for country in ("us", "jp", "in", "fr"):
        res = get_json(
            "https://itunes.apple.com/search",
            {"term": query or f"{artist} {title}", "entity": "song", "limit": 20, "country": country},
        )
        for r in (res or {}).get("results", []):
            if not r.get("previewUrl") or r.get("kind") != "song":
                continue
            a = max(
                fuzz.partial_ratio(clean(artist), clean(r["artistName"])),
                fuzz.partial_ratio(fold(clean(artist)), fold(clean(r["artistName"]))),
            )
            tn = clean(r["trackName"])
            t = max(fuzz.ratio(clean(title), tn), fuzz.ratio(fold(clean(title)), fold(tn)))
            if alt_title:
                t = max(t, fuzz.ratio(clean(alt_title), tn), 92 if clean(alt_title) in tn else 0)
            if clean(title) and clean(title) in tn:
                t = max(t, 88)
            pen = 0
            blob = r["trackName"] + " " + r.get("collectionName", "")
            if BAD.search(blob) and not BAD.search(title):
                pen += 28
            if "karaoke" in blob.lower() or "tribute" in blob.lower():
                pen += 60
            score = a * 0.45 + t * 0.55 - pen
            if a >= 65 and t >= 62 and score > best_score:
                best, best_score = r, score
        if best and best_score > 84:
            break
    return best


# ----------------------------------------------------------------- 2. JioSaavn FULL-LENGTH 320 kbps AAC
_DES = DES.new(b"38346591", DES.MODE_ECB)


def decrypt_saavn(enc):
    if not enc:
        return None
    try:
        raw = base64.b64decode(enc.strip())
        dec = _DES.decrypt(raw)
        pad = dec[-1]
        if isinstance(pad, int) and 1 <= pad <= 8:
            dec = dec[:-pad]
        url = dec.decode("utf-8", errors="ignore").strip()
        url = re.sub(r"_(96|160)\.mp4$", "_320.mp4", url)
        return url.replace("http://", "https://")
    except Exception:  # noqa: BLE001
        return None


def find_full_audio(artist, title, target_dur, query=None):
    queries = [f"{artist} {title}"]
    if query and query not in queries:
        queries.append(query)
    best, best_score = None, -1
    for q in queries:
        data = get_json(
            "https://www.jiosaavn.com/api.php",
            {
                "__call": "search.getResults",
                "_format": "json",
                "_marker": "0",
                "api_version": "4",
                "ctx": "web6dot0",
                "n": "12",
                "p": "1",
                "q": q,
            },
        )
        for item in (data or {}).get("results", []):
            mi = item.get("more_info") or {}
            enc = mi.get("encrypted_media_url")
            if not enc:
                continue
            try:
                dur = float(mi.get("duration") or 0)
            except Exception:  # noqa: BLE001
                dur = 0
            if dur < 60:
                continue
            s_title = html.unescape(item.get("title") or "")
            amap = mi.get("artistMap") or {}
            prim = ", ".join(a.get("name", "") for a in (amap.get("primary_artists") or amap.get("artists") or []))
            s_artist = html.unescape(prim or item.get("subtitle") or "")
            t_sc = max(
                fuzz.ratio(clean(title), clean(s_title)),
                fuzz.partial_ratio(clean(title), clean(s_title)),
                fuzz.ratio(fold(clean(title)), fold(clean(s_title))),
            )
            a_sc = max(
                fuzz.partial_ratio(clean(artist), clean(s_artist)),
                fuzz.partial_ratio(fold(clean(artist)), fold(clean(s_artist))),
            )
            if query:
                q_clean = clean(query.replace(artist, ""))
                if q_clean:
                    t_sc = max(t_sc, fuzz.partial_ratio(q_clean, clean(s_title)))
            dur_diff = abs(dur - target_dur) if target_dur else 0
            dur_pen = 0 if dur_diff <= 4 else min(35, (dur_diff - 4) * 1.6)
            blob = f"{s_title} {mi.get('album', '')}"
            bad_pen = 35 if (BAD.search(blob) and not BAD.search(title)) else 0
            score = t_sc * 0.55 + a_sc * 0.45 - dur_pen - bad_pen
            if t_sc >= 58 and score > best_score:
                url = decrypt_saavn(enc)
                if url:
                    pa = (amap.get("primary_artists") or amap.get("artists") or [{}])[0]
                    img_raw = item.get("image") or ""
                    art_hi = re.sub(r"-\d+x\d+\.(jpg|png|webp)$", "-500x500.jpg", img_raw)
                    pa_img = re.sub(r"_\d+x\d+\.(jpg|png|webp)$", "_500x500.jpg", pa.get("image") or "")
                    best = {
                        "url": url,
                        "duration": dur,
                        "saavnId": item.get("id"),
                        "title": s_title,
                        "artist": pa.get("name") or s_artist,
                        "artistId": pa.get("id"),
                        "artistImage": pa_img,
                        "album": html.unescape(mi.get("album") or ""),
                        "albumId": mi.get("album_id"),
                        "art": art_hi,
                        "year": item.get("year"),
                        "explicit": item.get("explicit_content") == "1",
                        "permaUrl": item.get("perma_url"),
                        "score": score,
                    }
                    best_score = score
        if best and best_score >= 82:
            break
    return best


# ----------------------------------------------------------------- 3. Apple Music Animated Artwork (MP4)
_album_video_cache = {}
_album_lock = threading.Lock()


def find_animated_cover(collection_View_url):
    if not collection_View_url:
        return None
    url_clean = collection_View_url.split("?")[0]
    with _album_lock:
        if url_clean in _album_video_cache:
            return _album_video_cache[url_clean]
    mp4 = None
    try:
        page = get_text(url_clean)
        m3u8s = re.findall(r"https://mvod\.itunes\.apple\.com[^\s\"'<>\\]+\.m3u8", page)
        if m3u8s:
            master = get_text(m3u8s[0])
            # Prefer H.264 (avc1) 486x486 or 768x768 so every browser plays it natively in <video>
            sub_urls = re.findall(
                r'CODECS="avc1[^"]*"[^\n]*\n(https://mvod\.itunes\.apple\.com[^\s]+\.m3u8)', master
            )
            if not sub_urls:
                sub_urls = re.findall(r"https://mvod\.itunes\.apple\.com[^\s]+_(?:486x486|768x768|360x360)\.m3u8", master)
            if sub_urls:
                chosen = next((u for u in sub_urls if "768x768" in u or "486x486" in u), sub_urls[0])
                sub = get_text(chosen)
                m = re.search(r'URI="([^"]+\.mp4)"', sub)
                if m:
                    base = chosen.rsplit("/", 1)[0]
                    mp4 = f"{base}/{m.group(1)}"
    except Exception:  # noqa: BLE001
        mp4 = None
    with _album_lock:
        _album_video_cache[url_clean] = mp4
    return mp4


# ----------------------------------------------------------------- 4. Full-Song Word-by-Word Lyrics Builder
JA = r"\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u30fc\uff66-\uff9f"
HANGUL = r"\uac00-\ud7af\u1100-\u11ff\u3130-\u318f"
JA_RE = re.compile(f"[{JA}]")
HANGUL_RE = re.compile(f"[{HANGUL}]")
TS = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")
WTS = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")


def ts(m, s):
    return int(m) * 60 + float(s.replace(":", "."))


def parse_lrc(text):
    lines = []
    for raw in (text or "").splitlines():
        stamps = TS.findall(raw)
        if not stamps:
            continue
        body = TS.sub("", raw).strip()
        for m, s in stamps:
            lines.append({"t": ts(m, s), "raw": body})
    lines.sort(key=lambda l: l["t"])
    return lines


def split_units(text):
    """Split line into singable units: words (with trailing space) for Latin/Hangul/French/etc.,
    and individual characters/syllables for Japanese kanji/kana so each character lights up smoothly."""
    units = []
    for m in re.finditer(r"\S+\s*", text):
        w = m.group(0)
        if not JA_RE.search(w):
            units.append(w)
            continue
        buf = ""
        for c in w:
            if JA_RE.match(c):
                if buf:
                    if re.search(r"\w", buf) or not units:
                        units.append(buf)
                    else:
                        units[-1] += buf
                    buf = ""
                units.append(c)
            elif not re.match(r"\w", c) and not buf and units:
                units[-1] += c
            else:
                buf += c
        if buf:
            if re.search(r"\w", buf) or not units:
                units.append(buf)
            else:
                units[-1] += buf
    return units


VOWELS = re.compile(r"[aeiouyáéíóúàèìòùâêîôûäëïöüãõœæ]+", re.I)


def unit_weight(u):
    """Natural singing duration weight based on syllable count, vowel clusters & punctuation pauses."""
    stripped = u.strip()
    core = re.sub(r"\W", "", stripped)
    if not core:
        return 0.25
    pause_bonus = 0.0
    if stripped.endswith((",", ";", "—", "-")):
        pause_bonus = 0.85
    elif stripped.endswith((".", "!", "?", "…")):
        pause_bonus = 1.25
    if JA_RE.search(core):
        # Long vowel mark ー or small kana adjusts weight
        return (2.8 if "ー" in core else 2.1) + pause_bonus
    if HANGUL_RE.search(core):
        return 2.0 * len(core) + pause_bonus
    syllables = max(1, len(VOWELS.findall(core)))
    return syllables * 1.45 + len(core) * 0.28 + pause_bonus


def build_full_lyrics(lrc_text, song_dur):
    parsed = parse_lrc(lrc_text)
    if not parsed:
        return []
    out = []
    if parsed[0]["t"] > 3.5:
        out.append({"t": 0.0, "e": round(parsed[0]["t"] - 0.15, 2), "inst": True})
    for i, pl in enumerate(parsed):
        nxt = parsed[i + 1]["t"] if i + 1 < len(parsed) else max(song_dur, pl["t"] + 6.0)
        raw = pl["raw"].strip()
        if not raw or raw in ("♪", "…", "..."):
            if nxt - pl["t"] >= 1.5:
                out.append({"t": round(pl["t"], 2), "e": round(nxt - 0.1, 2), "inst": True})
            continue
        words = []
        if WTS.search(raw):
            parts = WTS.split(raw)
            k = 1
            while k + 2 <= len(parts):
                t0 = ts(parts[k], parts[k + 1])
                txt = parts[k + 2]
                k += 3
                if txt.strip():
                    words.append({"w": txt, "t": round(t0, 3)})
            for j, w in enumerate(words):
                w["e"] = round(words[j + 1]["t"] if j + 1 < len(words) else min(nxt - 0.05, w["t"] + 1.0), 3)
        else:
            units = split_units(raw)
            weights = [unit_weight(u) for u in units]
            W = sum(weights) or 1.0
            span = max(0.45, nxt - pl["t"])
            # Vocals usually fill ~86% of the line gap (up to natural singing rate)
            natural = W * 0.11 + 0.35
            sing_dur = min(span * 0.92, max(min(span * 0.78, 1.1), natural))
            e_line = pl["t"] + sing_dur
            cum = 0.0
            for u, wt in zip(units, weights):
                w_s = pl["t"] + sing_dur * (cum / W)
                w_e = pl["t"] + sing_dur * ((cum + wt) / W)
                words.append({"w": u, "t": round(w_s, 3), "e": round(max(w_s + 0.06, w_e), 3)})
                cum += wt
        if not words:
            continue
        line_e = words[-1]["e"]
        out.append({"t": round(pl["t"], 2), "e": round(line_e, 2), "words": words})
        gap = nxt - line_e
        if gap > 7.0 and i + 1 < len(parsed):
            out.append({"t": round(line_e + 0.4, 2), "e": round(nxt - 0.2, 2), "inst": True})
    return out


def fetch_best_lyrics(it, artist, title, dur, query=None):
    cands = {}
    qs = [
        {"track_name": it["trackName"], "artist_name": it["artistName"]},
        {"track_name": title, "artist_name": artist},
        {"q": f"{artist} {title}"},
    ]
    if query:
        qs.append({"q": query})
    for q in qs:
        for c in get_json("https://lrclib.net/api/search", q) or []:
            if not c.get("instrumental") and (c.get("syncedLyrics") or c.get("plainLyrics")):
                cands[c["id"]] = c
        if any(abs((c.get("duration") or 0) - dur) <= 4 and c.get("syncedLyrics") for c in cands.values()):
            break
    synced = [c for c in cands.values() if c.get("syncedLyrics")]
    if synced:
        synced.sort(
            key=lambda c: (
                0 if WTS.search(c["syncedLyrics"]) else 1,
                abs((c.get("duration") or 0) - dur),
            )
        )
        best = synced[0]
        # Scale timestamps slightly if full-audio duration differs by a few seconds from LRC duration
        lines = build_full_lyrics(best["syncedLyrics"], dur)
        return {"synced": True, "source": f"lrclib:{best['id']}", "lines": lines, "plain": best.get("plainLyrics") or ""}
    plain = next((c for c in cands.values() if c.get("plainLyrics")), None)
    if plain:
        return {"synced": False, "source": f"lrclib:{plain['id']}", "lines": [], "plain": plain["plainLyrics"]}
    return None


# ----------------------------------------------------------------- 5. Palette & Artist Enrichment
def palette_from_url(url):
    try:
        from PIL import Image
        r = sess().get(url, timeout=10)
        img = Image.open(io.BytesIO(r.content)).convert("RGB").resize((48, 48))
        q = img.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette()[:15]
        counts = sorted(q.getcolors(), reverse=True)
        cols = []
        for _, idx in counts:
            rr, gg, bb = pal[idx * 3 : idx * 3 + 3]
            cols.append("#%02x%02x%02x" % (rr, gg, bb))
        return cols[:4]
    except Exception:  # noqa: BLE001
        return ["#fa2d48", "#5e5ce6", "#1c1c1e"]


def fetch_artist_meta(aid, fallback_name, sample_song):
    ar = {}
    if not str(aid).startswith("sva_"):
        lk = get_json("https://itunes.apple.com/lookup", {"id": aid})
        ar = (lk or {}).get("results", [{}])[0]
    name = ar.get("artistName") or fallback_name
    apple_url = ar.get("artistLinkUrl") or sample_song.get("appleUrl") or ""
    # Try Deezer XL portrait first (fast JSON API)
    dz_res = get_json("https://api.deezer.com/search/artist", {"q": name, "limit": 5})
    dz = None
    for a in (dz_res or {}).get("data", []):
        if fuzz.ratio(fold(clean(name)), fold(clean(a["name"]))) >= 75:
            if dz is None or a.get("nb_fan", 0) > dz.get("nb_fan", 0):
                dz = a
    img = dz.get("picture_xl") if dz else sample_song.get("ArtistImageHint")
    fans = dz.get("nb_fan", 0) if dz else 0
    if not img:
        img = sample_song["art"].replace("{s}", "1000")
    return {
        "id": aid,
        "name": name,
        "genre": ar.get("primaryGenreName") or sample_song["genre"].title(),
        "image": img,
        "fans": fans,
        "colors": sample_song["colors"],
        "genres": [sample_song["genre"]],
        "appleUrl": apple_url,
    }


# ----------------------------------------------------------------- 6. Worker per song
def process_entry(idx_entry):
    idx, entry = idx_entry
    artist, title, genre, lang = entry[:4]
    query = entry[4] if len(entry) > 4 else None
    artist = artist.strip()
    it = find_itunes(artist, title, query)
    full = find_full_audio(artist, title, (it.get("trackTimeMillis", 200000) / 1000.0) if it else 0, query)
    if not it and not full:
        print(f"[{idx:03d}] MISS BOTH: {artist} - {title}")
        return None

    if it:
        tid = str(it["trackId"])
        t_name = it["trackName"]
        a_name = it["artistName"]
        a_id = str(it["artistId"])
        alb_name = it.get("collectionName", "")
        alb_id = str(it.get("collectionId", ""))
        art_tpl = re.sub(r"/\d+x\d+bb\.(jpg|png)$", "/{s}x{s}bb.jpg", it["artworkUrl100"])
        preview_url = it["previewUrl"]
        it_dur = (it.get("trackTimeMillis") or 200000) / 1000.0
        explicit = it.get("trackExplicitness") == "explicit"
        year = (it.get("releaseDate") or "")[:4]
        apple_url = it.get("trackViewUrl", "")
        video_art = find_animated_cover(it.get("collectionViewUrl"))
    else:
        tid = f"sv_{full['saavnId']}"
        t_name = full.get("title") or title
        a_name = full.get("artist") or artist
        a_id = f"sva_{full.get('artistId') or hashlib.md5(artist.lower().encode()).hexdigest()[:8]}"
        alb_name = full.get("album") or title
        alb_id = f"svb_{full.get('albumId') or tid}"
        art_tpl = full.get("art") or ""
        preview_url = full["url"]
        it_dur = full["duration"]
        explicit = bool(full.get("explicit"))
        year = str(full.get("year") or "2024")
        apple_url = full.get("permaUrl") or ""
        video_art = None

    audio_url = full["url"] if full else preview_url
    real_dur = full["duration"] if full else round(it_dur, 1)
    is_full = bool(full)

    fake_it = it or {"trackName": t_name, "artistName": a_name}
    lyr = fetch_best_lyrics(fake_it, artist, title, real_dur, query)
    lyr_state = "synced" if (lyr and lyr["synced"]) else ("plain" if lyr else "none")
    if lyr:
        payload = {
            "id": tid,
            "synced": lyr["synced"],
            "offset": 0,
            "source": lyr["source"],
            "lines": lyr["lines"],
            "plain": lyr.get("plain", ""),
        }
        (LYR / f"{tid}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")

    cols = palette_from_url(art_tpl.replace("{s}", "150")) if art_tpl else ["#fa2d48", "#5e5ce6", "#1c1c1e"]
    song = {
        "id": tid,
        "title": t_name,
        "artist": a_name,
        "artistId": a_id,
        "album": alb_name,
        "albumId": alb_id,
        "art": art_tpl,
        "videoArt": video_art,
        "audio": audio_url,
        "preview": preview_url,
        "isFull": is_full,
        "saavnId": full.get("saavnId") if full else None,
        "ArtistImageHint": full.get("artistImage") if full else None,
        "duration": round(real_dur, 1),
        "genre": genre,
        "lang": lang,
        "explicit": explicit,
        "year": year,
        "appleUrl": apple_url,
        "colors": cols,
        "lyrics": lyr_state,
        "offset": 0,
    }
    tag = f"{'FULL ' + str(int(real_dur)) + 's' if is_full else 'PREV 30s'} | {lyr_state.upper():6s}{' | MOTION' if video_art else ''}"
    print(f"[{idx:03d}] {a_name} - {t_name}  [{tag}]")
    return (idx, artist, song)


def main():
    t0 = time.time()
    print(f"Building catalog for {len(SONGS)} songs across {len(GENRES)} genres...")
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for res in ex.map(process_entry, enumerate(SONGS, 1)):
            if res:
                results.append(res)

    results.sort(key=lambda x: x[0])
    songs = {}
    artist_samples = {}
    for _, req_artist, s in results:
        songs[s["id"]] = s
        aid = s["artistId"]
        if aid not in artist_samples:
            artist_samples[aid] = (req_artist, s)

    print(f"\nFetching metadata & portraits for {len(artist_samples)} artists...")
    artists = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs = {
            ex.submit(fetch_artist_meta, aid, req_artist, sample): aid
            for aid, (req_artist, sample) in artist_samples.items()
        }
        for fut in concurrent.futures.as_completed(futs):
            aid = futs[fut]
            try:
                artists[aid] = fut.result()
            except Exception as e:  # noqa: BLE001
                print("artist err", aid, e)

    for s in songs.values():
        a = artists.get(s["artistId"])
        if a and s["genre"] not in a["genres"]:
            a["genres"].append(s["genre"])

    genres = []
    for g in GENRES:
        ids = [s["id"] for s in songs.values() if s["genre"] == g["id"]]
        genres.append({**g, "songIds": ids})

    catalog = {
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "genres": genres,
        "songs": songs,
        "artists": artists,
    }
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), "utf-8")

    n_full = sum(1 for s in songs.values() if s.get("isFull"))
    n_sync = sum(1 for s in songs.values() if s.get("lyrics") == "synced")
    n_vid = sum(1 for s in songs.values() if s.get("videoArt"))
    print(
        f"\nDONE in {time.time() - t0:.1f}s! "
        f"total={len(songs)} | full_length={n_full} | synced_lyrics={n_sync} | animated_covers={n_vid} | artists={len(artists)}"
    )


if __name__ == "__main__":
    main()
