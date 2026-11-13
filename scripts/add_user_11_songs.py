"""
Add 11 user-requested songs at full length with 320kbps streams,
high-res Apple Music artwork, and word-by-word synced lyrics.
"""
import base64
import hashlib
import html
import io
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from Crypto.Cipher import DES
from rapidfuzz import fuzz

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = ROOT / "public" / "data"
DOCS_DATA = ROOT / "docs" / "data"
PUBLIC_LYRICS = PUBLIC_DATA / "lyrics"
DOCS_LYRICS = DOCS_DATA / "lyrics"

for p in (PUBLIC_LYRICS, DOCS_LYRICS, PUBLIC_DATA / "audio", DOCS_DATA / "audio"):
    p.mkdir(parents=True, exist_ok=True)

_session = requests.Session()
_session.headers["User-Agent"] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

TS = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")
WTS = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")
VOWELS = re.compile(r"[aeiouyáéíóúàèìòùâêîôûäëïöüãõœæ]+", re.I)

def clean(s):
    s = html.unescape(unicodedata.normalize("NFKC", s or "")).lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())

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

def get_lrclib_lyrics(title, artist, dur=None):
    clean_t = re.sub(r"\(.*?\)|\[.*?\]", "", title).strip()
    qs = [
        {"track_name": clean_t, "artist_name": artist},
        {"track_name": title, "artist_name": artist},
        {"q": f"{artist} {clean_t}"},
        {"q": clean_t},
    ]
    for q in qs:
        try:
            r = _session.get("https://lrclib.net/api/search", params=q, timeout=8)
            if r.ok:
                for c in r.json():
                    if c.get("syncedLyrics"):
                        c_dur = float(c.get("duration") or 0)
                        if dur and abs(c_dur - dur) > 25:
                            continue
                        return {"synced": True, "source": f"lrclib:{c['id']}", "lrc": c["syncedLyrics"], "plain": c.get("plainLyrics") or ""}
                    elif c.get("plainLyrics") and not dur:
                        return {"synced": False, "source": f"lrclib:{c['id']}", "lrc": "", "plain": c.get("plainLyrics")}
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
        return ["#fa2d48", "#5e5ce6", "#1c1c1e", "#3a3a3c"]

REQUESTED = [
    {
        "search_term": "Bleachers Merry Christmas, Please Don't Call",
        "artist_override": "Bleachers",
        "title_override": "Merry Christmas, Please Don't Call",
        "audio_stream": "https://aac.saavncdn.com/732/233f3eb6284720b2aa9711e7d15927e_320.mp4",
        "duration": 202.0,
        "genre": "pop",
        "country": "us"
    },
    {
        "search_term": "Alex Crichton Merry Christmas, i miss you",
        "artist_override": "Alex Crichton",
        "title_override": "Merry Christmas, i miss you",
        "audio_stream": "data/audio/alex_crichton_merry_christmas.m4a",
        "duration": 246.0,
        "genre": "romance",
        "country": "us"
    },
    {
        "search_term": "Alex Crichton What If I Call",
        "artist_override": "Alex Crichton",
        "title_override": "What If I Call",
        "audio_stream": "data/audio/alex_crichton_what_if_i_call.m4a",
        "duration": 160.0,
        "genre": "romance",
        "country": "us"
    },
    {
        "search_term": "The 1975 About You",
        "artist_override": "The 1975",
        "title_override": "About You",
        "audio_stream": "https://aac.saavncdn.com/934/3c98aa156afd4de95100e4d437b1128_320.mp4",
        "duration": 326.0,
        "genre": "pop",
        "country": "us"
    },
    {
        "search_term": "Ariana Grande hate that i made you love me",
        "artist_override": "Ariana Grande",
        "title_override": "hate that i made you love me",
        "audio_stream": "https://aac.saavncdn.com/741/08e06539a2706f5da2ed8813ffe68c8_320.mp4",
        "duration": 198.0,
        "genre": "pop",
        "country": "us"
    },
    {
        "search_term": "Sufjan Stevens Mystery of Love",
        "artist_override": "Sufjan Stevens",
        "title_override": "Mystery of Love",
        "audio_stream": "https://aac.saavncdn.com/392/5c7ed19e9c13c41df2d0687743ace0f_320.mp4",
        "duration": 249.0,
        "genre": "romance",
        "country": "us"
    },
    {
        "search_term": "milet The Story of Us",
        "artist_override": "milet",
        "title_override": "The Story of Us",
        "audio_stream": "https://aac.saavncdn.com/072/99678e8ffb456318d5e5b569e2aef96_320.mp4",
        "duration": 267.0,
        "genre": "jpop",
        "country": "jp"
    },
    {
        "search_term": "She & Him I Thought I Saw Your Face Today",
        "artist_override": "She & Him",
        "title_override": "I Thought I Saw Your Face Today",
        "audio_stream": "https://aac.saavncdn.com/106/e1a39adaa8163c8ef1ff07accab4ad4_320.mp4",
        "duration": 170.0,
        "genre": "romance",
        "country": "us"
    },
    {
        "search_term": "Kenshi Yonezu JANE DOE",
        "artist_override": "Kenshi Yonezu & Hikaru Utada",
        "title_override": "JANE DOE",
        "audio_stream": "https://aac.saavncdn.com/211/eca04e8b0e80187e88274a2a4f8e51e_320.mp4",
        "duration": 235.0,
        "genre": "jpop",
        "country": "jp"
    },
    {
        "search_term": "Kenshi Yonezu IRIS OUT",
        "artist_override": "Kenshi Yonezu",
        "title_override": "IRIS OUT",
        "audio_stream": "https://aac.saavncdn.com/181/36d2a1c4145728de79a78d48e29ea14_320.mp4",
        "duration": 151.0,
        "genre": "jpop",
        "country": "jp"
    },
    {
        "search_term": "Rosa Walton I Really Want to Stay at Your House",
        "artist_override": "Rosa Walton & Hallie Coggins",
        "title_override": "I Really Want to Stay at Your House",
        "audio_stream": "https://aac.saavncdn.com/720/78f1077c9b0d5383eceb6fc6a0dfbd83_320.mp4",
        "duration": 246.0,
        "genre": "pop",
        "country": "us"
    },
]

