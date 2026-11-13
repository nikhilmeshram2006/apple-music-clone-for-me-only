"""
Add Lana Del Rey's full discography to public/data/catalog.json and public/data/lyrics/
with full-length 320 kbps AAC streaming audio from JioSaavn and synced word-by-word lyrics from LRCLIB.
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

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
PUBLIC_DATA = ROOT / "public" / "data"
DOCS_DATA = ROOT / "docs" / "data"
PUBLIC_LYRICS = PUBLIC_DATA / "lyrics"
DOCS_LYRICS = DOCS_DATA / "lyrics"

for p in (CACHE / "json", PUBLIC_LYRICS, DOCS_LYRICS):
    p.mkdir(parents=True, exist_ok=True)

_DES = DES.new(b"38346591", DES.MODE_ECB)

_session = requests.Session()
_session.headers["User-Agent"] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

BAD = re.compile(
    r"\b(remix|instrumental|karaoke|sped\s+up|slowed|acoustic|cover|tribute|demo|8d|lofi|lo-fi|a\s+cappella|mashup|ringtone|dj)\b",
    re.I,
)

JA_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u30fc\uff66-\uff9f]")
HANGUL_RE = re.compile(r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]")
TS = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")
WTS = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")
VOWELS = re.compile(r"[aeiouyáéíóúàèìòùâêîôûäëïöüãõœæ]+", re.I)

def clean(s):
    s = html.unescape(unicodedata.normalize("NFKC", s or "")).lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())

def fold(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))

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
    except Exception:
        return None

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
    units = []
    for m in re.finditer(r"\S+\s*", text):
        w = m.group(0)
        units.append(w)
    return units

def unit_weight(u):
    stripped = u.strip()
    core = re.sub(r"\W", "", stripped)
    if not core:
        return 0.25
    pause_bonus = 0.0
    if stripped.endswith((",", ";", "—", "-")):
        pause_bonus = 0.85
    elif stripped.endswith((".", "!", "?", "…")):
        pause_bonus = 1.25
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
            natural = W * 0.11 + 0.35
            sing_dur = min(span * 0.92, max(min(span * 0.78, 1.1), natural))
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

def get_saavn_stream(title, target_dur=None):
    clean_t = re.sub(r"\(.*?\)|\[.*?\]", "", title).strip()
    queries = [f"Lana Del Rey {clean_t}", f"Lana Del Rey {title}", clean_t]
    best, best_score = None, -1
    for q in queries:
        try:
            r = _session.get(
                "https://www.jiosaavn.com/api.php",
                params={
                    "__call": "search.getResults",
                    "_format": "json",
                    "_marker": "0",
                    "api_version": "4",
                    "ctx": "web6dot0",
                    "n": "10",
                    "p": "1",
                    "q": q,
                },
                timeout=10,
            )
            if not r.ok:
                continue
            data = r.json()
            for item in data.get("results", []):
                mi = item.get("more_info") or {}
                enc = mi.get("encrypted_media_url")
                if not enc:
                    continue
                try:
                    dur = float(mi.get("duration") or 0)
                except Exception:
                    dur = 0
                if dur < 60:
                    continue
                s_title = html.unescape(item.get("title") or "")
                s_sub = html.unescape(item.get("subtitle") or "")
                amap = mi.get("artistMap") or {}
                artists = ", ".join(a.get("name", "") for a in (amap.get("primary_artists") or amap.get("artists") or []))
                artist_blob = (artists + " " + s_sub).lower()
                
                # Check Lana Del Rey in artists
                is_lana = "lana" in artist_blob or "del rey" in artist_blob
                if not is_lana and "lana" not in clean(s_title):
                    continue

                t_sc = max(
                    fuzz.ratio(clean(clean_t), clean(s_title)),
                    fuzz.partial_ratio(clean(clean_t), clean(s_title)),
                )
                bad_pen = 40 if (BAD.search(s_title) and not BAD.search(title)) else 0
                dur_diff = abs(dur - target_dur) if target_dur else 0
                dur_pen = 0 if dur_diff <= 5 else min(30, (dur_diff - 5) * 1.5)
                score = t_sc - bad_pen - dur_pen

                if t_sc >= 60 and score > best_score:
                    url = decrypt_saavn(enc)
                    if url:
                        best = {
                            "url": url,
                            "duration": dur,
                            "saavnId": item.get("id"),
                            "title": s_title,
                            "album": html.unescape(mi.get("album") or ""),
                            "score": score,
                        }
                        best_score = score
            if best and best_score >= 80:
                break
        except Exception:
            pass
    return best

def get_lrclib_lyrics(title, artist="Lana Del Rey", dur=None):
    clean_t = re.sub(r"\(.*?\)|\[.*?\]", "", title).strip()
    try:
        r = _session.get(
            "https://lrclib.net/api/search",
            params={"track_name": clean_t, "artist_name": artist},
            timeout=8,
        )
        if r.ok:
            for c in r.json():
                if c.get("syncedLyrics"):
                    c_dur = float(c.get("duration") or 0)
                    if dur and abs(c_dur - dur) > 20:
                        continue
                    return {"synced": True, "source": f"lrclib:{c['id']}", "lrc": c["syncedLyrics"], "plain": c.get("plainLyrics") or ""}
    except Exception:
        pass
    return None

def palette_from_url(url):
    try:
        from PIL import Image
        r = _session.get(url, timeout=8)
        img = Image.open(io.BytesIO(r.content)).convert("RGB").resize((48, 48))
        q = img.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette()[:15]
        counts = sorted(q.getcolors(), reverse=True)
        cols = []
        for _, idx in counts:
            rr, gg, bb = pal[idx * 3 : idx * 3 + 3]
            cols.append("#%02x%02x%02x" % (rr, gg, bb))
        return cols[:4]
    except Exception:
        return ["#7d442d", "#541214", "#a5754c", "#702d1f"]

def process_track(it):
    track_id = str(it.get("trackId"))
    title = it.get("trackName", "")
    album = it.get("collectionName", "")
    album_id = str(it.get("collectionId", ""))
    year = str((it.get("releaseDate") or "2015")[:4])
    explicit = it.get("trackExplicitness") == "explicit"
    preview = it.get("previewUrl") or ""
    apple_url = it.get("trackViewUrl") or ""
    art_raw = it.get("artworkUrl100") or ""
    art_hi = re.sub(r"/\d+x\d+bb\.jpg$", "/{s}x{s}bb.jpg", art_raw)
    sample_art_url = re.sub(r"/\d+x\d+bb\.jpg$", "/500x500bb.jpg", art_raw)

    print(f"-> Processing: {title} ({album}) [{track_id}]...")

    # 1. JioSaavn 320 kbps stream
    saavn = get_saavn_stream(title, target_dur=it.get("trackTimeMillis", 0) / 1000.0)
    if not saavn:
        print(f"   [!] No Saavn stream found for {title}")
        return None

    duration = saavn["duration"] or (it.get("trackTimeMillis", 0) / 1000.0) or 240.0
    audio_url = saavn["url"]
    saavn_id = saavn["saavnId"]

    # 2. Lyrics from LRCLIB
    lyr = get_lrclib_lyrics(title, "Lana Del Rey", dur=duration)
    lyrics_type = "none"
    if lyr and lyr.get("synced"):
        lyrics_type = "synced"
        full_lines = build_full_lyrics(lyr["lrc"], duration)
        lyr_payload = {
            "id": track_id,
            "synced": True,
            "offset": 0,
            "source": lyr["source"],
            "lines": full_lines,
            "plain": lyr.get("plain", ""),
        }
        for path in (PUBLIC_LYRICS / f"{track_id}.json", DOCS_LYRICS / f"{track_id}.json"):
            path.write_text(json.dumps(lyr_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"   [+] Synced lyrics saved ({len(full_lines)} lines)")

    # 3. Colors
    colors = palette_from_url(sample_art_url)

    song_obj = {
        "id": track_id,
        "title": title,
        "artist": "Lana Del Rey",
        "artistId": "464296584",
        "album": album,
        "albumId": album_id,
        "art": art_hi,
        "videoArt": None,
        "audio": audio_url,
        "preview": preview,
        "isFull": True,
        "saavnId": saavn_id,
        "ArtistImageHint": "https://cdn-images.dzcdn.net/images/artist/8994d3be1a59a72f887f1f8afd2d4c6c/1000x1000-000000-80-0-0.jpg",
        "duration": duration,
        "genre": "romance",
        "lang": "en",
        "explicit": explicit,
        "year": year,
        "appleUrl": apple_url,
        "colors": colors,
        "lyrics": lyrics_type,
        "offset": 0,
    }
    return song_obj

def main():
    print("Fetching Lana Del Rey tracks from iTunes...")
    r = _session.get(
        "https://itunes.apple.com/lookup",
        params={"id": "464296584", "entity": "song", "limit": 100},
        timeout=12,
    )
    r.raise_for_status()
    data = r.json()
    raw_tracks = [x for x in data.get("results", []) if x.get("wrapperType") == "track" and x.get("previewUrl")]
    print(f"Total raw tracks from iTunes lookup: {len(raw_tracks)}")

    # Deduplicate and filter out remixes/tributes
    seen = set()
    filtered_tracks = []
    for t in raw_tracks:
        name = t.get("trackName", "").strip()
        base = clean(name)
        if base in seen:
            continue
        if BAD.search(name) and "young and beautiful" not in base and "summertime sadness" not in base:
            continue
        seen.add(base)
        filtered_tracks.append(t)

    # Also search iTunes for specific iconic tracks that might be missing from lookup limit
    EXTRA_SEARCH = [
        "Video Games",
        "Born to Die",
        "Blue Jeans",
        "Diet Mountain Dew",
        "National Anthem",
        "Dark Paradise",
        "Radio",
        "Carmen",
        "Million Dollar Man",
        "Summertime Sadness",
        "Off to the Races",
        "Without You",
        "Ride",
        "Cola",
        "Body Electric",
        "Blue Velvet",
        "Gods & Monsters",
        "Young and Beautiful",
        "West Coast",
        "Brooklyn Baby",
        "Shades of Cool",
        "Ultraviolence",
        "Sad Girl",
        "Pretty When You Cry",
        "Old Money",
        "Black Beauty",
        "Florida Kilos",
        "High by the Beach",
        "Music to Watch Boys To",
        "Art Deco",
        "Salvatore",
        "Freak",
        "Lust for Life",
        "Love",
        "Cherry",
        "White Mustang",
        "13 Beaches",
        "Norman fucking Rockwell",
        "Mariners Apartment Complex",
        "Venice Bitch",
        "Fuck it I love you",
        "Doin' Time",
        "Cinnamon Girl",
        "How to disappear",
        "California",
        "The greatest",
        "Happiness is a butterfly",
        "hope is a dangerous thing for a woman like me to have - but i have it",
        "White Dress",
        "Chemtrails Over the Country Club",
        "Tulsa Jesus Freak",
        "Wild at Heart",
        "Blue Banisters",
        "Arcadia",
        "Dealer",
        "Thunder",
        "Did you know that there's a tunnel under Ocean Blvd",
        "A&W",
        "The Grants",
        "Candy Necklace",
        "Paris, Texas",
        "Margaret",
        "Peppers",
        "Taco Truck x VB",
        "Say Yes to Heaven",
    ]

    for title in EXTRA_SEARCH:
        base = clean(title)
        if base in seen:
            continue
        try:
            s_res = _session.get(
                "https://itunes.apple.com/search",
                params={"term": f"Lana Del Rey {title}", "entity": "song", "limit": 5},
                timeout=8,
            ).json()
            for cand in s_res.get("results", []):
                if cand.get("wrapperType") == "track" and "lana" in cand.get("artistName", "").lower():
                    cand_base = clean(cand.get("trackName", ""))
                    if fuzz.ratio(base, cand_base) >= 70 and not BAD.search(cand.get("trackName", "")):
                        seen.add(base)
                        filtered_tracks.append(cand)
                        break
        except Exception:
            pass

    print(f"Total curated Lana Del Rey tracks to process: {len(filtered_tracks)}")

    # Process in parallel
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futs = {executor.submit(process_track, t): t for t in filtered_tracks}
        for fut in concurrent.futures.as_completed(futs):
            try:
                res = fut.result()
                if res:
                    results.append(res)
            except Exception as e:
                print(f"Error processing track: {e}")

    print(f"Successfully processed {len(results)} Lana Del Rey tracks with 320 kbps stream!")

    # Load existing catalog
    cat_path = PUBLIC_DATA / "catalog.json"
    with open(cat_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    # Ensure artist entry
    catalog.setdefault("artists", {})
    catalog["artists"]["464296584"] = {
        "id": "464296584",
        "name": "Lana Del Rey",
        "genre": "Alternative",
        "image": "https://cdn-images.dzcdn.net/images/artist/8994d3be1a59a72f887f1f8afd2d4c6c/1000x1000-000000-80-0-0.jpg",
        "fans": 5847585,
        "colors": ["#7d442d", "#541214", "#a5754c", "#702d1f"],
        "genres": ["romance", "pop"],
        "appleUrl": "https://music.apple.com/us/artist/lana-del-rey/464296584?uo=4",
    }

    # Add songs
    added_ids = []
    for s in results:
        sid = s["id"]
        catalog["songs"][sid] = s
        added_ids.append(sid)

    # Add to genres
    for g in catalog.get("genres", []):
        if g.get("id") in ("romance", "pop"):
            cur_ids = set(g.get("songIds", []))
            for sid in added_ids:
                cur_ids.add(sid)
            g["songIds"] = list(cur_ids)

    # Save to public and docs
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    with open(DOCS_DATA / "catalog.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"DONE! Total catalog songs: {len(catalog['songs'])}. Lana tracks in catalog: {len([s for s in catalog['songs'].values() if 'lana' in s.get('artist','').lower()])}")

if __name__ == "__main__":
    main()
