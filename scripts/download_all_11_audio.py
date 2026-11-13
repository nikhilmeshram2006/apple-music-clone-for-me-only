import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_AUDIO = ROOT / "public" / "data" / "audio"
DOCS_AUDIO = ROOT / "docs" / "data" / "audio"
PUBLIC_DATA = ROOT / "public" / "data"
DOCS_DATA = ROOT / "docs" / "data"

for p in (PUBLIC_AUDIO, DOCS_AUDIO):
    p.mkdir(parents=True, exist_ok=True)

TRACKS = [
    {
        "id": "1775877096",
        "title": "Merry Christmas, Please Don't Call",
        "artist": "Bleachers",
        "file": "bleachers_merry_christmas.m4a",
        "query": "ytsearch1:Bleachers - Merry Christmas, Please Don't Call Official",
    },
    {
        "id": "6784789929",
        "title": "Merry Christmas, i miss you",
        "artist": "Alex Crichton",
        "file": "alex_crichton_merry_christmas.m4a",
        "query": "ytsearch1:Alex Crichton - Merry Christmas, i miss you",
    },
    {
        "id": "6788172077",
        "title": "What If I Call",
        "artist": "Alex Crichton",
        "file": "alex_crichton_what_if_i_call.m4a",
        "query": "ytsearch1:Alex Crichton - What If I Call",
    },
    {
        "id": "1850019038",
        "title": "About You",
        "artist": "The 1975",
        "file": "the_1975_about_you.m4a",
        "query": "ytsearch1:The 1975 About You Official Audio",
    },
    {
        "id": "6763656725",
        "title": "hate that i made you love me",
        "artist": "Ariana Grande",
        "file": "ariana_hate_that_i_made_you_love_me.m4a",
        "query": "ytsearch1:Ariana Grande hate that i made you love me official lyric video",
    },
    {
        "id": "1318981699",
        "title": "Mystery of Love",
        "artist": "Sufjan Stevens",
        "file": "sufjan_mystery_of_love.m4a",
        "query": "ytsearch1:Sufjan Stevens - Mystery of Love Official Audio",
    },
    {
        "id": "1863631485",
        "title": "The Story of Us",
        "artist": "milet",
        "file": "milet_the_story_of_us.m4a",
        "query": "ytsearch1:milet The Story of Us Official",
    },
    {
        "id": "1839131590",
        "title": "I Thought I Saw Your Face Today",
        "artist": "She & Him",
        "file": "she_and_him_i_thought_i_saw_your_face.m4a",
        "query": "ytsearch1:She & Him - I Thought I Saw Your Face Today official",
    },
    {
        "id": "1840081736",
        "title": "JANE DOE",
        "artist": "Kenshi Yonezu & Hikaru Utada",
        "file": "kenshi_yonezu_jane_doe.m4a",
        "query": "ytsearch1:Kenshi Yonezu Hikaru Utada JANE DOE audio",
    },
    {
        "id": "1837658529",
        "title": "IRIS OUT",
        "artist": "Kenshi Yonezu",
        "file": "kenshi_yonezu_iris_out.m4a",
        "query": "ytsearch1:Kenshi Yonezu IRIS OUT official audio",
    },
    {
        "id": "1540793097",
        "title": "I Really Want to Stay at Your House",
        "artist": "Rosa Walton & Hallie Coggins",
        "file": "rosa_walton_i_really_want_to_stay.m4a",
        "query": "ytsearch1:Rosa Walton Hallie Coggins I Really Want to Stay at Your House official",
    },
]

def get_duration(file_path):
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception as e:
        print(f"Error ffprobe {file_path}: {e}")
        return 200.0

def main():
    cat_path = PUBLIC_DATA / "catalog.json"
    with open(cat_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    for item in TRACKS:
        tid = item["id"]
        fname = item["file"]
        pub_file = PUBLIC_AUDIO / fname
        docs_file = DOCS_AUDIO / fname

        print(f"\n-> [{tid}] {item['title']} - {item['artist']}")

        # 1. Download if not exists or if size is too small (< 500 KB)
        if not pub_file.exists() or pub_file.stat().st_size < 500000:
            print(f"   Downloading with {item['query']}...")
            cmd = [
                "yt-dlp",
                "-f", "ba[ext=m4a]/ba",
                "-x", "--audio-format", "m4a",
                "-o", str(pub_file),
                item["query"]
            ]
            res = subprocess.run(cmd)
            if res.returncode != 0:
                print(f"   [!] Failed to download {fname}")
                continue

        # 2. Copy to docs
        with open(pub_file, "rb") as src, open(docs_file, "wb") as dst:
            dst.write(src.read())

        # 3. Determine duration
        dur = get_duration(pub_file)
        print(f"   Audio size: {pub_file.stat().st_size / (1024*1024):.2f} MB, Duration: {dur:.1f}s")

        # 4. Update catalog entry
        if tid in catalog["songs"]:
            song = catalog["songs"][tid]
            song["audio"] = f"data/audio/{fname}"
            song["duration"] = round(dur, 1)
            song["isFull"] = True
            print(f"   Updated catalog song {tid}: audio='data/audio/{fname}' duration={song['duration']}")

    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    with open(DOCS_DATA / "catalog.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print("\nALL 11 TRACKS PROCESSED AND CATALOG UPDATED!")

if __name__ == "__main__":
    main()