def main():
    cat_path = PUBLIC_DATA / "catalog.json"
    with open(cat_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    added_count = 0
    for req in REQUESTED:
        term = req["search_term"]
        country = req.get("country", "us")
        print(f"\nProcessing: {term}...")

        # 1. Fetch iTunes metadata
        r = _session.get(
            "https://itunes.apple.com/search",
            params={"term": term, "entity": "song", "limit": 5, "country": country},
            timeout=10,
        )
        if not r.ok or not r.json().get("results"):
            print(f"   [!] No iTunes track found for {term}")
            continue

        it = r.json()["results"][0]
        track_id = str(it.get("trackId"))
        title = req.get("title_override") or it.get("trackName")
        artist = req.get("artist_override") or it.get("artistName")
        artist_id = str(it.get("artistId") or "")
        album = it.get("collectionName") or title
        album_id = str(it.get("collectionId") or "")
        year = str((it.get("releaseDate") or "2024")[:4])
        explicit = it.get("trackExplicitness") == "explicit"
        preview = it.get("previewUrl") or ""
        apple_url = it.get("trackViewUrl") or ""
        art_raw = it.get("artworkUrl100") or ""
        art_hi = re.sub(r"/\d+x\d+bb\.jpg$", "/{s}x{s}bb.jpg", art_raw)
        sample_art = re.sub(r"/\d+x\d+bb\.jpg$", "/500x500bb.jpg", art_raw)
        duration = req["duration"]
        audio_stream = req["audio_stream"]

        # 2. Lyrics from LRCLIB
        lyr = get_lrclib_lyrics(title, artist, dur=duration)
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
        elif lyr and lyr.get("plain"):
            lyrics_type = "plain"
            lyr_payload = {
                "id": track_id,
                "synced": False,
                "offset": 0,
                "source": lyr["source"],
                "lines": [],
                "plain": lyr["plain"],
            }
            for path in (PUBLIC_LYRICS / f"{track_id}.json", DOCS_LYRICS / f"{track_id}.json"):
                path.write_text(json.dumps(lyr_payload, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"   [~] Plain lyrics saved")

        # 3. Colors
        colors = palette_from_url(sample_art)

        # 4. Construct song object
        song_obj = {
            "id": track_id,
            "title": title,
            "artist": artist,
            "artistId": artist_id,
            "album": album,
            "albumId": album_id,
            "art": art_hi,
            "videoArt": None,
            "audio": audio_stream,
            "preview": preview,
            "isFull": True,
            "saavnId": f"custom_{track_id}",
            "ArtistImageHint": sample_art,
            "duration": duration,
            "genre": req["genre"],
            "lang": "ja" if req["genre"] == "jpop" else "en",
            "explicit": explicit,
            "year": year,
            "appleUrl": apple_url,
            "colors": colors,
            "lyrics": lyrics_type,
            "offset": 0,
        }

        catalog["songs"][track_id] = song_obj

        # 5. Ensure artist entry
        if artist_id and artist_id not in catalog.get("artists", {}):
            catalog.setdefault("artists", {})[artist_id] = {
                "id": artist_id,
                "name": artist,
                "genre": req["genre"].title(),
                "image": sample_art,
                "fans": 1000000,
                "colors": colors,
                "genres": [req["genre"]],
                "appleUrl": it.get("artistViewUrl") or apple_url,
            }

        # 6. Add to genre
        for g in catalog.get("genres", []):
            if g.get("id") == req["genre"]:
                if track_id not in g.get("songIds", []):
                    g.setdefault("songIds", []).append(track_id)

        added_count += 1
        print(f"   [OK] Added '{title}' by {artist} (id: {track_id}, genre: {req['genre']})")

    # Save to public and docs
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    with open(DOCS_DATA / "catalog.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"\nFINISHED! Added {added_count} songs. Total catalog songs: {len(catalog['songs'])}")

if __name__ == "__main__":
    main()
