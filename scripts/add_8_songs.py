"""
Add 8 tracks (7 user requests including GENER8ION's 2-part STORM single) in full length with:
  - Compact AAC .m4a local audio (48k 32kHz +faststart) via JioSaavn + SoundCloud -> ffmpeg
  - Official Apple Music iTunes metadata, {s}x{s}bb.jpg art, animated covers, & color palettes
  - Word-by-word synced lyrics from LRCLIB with strict track/duration disambiguation
  - Hero-preserving artist deduplication/merging (sva_720746 -> 349736311 for Twenty One Pilots)
  - Per-run cached official Apple Music 4K/2K artist hero enrichment
  - Minified public/data/catalog.json ready for Vite production build
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from rapidfuzz import fuzz

sys.path.insert(0, str(Path(__file__).parent))
from build_catalog import (  # noqa: E402
    WTS,
    build_full_lyrics,
    clean,
    find_animated_cover,
    find_full_audio,
    fold,
    palette_from_url,
    sess,
)
from enrich_artists_hero import fetch_apple_artist_hero  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PUB_DATA = ROOT / "public" / "data"
PUB_AUDIO = PUB_DATA / "audio"
PUB_LYR = PUB_DATA / "lyrics"
TMP_DIR = ROOT / "scripts" / ".tmp_audio"

for d in (PUB_AUDIO, PUB_LYR, TMP_DIR):
    d.mkdir(parents=True, exist_ok=True)


TRACKS_TO_ADD = [
    {
        "trackId": "1640353346",
        "country": "us",
        "genre": "pop",
        "lang": "en",
        "file": "aurora_cure_for_me.m4a",
        "artist_override": "AURORA",
        "canonical_artist_name": "AURORA",
        "canonical_artist_id": "947171999",
        "audio_source": "saavn",
        "saavn_artist": "AURORA",
        "saavn_title": "Cure For Me",
        "dur_bounds": (192.0, 212.0),
        "lrc_queries": [
            {"track_name": "Cure For Me", "artist_name": "AURORA"},
            {"q": "Cure For Me AURORA"},
        ],
        "aliases": "cure for me aurora gods we can touch",
    },
    {
        "trackId": "1845989056",
        "country": "us",
        "genre": "pop",
        "lang": "la",
        "file": "aurora_nod_krai.m4a",
        "artist_override": "HOYO-MiX & AURORA",
        "canonical_artist_name": "AURORA",
        "canonical_artist_id": "947171999",
        "audio_source": "saavn",
        "saavn_artist": "AURORA",
        "saavn_title": "Nod-Krai",
        "dur_bounds": (250.0, 270.0),
        "lrc_queries": [
            {"q": "Nod-Krai AURORA"},
            {"q": "Nod-Krai HOYO-MiX"},
        ],
        "aliases": "nod-krai nod krai aurora hoyo-mix genshin impact",
    },
    {
        "trackId": "1771718370",
        "country": "us",
        "genre": "pop",
        "lang": "en",
        "file": "aurora_runaway.m4a",
        "artist_override": "AURORA",
        "canonical_artist_name": "AURORA",
        "canonical_artist_id": "947171999",
        "audio_source": "saavn",
        "saavn_artist": "AURORA",
        "saavn_title": "Runaway",
        "dur_bounds": (240.0, 258.0),
        "lrc_queries": [
            {"track_name": "Runaway", "artist_name": "AURORA"},
            {"q": "Runaway AURORA"},
        ],
        "aliases": "runaway aurora all my demons",
    },
    {
        "trackId": "1817714083",
        "country": "us",
        "genre": "latin",
        "lang": "es",
        "file": "easykid_shiny.m4a",
        "artist_override": "Easykid",
        "canonical_artist_name": "Easykid",
        "canonical_artist_id": "1259120125",
        "audio_source": "soundcloud",
        "sc_url": "https://soundcloud.com/manuel-aravena-702411322/shiny-easykid",
        "dur_bounds": (148.0, 170.0),
        "lrc_queries": [
            {"track_name": "Shiny", "artist_name": "Easykid"},
            {"q": "Shiny Easykid"},
        ],
        "aliases": "shiny easykid im part i'm part",
    },
    {
        "trackId": "1890018667",
        "country": "us",
        "genre": "pop",
        "lang": "en",
        "file": "gener8ion_storm_1.m4a",
        "artist_override": "GENER8ION & Yung Lean",
        "canonical_artist_name": "GENER8ION",
        "canonical_artist_id": "931499504",
        "audio_source": "saavn",
        "saavn_artist": "GENER8ION",
        "saavn_title": "STORM I",
        "dur_bounds": (202.0, 218.0),
        "lrc_queries": [
            {"q": "STORM I GENER8ION"},
            {"track_name": "STORM I", "artist_name": "GENER8ION"},
        ],
        "lrc_reject_track_regexes": [r"\bstorm\s*(?:ii|2)\b", r"\bii\b"],
        "aliases": "storm storm i storm 1 gener8ion yung lean",
    },
    {
        "trackId": "1890018672",
        "country": "us",
        "genre": "pop",
        "lang": "en",
        "file": "gener8ion_storm_2.m4a",
        "artist_override": "GENER8ION & Yung Lean",
        "canonical_artist_name": "GENER8ION",
        "canonical_artist_id": "931499504",
        "audio_source": "saavn",
        "saavn_artist": "GENER8ION",
        "saavn_title": "STORM II",
        "dur_bounds": (166.0, 182.0),
        "lrc_queries": [
            {"track_name": "Storm", "artist_name": "Gener8ion"},
            {"q": "STORM II GENER8ION"},
        ],
        "lrc_reject_track_regexes": [r"\bstorm\s*(?:i|1)(?!i)\b"],
        "aliases": "storm storm ii storm 2 gener8ion yung lean",
    },
    {
        "trackId": "1843518968",
        "country": "us",
        "genre": "kpop",
        "lang": "ko",
        "file": "hwasa_good_goodbye.m4a",
        "artist_override": "HWASA",
        "canonical_artist_name": "HWASA",
        "canonical_artist_id": "915548460",
        "audio_source": "saavn",
        "saavn_artist": "HWASA",
        "saavn_title": "Good Goodbye",
        "dur_bounds": (215.0, 233.0),
        "lrc_queries": [
            {"track_name": "Good Goodbye", "artist_name": "HWASA"},
            {"q": "Good Goodbye HWASA"},
            {"q": "Good Goodbye 화사"},
        ],
        "aliases": "good goodbye hwasa 화사",
    },
    {
        "trackId": "1876977596",
        "country": "us",
        "genre": "rock",
        "lang": "en",
        "file": "twenty_one_pilots_drag_path.m4a",
        "artist_override": "Twenty One Pilots",
        "canonical_artist_name": "Twenty One Pilots",
        "canonical_artist_id": "349736311",
        "merge_from_ids": ["sva_720746"],
        "audio_source": "saavn",
        "saavn_artist": "Twenty One Pilots",
        "saavn_title": "Drag Path",
        "dur_bounds": (218.0, 232.0),
        "lrc_queries": [
            {"track_name": "Drag Path", "artist_name": "twenty one pilots"},
            {"q": "Drag Path Twenty One Pilots"},
        ],
        "aliases": "drag path twenty one pilots breach",
    },
]


def lookup_itunes_track(track_id: str, country: str = "us"):
    for c in (country, "us", "cl", "kr", "fr", "gb"):
        try:
            r = sess().get(
                "https://itunes.apple.com/lookup",
                params={"id": track_id, "country": c},
                timeout=12,
            )
            if r.ok:
                for item in r.json().get("results", []):
                    if str(item.get("trackId")) == str(track_id):
                        return item
        except Exception:
            pass
    return None


def probe_duration(path: Path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        ).strip()
        return float(out)
    except Exception:
        return 0.0


def download_and_compress_audio(spec: dict, target_dur: float) -> float:
    out_filename = spec["file"]
    pub_dest = PUB_AUDIO / out_filename
    min_d, max_d = spec["dur_bounds"]

    if pub_dest.exists() and pub_dest.stat().st_size > 300_000:
        existing_dur = probe_duration(pub_dest)
        if min_d <= existing_dur <= max_d:
            print(f"    Using existing verified audio {out_filename} ({existing_dur:.1f}s)")
            return existing_dur

    for f in TMP_DIR.glob(f"{out_filename}.*"):
        f.unlink(missing_ok=True)

    raw_file = None
    source_type = spec.get("audio_source")
    if source_type == "saavn":
        res = find_full_audio(spec["saavn_artist"], spec["saavn_title"], target_dur)
        if not res or res.get("score", 0) < 80 or not (min_d <= float(res.get("duration") or 0) <= max_d):
            raise RuntimeError(f"JioSaavn match invalid for {spec['trackId']} ({spec['file']}): {res}")
        print(
            f"    Selected JioSaavn: '{res['title']}' by '{res['artist']}' "
            f"(dur={res['duration']}s, score={res['score']:.1f})"
        )
        raw_file = TMP_DIR / f"{out_filename}.raw.mp4"
        with sess().get(res["url"], stream=True, timeout=60) as resp:
            resp.raise_for_status()
            with open(raw_file, "wb") as fp:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        fp.write(chunk)
    elif source_type == "soundcloud":
        sc_url = spec["sc_url"]
        print(f"    Selected SoundCloud: {sc_url}")
        raw_tmpl = str(TMP_DIR / f"{out_filename}.%(ext)s")
        dl = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "--no-warnings",
                "--no-progress",
                "--no-update",
                "-f",
                "bestaudio",
                "-o",
                raw_tmpl,
                sc_url,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        downloaded = list(TMP_DIR.glob(f"{out_filename}.*"))
        if dl.returncode != 0 or not downloaded:
            snippet = ((dl.stderr or dl.stdout or "")[-300:]).strip()
            raise RuntimeError(f"SoundCloud download failed for {sc_url}: {snippet}")
        raw_file = downloaded[0]
    else:
        raise RuntimeError(f"Unsupported audio_source '{source_type}' for {spec['trackId']}")

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(raw_file),
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "48k",
                "-ar",
                "32000",
                "-movflags",
                "+faststart",
                str(pub_dest),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        size = pub_dest.stat().st_size
        dur = probe_duration(pub_dest)
        if size <= 300_000 or not (min_d <= dur <= max_d):
            pub_dest.unlink(missing_ok=True)
            raise RuntimeError(f"Encoded file validation failed for {out_filename}: size={size}, dur={dur}")
        return dur
    finally:
        for f in TMP_DIR.glob(f"{out_filename}.*"):
            f.unlink(missing_ok=True)


def fetch_synced_lyrics(spec: dict, real_dur: float):
    cands = {}
    rej_rx = [re.compile(rx, re.I) for rx in spec.get("lrc_reject_track_regexes", [])]
    rej_terms = [t.lower() for t in spec.get("lrc_reject_track_terms", [])]

    for q in spec["lrc_queries"]:
        try:
            r = sess().get("https://lrclib.net/api/search", params=q, timeout=12)
            if not r.ok:
                continue
            for c in r.json():
                if not c.get("instrumental") and c.get("syncedLyrics"):
                    cands[c["id"]] = c
        except Exception:
            pass

    if not cands:
        return None

    filtered = []
    for c in cands.values():
        cdur = float(c.get("duration") or 0)
        if abs(cdur - real_dur) > 12.0:
            continue
        tname = (c.get("trackName") or "").lower()
        aname = (c.get("artistName") or "").lower()
        blob = f"{tname} {aname}"
        if any(rt in tname for rt in rej_terms):
            continue
        if any(rx.search(tname) for rx in rej_rx):
            continue
        if "remix" in blob or "live" in blob or "acoustic" in blob:
            continue
        filtered.append(c)

    if not filtered:
        return None

    filtered.sort(
        key=lambda c: (
            1 if "^" in c["syncedLyrics"] else 0,
            0 if (spec["lang"] != "ko" or re.search(r"[\uac00-\ud7af]", c["syncedLyrics"])) else 1,
            0 if WTS.search(c["syncedLyrics"]) else 1,
            abs(float(c.get("duration") or 0) - real_dur),
        )
    )
    best = filtered[0]
    lines = build_full_lyrics(best["syncedLyrics"], real_dur)
    return {
        "synced": True,
        "source": f"lrclib:{best['id']}",
        "lines": lines,
        "plain": best.get("plainLyrics") or "",
    }


def fetch_deezer_artist(name: str):
    for q in (name, name.split("(")[0].strip()):
        if not q:
            continue
        try:
            r = sess().get("https://api.deezer.com/search/artist", params={"q": q, "limit": 5}, timeout=10)
            if not r.ok:
                continue
            best = None
            for a in r.json().get("data", []):
                if fuzz.ratio(fold(clean(q)), fold(clean(a.get("name", "")))) >= 75:
                    if best is None or a.get("nb_fan", 0) > best.get("nb_fan", 0):
                        best = a
            if best:
                return best
        except Exception:
            pass
    return None


def upsert_and_merge_artist(catalog: dict, aid: str, spec: dict, it: dict, art_tpl: str, cols: list, hero_cache: dict):
    artists = catalog["artists"]
    songs = catalog["songs"]
    canon_name = spec["canonical_artist_name"]
    merged = {}

    for old_id in [aid] + spec.get("merge_from_ids", []):
        if old_id in artists:
            for k, v in artists[old_id].items():
                if v is None or v == "" or v == []:
                    continue
                if k not in merged or (k == "fans" and (v or 0) > (merged.get("fans") or 0)):
                    merged[k] = v

    all_genres = list(merged.get("genres") or [])
    for old_id in [aid] + spec.get("merge_from_ids", []):
        if old_id in artists:
            for g in artists[old_id].get("genres") or []:
                if g not in all_genres:
                    all_genres.append(g)
    if spec["genre"] not in all_genres:
        all_genres.append(spec["genre"])

    remapped = 0
    for old_id in spec.get("merge_from_ids", []):
        if old_id != aid and old_id in artists:
            del artists[old_id]
            for s in songs.values():
                if s.get("artistId") == old_id:
                    s["artistId"] = aid
                    remapped += 1
    if remapped:
        print(f"    Merged artist '{canon_name}' -> {aid} (remapped {remapped} existing songs)")

    merged["id"] = aid
    merged["name"] = canon_name
    merged["genres"] = all_genres
    if not merged.get("genre"):
        merged["genre"] = it.get("primaryGenreName") or spec["genre"].title()
    if not merged.get("colors"):
        merged["colors"] = cols
    if not merged.get("appleId") and str(aid).isdigit():
        merged["appleId"] = str(aid)
    if not merged.get("appleUrl") or "jiosaavn.com" in str(merged.get("appleUrl", "")):
        merged["appleUrl"] = it.get("artistViewUrl") or it.get("trackViewUrl") or ""

    if not merged.get("fans") or not merged.get("image") or "saavncdn.com" in str(merged.get("image", "")):
        dz = fetch_deezer_artist(canon_name)
        if dz:
            if (dz.get("nb_fan") or 0) > (merged.get("fans") or 0):
                merged["fans"] = dz["nb_fan"]
            if dz.get("picture_xl") and (not merged.get("image") or "saavncdn.com" in merged["image"]):
                merged["image"] = dz["picture_xl"]
    if not merged.get("image"):
        merged["image"] = art_tpl.replace("{s}", "1000")
    if not merged.get("fans"):
        merged["fans"] = 25000

    apple_lookup_id = str(merged.get("appleId") or aid)
    if apple_lookup_id not in hero_cache:
        hero_cache[apple_lookup_id] = fetch_apple_artist_hero(apple_lookup_id)
    hero = hero_cache[apple_lookup_id]
    for hf in ("heroVideo4k", "heroVideo", "heroImage", "logo"):
        if hero.get(hf) and (not merged.get(hf) or hf in ("heroImage", "logo")):
            merged[hf] = hero[hf]

    artists[aid] = merged
    return merged


def preview_first_lines(lines: list) -> list:
    out = []
    for ln in lines:
        if ln.get("inst"):
            continue
        out.append("".join(w["w"] for w in ln["words"]))
        if len(out) >= 2:
            break
    return out


def main():
    catalog_path = PUB_DATA / "catalog.json"
    catalog = json.loads(catalog_path.read_text("utf-8"))
    songs = catalog["songs"]
    artists = catalog["artists"]
    hero_cache = {}

    for idx, spec in enumerate(TRACKS_TO_ADD, 1):
        tid = spec["trackId"]
        print(f"\n[{idx}/{len(TRACKS_TO_ADD)}] Processing {spec['artist_override']} - tid={tid}...")
        it = lookup_itunes_track(tid, spec["country"])
        if not it:
            raise RuntimeError(f"iTunes lookup failed for trackId={tid}")

        t_name = it["trackName"]
        a_name = spec.get("artist_override") or it["artistName"]
        a_id = spec.get("canonical_artist_id") or str(it["artistId"])
        alb_name = it.get("collectionName", "")
        alb_id = str(it.get("collectionId", ""))
        art_tpl = re.sub(r"/\d+x\d+[a-z]+\.(jpg|png|webp)$", "/{s}x{s}bb.jpg", it["artworkUrl100"])
        preview_url = it.get("previewUrl", "")
        it_dur = (it.get("trackTimeMillis") or 200000) / 1000.0
        explicit = it.get("trackExplicitness") == "explicit"
        year = (it.get("releaseDate") or "2024")[:4]
        apple_url = it.get("trackViewUrl", "")
        video_art = find_animated_cover(it.get("collectionViewUrl"))

        real_dur = download_and_compress_audio(spec, it_dur)
        audio_rel = f"data/audio/{spec['file']}"

        lyr = fetch_synced_lyrics(spec, real_dur)
        if not lyr or not lyr.get("lines") or len(lyr["lines"]) < 10:
            raise RuntimeError(f"Failed to fetch synced lyrics for {tid} ({t_name}); got {lyr}")

        payload = {
            "id": tid,
            "synced": True,
            "offset": 0,
            "source": lyr["source"],
            "lines": lyr["lines"],
            "plain": lyr.get("plain", ""),
        }
        (PUB_LYR / f"{tid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            "utf-8",
        )

        cols = palette_from_url(art_tpl.replace("{s}", "150")) if art_tpl else ["#fa2d48", "#5e5ce6", "#1c1c1e"]
        songs[tid] = {
            "id": tid,
            "title": t_name,
            "artist": a_name,
            "artistId": a_id,
            "album": alb_name,
            "albumId": alb_id,
            "art": art_tpl,
            "videoArt": video_art,
            "audio": audio_rel,
            "preview": preview_url or audio_rel,
            "isFull": True,
            "saavnId": f"custom_{tid}",
            "ArtistImageHint": art_tpl.replace("{s}", "500"),
            "duration": round(real_dur, 1),
            "genre": spec["genre"],
            "lang": spec["lang"],
            "explicit": explicit,
            "year": year,
            "appleUrl": apple_url,
            "colors": cols,
            "lyrics": "synced",
            "offset": 0,
            "aliases": spec["aliases"],
        }

        ar_obj = upsert_and_merge_artist(catalog, a_id, spec, it, art_tpl, cols, hero_cache)
        size_kb = (PUB_AUDIO / spec["file"]).stat().st_size // 1024
        print(
            f"    OK! '{t_name}' - {a_name} | {real_dur:.1f}s ({size_kb} KB) | "
            f"lyrics={len(lyr['lines'])} lines ({lyr['source']}) {preview_first_lines(lyr['lines'])} | "
            f"heroVid={bool(ar_obj.get('heroVideo'))}, heroVid4k={bool(ar_obj.get('heroVideo4k'))}, "
            f"heroImg={bool(ar_obj.get('heroImage'))}, logo={bool(ar_obj.get('logo'))}"
        )

    for g in catalog["genres"]:
        g["songIds"] = [s["id"] for s in songs.values() if s["genre"] == g["id"]]

    catalog["generated"] = time.strftime("%Y-%m-%d %H:%M")
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), "utf-8")

    for f in TMP_DIR.glob("*"):
        f.unlink(missing_ok=True)

    print(f"\nDONE! Total songs={len(songs)}, Total artists={len(artists)}")


if __name__ == "__main__":
    main()
