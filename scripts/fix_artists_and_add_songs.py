"""
1. Deduplicates all duplicate artists in catalog.json (The Weeknd, Shakira, Coldplay,
   YOASOBI, LiSA, King Gnu, RADWIMPS, IVE, Édith Piaf, Arijit Singh, Kenshi Yonezu,
   Fujii Kaze, Videoclub, etc.) and remaps song.artistId to canonical IDs.
2. Adds/upgrades all 11 requested individual songs + all 9 tracks from the Tamil album
   "Dude (Original Motion Picture Soundtrack)" by Sai Abhyankkar in full length using
   yt-dlp + ffmpeg (-c:a aac -b:a 48k -ar 32000 -movflags +faststart), with synced
   word-by-word lyrics and high-res artwork.
"""
import json
import re
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from build_catalog import (  # noqa: E402
    build_full_lyrics,
    clean,
    fetch_best_lyrics,
    find_animated_cover,
    fold,
    palette_from_url,
    sess,
)
from rapidfuzz import fuzz  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PUB_DATA = ROOT / "public" / "data"
DOCS_DATA = ROOT / "docs" / "data"
PUB_AUDIO = PUB_DATA / "audio"
DOCS_AUDIO = DOCS_DATA / "audio"
PUB_LYR = PUB_DATA / "lyrics"
DOCS_LYR = DOCS_DATA / "lyrics"
TMP_DIR = ROOT / "scripts" / ".tmp_audio"

for d in (PUB_AUDIO, DOCS_AUDIO, PUB_LYR, DOCS_LYR, TMP_DIR):
    d.mkdir(parents=True, exist_ok=True)


