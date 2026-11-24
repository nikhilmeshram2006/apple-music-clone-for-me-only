"""
Add 5 user-requested tracks in full length with:
  - Compact AAC .m4a local audio (48k 32kHz +faststart) via yt-dlp + ffmpeg
  - Official Apple Music iTunes metadata, {s}x{s}bb.jpg art, animated covers, & color palettes
  - Word-by-word (and Japanese kanji/kana) synced lyrics from LRCLIB
  - Hero-preserving artist deduplication/merging (sva_* -> numeric Apple ID)
  - Official Apple Music 4K/2K artist hero enrichment
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
        "trackId": "1709555009",
        "country": "us",
        "genre": "kpop",
        "lang": "en",
        "file": "jung_kook_please_dont_change.m4a",
        "artist_override": "Jung Kook & DJ Snake",
        "canonical_artist_name": "Jung Kook",
        "canonical_artist_id": "785052275",
        "merge_from_ids": ["sva_8711782"],
        "yt_queries": [
            "Jung Kook Please Don't Change DJ Snake Official Audio",
            "Please Don't Change Jung Kook GOLDEN audio",
        ],
        "dur_bounds": (135.0, 160.0),
        "positive_terms": ["jung kook", "jungkook", "please don't change", "please dont change", "dj snake", "golden"],
        "reject_title_terms": ["remix", "slowed", "sped", "karaoke", "instrumental", "cover", "live", "nightcore", "reaction", "8d", "lofi"],
        "lrc_queries": [
            {"track_name": "Please Don't Change", "artist_name": "Jung Kook"},
            {"q": "Please Don't Change Jung Kook"},
        ],
        "aliases": "please dont change please don't change jung kook dj snake golden",
    },
    {
        "trackId": "1440841384",
        "country": "us",
        "genre": "hiphop",
        "lang": "en",
        "file": "drake_one_dance.m4a",
        "artist_override": "Drake",
        "canonical_artist_name": "Drake",
        "canonical_artist_id": "271256",
        "merge_from_ids": ["sva_512453"],
        "replaces": ["sv_xKlnh38y"],
        "yt_queries": [
            "Drake One Dance Wizkid Kyla Official Audio",
            "One Dance Drake Views audio",
        ],
        "dur_bounds": (162.0, 188.0),
        "positive_terms": ["drake", "one dance", "wizkid", "kyla", "views"],
        "reject_title_terms": ["remix", "slowed", "sped", "karaoke", "instrumental", "cover", "live", "nightcore", "reaction", "8d", "lofi", "lullaby"],
        "lrc_queries": [
            {"track_name": "One Dance", "artist_name": "Drake"},
            {"q": "One Dance Drake"},
        ],
        "aliases": "one dance drake wizkid kyla views",
    },
    {
        "trackId": "1534617610",
        "country": "us",
        "genre": "rnb",
        "lang": "en",
        "file": "amaarae_sad_girlz_luv_money.m4a",
        "artist_override": "Amaarae",
        "canonical_artist_name": "Amaarae",
        "canonical_artist_id": "1292405220",
        "yt_queries": [
            "Amaarae SAD GIRLZ LUV MONEY feat Moliy Official Audio",
            "SAD GIRLZ LUV MONEY Amaarae THE ANGEL YOU DON'T KNOW",
        ],
        "dur_bounds": (186.0, 202.0),
        "positive_terms": ["amaarae", "sad girlz luv money", "moliy"],
        "reject_title_terms": ["remix", "kali uchis", "slowed", "sped", "karaoke", "instrumental", "cover", "live", "nightcore", "amapiano", "8d"],
        "lrc_queries": [
            {"track_name": "SAD GIRLZ LUV MONEY", "artist_name": "Amaarae"},
            {"q": "SAD GIRLZ LUV MONEY Amaarae"},
        ],
        "aliases": "sad girlz luv money sad gurlz luv money amaarae moliy",
    },
    {
        "trackId": "1189391898",
        "country": "us",
        "genre": "latin",
        "lang": "es",
        "file": "nicky_jam_hasta_el_amanecer.m4a",
        "artist_override": "Nicky Jam",
        "canonical_artist_name": "Nicky Jam",
        "canonical_artist_id": "33987470",
        "yt_queries": [
            "Nicky Jam Hasta el Amanecer Official Audio",
            "Hasta el Amanecer Nicky Jam Fenix",
        ],
        "dur_bounds": (188.0, 212.0),
        "positive_terms": ["nicky jam", "hasta el amanecer", "fenix"],
        "reject_title_terms": ["remix", "daddy yankee", "slowed", "sped", "karaoke", "instrumental", "cover", "live", "nightcore", "8d"],
        "lrc_queries": [
            {"track_name": "Hasta el Amanecer", "artist_name": "Nicky Jam"},
            {"q": "Hasta el Amanecer Nicky Jam"},
        ],
        "aliases": "hasta el amanecer hasta el amanacer nicky jam fenix",
    },
    {
        "trackId": "1671477071",
        "country": "us",
        "genre": "jpop",
        "lang": "ja",
        "file": "mahiru_shiina_aiuta.m4a",
        "artist_override": "Mahiru Shiina (CV. Manaka Iwami)",
        "canonical_artist_name": "Mahiru Shiina (CV. Manaka Iwami)",
        "canonical_artist_id": "1661601376",
        "yt_queries": [
            "椎名真昼 愛唄",
            "愛唄 Mahiru Shiina Manaka Iwami",
            "Aiuta Mahiru Shiina お隣の天使様",
        ],
        "dur_bounds": (203.0, 224.0),
        "positive_terms": ["椎名真昼", "真昼", "mahiru", "shiina", "石見舞菜香", "manaka", "iwami", "お隣の天使様", "angel next door"],
        "reject_title_terms": ["greeeen", "tv size", "tv-size", "short", "instrumental", "karaoke", "piano", "off vocal", "nightcore", "slowed", "sped", "1時間", "耐久"],
        "lrc_queries": [
            {"q": "愛唄 椎名真昼"},
            {"track_name": "愛唄", "artist_name": "椎名真昼(CV.石見舞菜香)"},
            {"q": "愛唄 石見舞菜香"},
        ],
        "aliases": "愛唄 aiuta ai uta mahiru shiina manaka iwami 椎名真昼 石見舞菜香 お隣の天使様",
    },
]


def lookup_itunes_track(track_id: str, country: str = "us"):
    for c in (country, "us", "jp", "gb", "in"):
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
            timeout=15,
        ).strip()
        return float(out)
    except Exception:
        return 0.0


def find_best_yt_candidate(spec: dict, target_dur: float):
    min_d, max_d = spec["dur_bounds"]
    rejects = [t.lower() for t in spec.get("reject_title_terms", [])]
    positives = [t.lower() for t in spec.get("positive_terms", [])]
    candidates = []

    for q in spec["yt_queries"]:
        try:
            res = subprocess.run(
                [
                    "yt-dlp",
                    "--no-playlist",
                    "--dump-json",
                    "--ignore-errors",
                    "--no-warnings",
                    f"ytsearch8:{q}",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=45,
            )
        except Exception as exc:
            print(f"    [warn] yt-dlp search error for '{q}': {exc}")
            continue

        for line in res.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                info = json.loads(line)
            except Exception:
                continue
            dur = float(info.get("duration") or 0)
            if not (min_d <= dur <= max_d):
                continue
            title_l = (info.get("title") or "").lower()
            uploader_l = (info.get("uploader") or info.get("channel") or "").lower()
            blob = f"{title_l} {uploader_l}"

            has_pos = any(p in blob for p in positives)
            rejected = False
            for rj in rejects:
                if rj in title_l:
                    # Allow "GReeeeN" mention only if strong Mahiru Shiina / anime indicator exists AND it's not a GReeeeN upload
                    if rj == "greeeen" and has_pos and "greeeen" not in uploader_l:
                        continue
                    rejected = True
                    break
            if rejected:
                continue

            # Compute ranking score (higher is better)
            pos_hits = sum(1 for p in positives if p in blob)
            # For 愛唄 by Mahiru Shiina, insist on at least one character/VA/anime hint or official Topic
            if spec["trackId"] == "1671477071" and pos_hits == 0:
                continue

            score = pos_hits * 20.0 - abs(dur - target_dur) * 2.5
            if "official audio" in title_l or "audio" in title_l:
                score += 12.0
            if "- topic" in uploader_l:
                score += 14.0
            if "official" in title_l:
                score += 6.0
            if "lyrics" in title_l or "lyric" in title_l:
                score -= 2.0

            candidates.append((score, dur, info))

        if candidates and max(c[0] for c in candidates) >= 15.0:
            break

    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][2]


def download_and_compress_audio(spec: dict, target_dur: float) -> float:
    out_filename = spec["file"]
    pub_dest = PUB_AUDIO / out_filename
    min_d, max_d = spec["dur_bounds"]

    if pub_dest.exists() and pub_dest.stat().st_size > 300_000:
        existing_dur = probe_duration(pub_dest)
        if min_d <= existing_dur <= max_d:
            print(f"    Using existing verified audio {out_filename} ({existing_dur:.1f}s)")
            return existing_dur

    best = find_best_yt_candidate(spec, target_dur)
    if not best:
        raise RuntimeError(f"No matching YouTube audio candidate found in bounds {spec['dur_bounds']} for {spec['trackId']}")

    yt_url = best.get("webpage_url") or f"https://www.youtube.com/watch?v={best['id']}"
    yt_title = best.get("title", "")
    yt_uploader = best.get("uploader") or best.get("channel") or ""
    yt_dur = float(best.get("duration") or 0)
    print(f"    Selected YT: [{best.get('id')}] '{yt_title}' by '{yt_uploader}' ({yt_dur:.1f}s)")

    for f in TMP_DIR.glob(f"{out_filename}.*"):
        f.unlink(missing_ok=True)
    raw_tmpl = str(TMP_DIR / f"{out_filename}.%(ext)s")

    dl = subprocess.run(
        [
            "yt-dlp",
            "--no-playlist",
            "--no-warnings",
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "-o",
            raw_tmpl,
            yt_url,
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    downloaded = list(TMP_DIR.glob(f"{out_filename}.*"))
    if dl.returncode != 0 or not downloaded:
        raise RuntimeError(f"yt-dlp download failed for {yt_url}: {dl.stderr}")

    raw_file = downloaded[0]
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
    raw_file.unlink(missing_ok=True)

    size = pub_dest.stat().st_size
    dur = probe_duration(pub_dest)
    if size <= 300_000 or not (min_d <= dur <= max_d):
        raise RuntimeError(f"Encoded file validation failed for {out_filename}: size={size}, dur={dur}")
    return dur


def fetch_synced_lyrics(lrc_queries: list, real_dur: float, reject_terms: list = None):
    cands = {}
    rejects = [t.lower() for t in (reject_terms or []) if t.lower() in ("remix", "kali uchis", "tv size", "greeeen")]
    for q in lrc_queries:
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
        blob = f"{c.get('trackName', '')} {c.get('artistName', '')}".lower()
        if any(rj in blob for rj in rejects):
            continue
        filtered.append(c)

    pool = filtered or [c for c in cands.values() if abs(float(c.get("duration") or 0) - real_dur) <= 15.0]
    if not pool:
        return None

    pool.sort(
        key=lambda c: (
            0 if WTS.search(c["syncedLyrics"]) else 1,
            abs(float(c.get("duration") or 0) - real_dur),
        )
    )
    best = pool[0]
    lines = build_full_lyrics(best["syncedLyrics"], real_dur)
    return {
        "synced": True,
        "source": f"lrclib:{best['id']}",
        "lines": lines,
        "plain": best.get("plainLyrics") or "",
        "lrc_dur": best.get("duration"),
        "lrc_track": best.get("trackName"),
        "lrc_artist": best.get("artistName"),
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


def upsert_and_merge_artist(catalog: dict, aid: str, spec: dict, it: dict, art_tpl: str, cols: list):
    artists = catalog["artists"]
    songs = catalog["songs"]
    canon_name = spec["canonical_artist_name"]
    merged = {}

    # Preserve ALL existing fields (especially heroVideo4k, heroVideo, heroImage, logo, appleId) when merging
    for old_id in [aid] + spec.get("merge_from_ids", []):
        if old_id in artists:
            old_obj = artists[old_id]
            for k, v in old_obj.items():
                if v is None or v == "" or v == []:
                    continue
                if k not in merged or (k == "fans" and (v or 0) > (merged.get("fans") or 0)):
                    merged[k] = v

    # Merge genres across existing entries + new song genre
    all_genres = list(merged.get("genres") or [])
    for old_id in [aid] + spec.get("merge_from_ids", []):
        if old_id in artists:
            for g in artists[old_id].get("genres") or []:
                if g not in all_genres:
                    all_genres.append(g)
    if spec["genre"] not in all_genres:
        all_genres.append(spec["genre"])

    # Remove old sva_* duplicate artist IDs and remap all their songs to canonical aid
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

    # Refresh Deezer image/fans if missing or fans == 0
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

    # Enrich with official Apple Music 4K/2K hero assets (only fill non-null fields, never wipe existing)
    hero = fetch_apple_artist_hero(str(merged.get("appleId") or aid))
    for hf in ("heroVideo4k", "heroVideo", "heroImage", "logo"):
        if hero.get(hf) and not merged.get(hf):
            merged[hf] = hero[hf]
        elif hero.get(hf) and hf in ("heroImage", "logo"):
            merged[hf] = hero[hf]

    artists[aid] = merged
    return merged


def main():
    catalog_path = PUB_DATA / "catalog.json"
    catalog = json.loads(catalog_path.read_text("utf-8"))
    songs = catalog["songs"]
    artists = catalog["artists"]

    for idx, spec in enumerate(TRACKS_TO_ADD, 1):
        tid = spec["trackId"]
        print(f"\n[{idx}/{len(TRACKS_TO_ADD)}] Processing {spec['canonical_artist_name']} ({tid})...")
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

        for old_id in spec.get("replaces", []):
            if old_id in songs:
                del songs[old_id]
                print(f"    Replaced old song entry {old_id} -> {tid}")

        lyr = fetch_synced_lyrics(spec["lrc_queries"], real_dur, spec.get("reject_title_terms"))
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

        ar_obj = upsert_and_merge_artist(catalog, a_id, spec, it, art_tpl, cols)
        size_kb = (PUB_AUDIO / spec["file"]).stat().st_size // 1024
        print(
            f"    OK! '{t_name}' - {a_name} | {real_dur:.1f}s ({size_kb} KB) | "
            f"lyrics={len(lyr['lines'])} lines ({lyr['source']}) | "
            f"heroVid={bool(ar_obj.get('heroVideo'))}, heroVid4k={bool(ar_obj.get('heroVideo4k'))}, heroImg={bool(ar_obj.get('heroImage'))}"
        )

    # Rebuild genre songIds cleanly
    for g in catalog["genres"]:
        g["songIds"] = [s["id"] for s in songs.values() if s["genre"] == g["id"]]

    catalog["generated"] = time.strftime("%Y-%m-%d %H:%M")
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), "utf-8")

    # Clean up temporary download folder
    for f in TMP_DIR.glob("*"):
        f.unlink(missing_ok=True)

    print(f"\nDONE! Total songs={len(songs)}, Total artists={len(artists)}")


if __name__ == "__main__":
    main()