TRACKS_TO_ADD = [
    # 1. "multo" by cup of joe
    {
        "trackId": "1766905828",
        "country": "ph",
        "genre": "pop",
        "lang": "tl",
        "file": "cup_of_joe_multo.m4a",
        "yt_query": "Cup of Joe Multo Official Audio",
        "aliases": "multo cup of joe",
    },
    # 2. "pasilyo" by sunkissed lola
    {
        "trackId": "1650172320",
        "country": "ph",
        "genre": "romance",
        "lang": "tl",
        "file": "sunkissed_lola_pasilyo.m4a",
        "yt_query": "SunKissed Lola Pasilyo Official Audio",
        "aliases": "pasilyo sunkissed lola",
    },
    # 3. "her" by JVKE
    {
        "trackId": "1764940884",
        "country": "us",
        "genre": "romance",
        "lang": "en",
        "file": "jvke_her.m4a",
        "yt_query": "JVKE her Official Audio",
        "aliases": "her jvke",
    },
    # 4. "idol" by yoasobi
    {
        "trackId": "1679278167",
        "country": "us",
        "genre": "jpop",
        "lang": "ja",
        "file": "yoasobi_idol.m4a",
        "yt_query": "YOASOBI Idol アイドル Official Audio",
        "aliases": "idol yoasobi アイドル oshi no ko",
    },
    # 5. "shinunoga E-Wa" by fuji kaze
    {
        "trackId": "1505498792",
        "country": "us",
        "genre": "jpop",
        "lang": "ja",
        "file": "fujii_kaze_shinunoga_e_wa.m4a",
        "yt_query": "Fujii Kaze Shinunoga E-Wa Official Audio",
        "aliases": "shinunoga e-wa shinunoga e wa fuji kaze fujii kaze 死ぬのがいいわ",
        "replaces": ["sv_ZpAyQnuu"],
    },
    # 6. "we don't talk anymore" by charlie puth
    {
        "trackId": "1031416185",
        "country": "us",
        "genre": "pop",
        "lang": "en",
        "file": "charlie_puth_we_dont_talk_anymore.m4a",
        "yt_query": "Charlie Puth We Dont Talk Anymore feat Selena Gomez Official Audio",
        "aliases": "we dont talk anymore we don't talk anymore charlie puth selena gomez",
    },
    # 7. "blue" by yung kai
    {
        "trackId": "1776246888",
        "country": "us",
        "genre": "romance",
        "lang": "en",
        "file": "yung_kai_blue.m4a",
        "yt_query": "yung kai blue Official Audio",
        "aliases": "blue yung kai",
    },
    # 8. "people" by libianca
    {
        "trackId": "1658390607",
        "country": "us",
        "genre": "rnb",
        "lang": "en",
        "file": "libianca_people.m4a",
        "yt_query": "Libianca People Official Audio",
        "aliases": "people libianca",
    },
    # 9. "roi" by videoclub
    {
        "trackId": "1543895860",
        "country": "fr",
        "genre": "french",
        "lang": "fr",
        "file": "videoclub_roi.m4a",
        "yt_query": "VIDEOCLUB Roi Official Audio",
        "aliases": "roi videoclub adele castillon mattyeux",
    },
    # 10. "lavender" by azooz
    {
        "trackId": "1628088648",
        "country": "in",
        "genre": "pop",
        "lang": "hi",
        "file": "azooz_lavender.m4a",
        "yt_query": "Azooz Lavender Official Audio",
        "aliases": "lavender azooz sangeetkir pinnocio",
        "artist_override": "Azooz",
    },
    # 11. "quiet room" by choi in hee and hye joo
    {
        "trackId": "1866523535",
        "country": "us",
        "genre": "kpop",
        "lang": "ko",
        "file": "choi_in_hee_quiet_room.m4a",
        "yt_query": "Quiet Room CHOI IN HEE Oh Hye Joo",
        "aliases": "quiet room choi in hee and hye joo oh hye joo",
        "artist_override": "Choi In Hee & Hye Joo",
    },
    # 12-20. "Dude" movie full album songs in Tamil audio by Sai Abhyankkar
    {
        "trackId": "1848715394",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_oorum_blood.m4a",
        "yt_query": "Oorum Blood Dude Sai Abhyankkar Tamil Audio",
        "aliases": "dude movie tamil album sai abhyankkar oorum blood pradeep ranganathan",
    },
    {
        "trackId": "1848715399",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_singari.m4a",
        "yt_query": "Singari Dude Sai Abhyankkar Pradeep Ranganathan Tamil Audio",
        "aliases": "dude movie tamil album sai abhyankkar singari pradeep ranganathan",
    },
    {
        "trackId": "1848715400",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_nallaru_po.m4a",
        "yt_query": "Nallaru Po Dude Sai Abhyankkar Tippu Tamil Audio",
        "aliases": "dude movie tamil album sai abhyankkar nallaru po tippu",
    },
    {
        "trackId": "1848715404",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_kannukulla.m4a",
        "yt_query": "Kannukulla Dude Sai Abhyankkar Jonita Gandhi Tamil Audio",
        "aliases": "dude movie tamil album sai abhyankkar kannukulla jonita gandhi",
    },
    {
        "trackId": "1848715405",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_yumabaibesa.m4a",
        "yt_query": "Yumabaibesa Dude Sai Abhyankkar Audio",
        "aliases": "dude movie tamil album sai abhyankkar yumabaibesa",
    },
    {
        "trackId": "1848715406",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_kannukulla_reprise.m4a",
        "yt_query": "Kannukulla Reprise Dude Sai Abhyankkar Audio",
        "aliases": "dude movie tamil album sai abhyankkar kannukulla reprise",
    },
    {
        "trackId": "1848715407",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_trailer_blast.m4a",
        "yt_query": "Dude Trailer Blast Theme Sai Abhyankkar Audio",
        "aliases": "dude movie tamil album sai abhyankkar dude trailer blast theme",
    },
    {
        "trackId": "1848715408",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_blud_is_on_his_way.m4a",
        "yt_query": "Blud Is On His Way Dude Sai Abhyankkar Audio",
        "aliases": "dude movie tamil album sai abhyankkar blud is on his way",
    },
    {
        "trackId": "1848715409",
        "country": "in",
        "genre": "bollywood",
        "lang": "ta",
        "file": "dude_oorum_blood_unplugged.m4a",
        "yt_query": "Oorum Blood Unplugged Dude Sai Abhyankkar Audio",
        "aliases": "dude movie tamil album sai abhyankkar oorum blood unplugged",
    },
]


def lookup_itunes_track(track_id, country="us"):
    for c in (country, "us", "in", "ph", "jp", "fr", "gb"):
        try:
            r = sess().get(
                "https://itunes.apple.com/lookup",
                params={"id": track_id, "country": c},
                timeout=12,
            )
            if r.ok:
                results = r.json().get("results", [])
                for item in results:
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


def download_and_compress_audio(yt_query: str, target_dur: float, out_filename: str) -> float:
    pub_dest = PUB_AUDIO / out_filename
    docs_dest = DOCS_AUDIO / out_filename

    # Check if already downloaded and valid full length
    if pub_dest.exists() and pub_dest.stat().st_size > 150_000:
        existing_dur = probe_duration(pub_dest)
        if existing_dur >= max(60.0, target_dur - 25.0):
            shutil.copy2(pub_dest, docs_dest)
            return existing_dur

    min_d = max(55, int(target_dur - 30))
    max_d = max(min_d + 60, int(target_dur + 45))

    raw_tmpl = str(TMP_DIR / f"{out_filename}.%(ext)s")
    for f in TMP_DIR.glob(f"{out_filename}.*"):
        f.unlink(missing_ok=True)

    # First try strict duration match across top 5 YT results
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "-f",
        "bestaudio[ext=m4a]/bestaudio",
        "--match-filter",
        f"duration >= {min_d} & duration <= {max_d}",
        "--max-downloads",
        "1",
        "-o",
        raw_tmpl,
        f"ytsearch5:{yt_query}",
    ]
    subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    downloaded = list(TMP_DIR.glob(f"{out_filename}.*"))
    if not downloaded:
        # Fallback to wider duration filter
        cmd_fb = [
            "yt-dlp",
            "--no-playlist",
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "--match-filter",
            "duration >= 60 & duration <= 420",
            "--max-downloads",
            "1",
            "-o",
            raw_tmpl,
            f"ytsearch5:{yt_query}",
        ]
        subprocess.run(cmd_fb, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        downloaded = list(TMP_DIR.glob(f"{out_filename}.*"))

    if not downloaded:
        raise RuntimeError(f"Failed to download audio for: {yt_query}")

    raw_file = downloaded[0]
    # Compress to 48kbps 32kHz AAC M4A with faststart for instant streaming and small git size
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

    shutil.copy2(pub_dest, docs_dest)
    dur = probe_duration(pub_dest)
    return dur


def fetch_deezer_artist(name: str):
    try:
        r = sess().get("https://api.deezer.com/search/artist", params={"q": name, "limit": 5}, timeout=10)
        if not r.ok:
            return None
        best = None
        for a in r.json().get("data", []):
            if fuzz.ratio(fold(clean(name)), fold(clean(a.get("name", "")))) >= 72:
                if best is None or a.get("nb_fan", 0) > best.get("nb_fan", 0):
                    best = a
        return best
    except Exception:
        return None


def deduplicate_artists(catalog: dict):
    artists = catalog["artists"]
    songs = catalog["songs"]

    # Fix Kenshi Yonezu's artist entry 530814268 which had collab name "Kenshi Yonezu & Hikaru Utada"
    if "530814268" in artists:
        artists["530814268"]["name"] = "Kenshi Yonezu"

    # Refresh synthetic 1,000,000 fan counts with real Deezer fan counts
    for aid, a in list(artists.items()):
        if a.get("fans") == 1000000 or (a.get("fans", 0) == 0 and a.get("name") == "Arijit Singh"):
            dz = fetch_deezer_artist(a["name"].split("&")[0].strip())
            if dz:
                a["fans"] = dz.get("nb_fan", 0)
                if dz.get("picture_xl"):
                    a["image"] = dz["picture_xl"]
            else:
                a["fans"] = 25000

    # Group artists by case-insensitive normalized name
    groups = defaultdict(list)
    for aid, a in artists.items():
        norm_name = fold(a["name"].strip().lower())
        groups[norm_name].append(aid)

    remap = {}
    for norm_name, aids in groups.items():
        if len(aids) <= 1:
            continue
        # Sort so numeric iTunes IDs come before sva_ IDs, then highest fans
        aids_sorted = sorted(
            aids,
            key=lambda x: (
                0 if not str(x).startswith("sva_") else 1,
                -(artists[x].get("fans") or 0),
            ),
        )
        canonical_id = aids_sorted[0]
        canonical = artists[canonical_id]

        # Merge metadata from duplicates into canonical
        all_genres = list(canonical.get("genres") or [])
        max_fans = canonical.get("fans") or 0
        best_img = canonical.get("image") or ""

        for dup_id in aids_sorted[1:]:
            dup = artists[dup_id]
            for g in dup.get("genres") or []:
                if g not in all_genres:
                    all_genres.append(g)
            if (dup.get("fans") or 0) > max_fans:
                max_fans = dup["fans"]
            if (not best_img or "mzstatic.com" in best_img) and dup.get("image") and "dzcdn.net" in dup["image"]:
                best_img = dup["image"]
            elif not best_img and dup.get("image"):
                best_img = dup["image"]
            remap[dup_id] = canonical_id
            del artists[dup_id]

        canonical["genres"] = all_genres
        canonical["fans"] = max_fans
        if best_img:
            canonical["image"] = best_img
        print(f"Merged artist '{canonical['name']}': kept {canonical_id}, merged {aids_sorted[1:]}")

    # Remap song.artistId across all songs
    remapped_songs = 0
    for s in songs.values():
        if s["artistId"] in remap:
            s["artistId"] = remap[s["artistId"]]
            remapped_songs += 1
        # Also if artist name matches a canonical artist directly, link it
        s_norm = fold(s["artist"].strip().lower())
        if s_norm in groups:
            canon = groups[s_norm][0] if groups[s_norm][0] in artists else remap.get(groups[s_norm][0])
            if canon and canon in artists and s["artistId"] != canon:
                s["artistId"] = canon
                remapped_songs += 1

    print(f"Remapped {remapped_songs} songs to canonical artist IDs. Total artists now: {len(artists)}")


def main():
    catalog_path = PUB_DATA / "catalog.json"
    catalog = json.loads(catalog_path.read_text("utf-8"))
    songs = catalog["songs"]
    artists = catalog["artists"]

    # Remove duplicate IRIS OUT (sv_0ombBj8v) since 1837658529 has local audio + Apple Music art
    if "sv_0ombBj8v" in songs and "1837658529" in songs:
        del songs["sv_0ombBj8v"]
        print("Removed duplicate IRIS OUT (sv_0ombBj8v)")

    for idx, spec in enumerate(TRACKS_TO_ADD, 1):
        tid = spec["trackId"]
        it = lookup_itunes_track(tid, spec["country"])
        if not it:
            raise RuntimeError(f"Could not find iTunes track {tid}")

        t_name = it["trackName"]
        a_name = spec.get("artist_override") or it["artistName"]
        a_id = str(it["artistId"])
        alb_name = it.get("collectionName", "")
        alb_id = str(it.get("collectionId", ""))
        art_tpl = re.sub(r"/\d+x\d+bb\.(jpg|png)$", "/{s}x{s}bb.jpg", it["artworkUrl100"])
        preview_url = it.get("previewUrl", "")
        it_dur = (it.get("trackTimeMillis") or 200000) / 1000.0
        explicit = it.get("trackExplicitness") == "explicit"
        year = (it.get("releaseDate") or "2024")[:4]
        apple_url = it.get("trackViewUrl", "")
        video_art = find_animated_cover(it.get("collectionViewUrl"))

        print(f"[{idx:02d}/{len(TRACKS_TO_ADD)}] Downloading & encoding: {a_name} - {t_name} (target ~{it_dur:.1f}s)...")
        real_dur = download_and_compress_audio(spec["yt_query"], it_dur, spec["file"])
        audio_rel = f"data/audio/{spec['file']}"

        # Remove any old JioSaavn IDs this track replaces
        for old_id in spec.get("replaces", []):
            if old_id in songs:
                del songs[old_id]
                print(f"  -> Replaced old entry {old_id} with {tid}")

        # Fetch synced word-by-word lyrics
        lyr = fetch_best_lyrics(it, a_name.split("&")[0].split(",")[0].strip(), t_name, real_dur, spec["yt_query"])
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
            lyr_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            (PUB_LYR / f"{tid}.json").write_text(lyr_json, "utf-8")
            (DOCS_LYR / f"{tid}.json").write_text(lyr_json, "utf-8")

        cols = palette_from_url(art_tpl.replace("{s}", "150")) if art_tpl else ["#fa2d48", "#5e5ce6", "#1c1c1e"]
        song_entry = {
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
            "lyrics": lyr_state,
            "offset": 0,
            "aliases": spec.get("aliases", ""),
        }
        songs[tid] = song_entry

        # Ensure artist exists in catalog["artists"]
        if a_id not in artists:
            primary_artist_name = a_name.split(",")[0].split("&")[0].strip() if "Dude" in alb_name else a_name
            dz = fetch_deezer_artist(primary_artist_name)
            img = dz.get("picture_xl") if dz and dz.get("picture_xl") else art_tpl.replace("{s}", "1000")
            fans = dz.get("nb_fan", 0) if dz else 50000
            artists[a_id] = {
                "id": a_id,
                "name": "Sai Abhyankkar" if "Dude" in alb_name else a_name,
                "genre": it.get("primaryGenreName") or spec["genre"].title(),
                "image": img,
                "fans": fans,
                "colors": cols,
                "genres": [spec["genre"]],
                "appleUrl": apple_url,
            }
        else:
            if spec["genre"] not in (artists[a_id].get("genres") or []):
                artists[a_id].setdefault("genres", []).append(spec["genre"])

        size_kb = (PUB_AUDIO / spec["file"]).stat().st_size // 1024
        print(f"  -> OK! {spec['file']} ({real_dur:.1f}s, {size_kb} KB) | lyrics={lyr_state}")

    # Deduplicate all artists & remap song artistIds
    deduplicate_artists(catalog)

    # Rebuild genre songIds lists
    for g in catalog["genres"]:
        g["songIds"] = [s["id"] for s in songs.values() if s["genre"] == g["id"]]

    catalog["generated"] = time.strftime("%Y-%m-%d %H:%M")
    out_text = json.dumps(catalog, ensure_ascii=False, indent=1)
    (PUB_DATA / "catalog.json").write_text(out_text, "utf-8")
    (DOCS_DATA / "catalog.json").write_text(out_text, "utf-8")
    print("\nSuccessfully updated public/data/catalog.json and docs/data/catalog.json!")


if __name__ == "__main__":
    main()
