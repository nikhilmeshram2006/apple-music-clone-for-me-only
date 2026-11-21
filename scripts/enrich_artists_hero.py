"""
Enriches all artists in public/data/catalog.json with official Apple Music:
  - heroVideo: 16:9 widescreen (or 1:1 fallback) H.264 MP4 artist motion video
  - heroImage: high-res widescreen artist hero photograph (1600x900)
  - logo: official transparent Apple Music artist wordmark PNG (artistLogo)
  - bio: official artist editorial bio/notes when present
  - appleId: resolved numeric Apple Music artist ID
"""
import concurrent.futures
import json
import re
import threading
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "public" / "data" / "catalog.json"

_tls = threading.local()
_itunes_sem = threading.Semaphore(4)


def sess():
    if not hasattr(_tls, "s"):
        s = requests.Session()
        s.headers["User-Agent"] = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
        _tls.s = s
    return _tls.s


def resolve_apple_artist_id(aid: str, name: str):
    if not str(aid).startswith("sva_") and str(aid).isdigit():
        return str(aid)
    with _itunes_sem:
        for country in ("us", "in", "jp"):
            try:
                r = sess().get(
                    "https://itunes.apple.com/search",
                    params={"term": name, "entity": "musicArtist", "limit": 5, "country": country},
                    timeout=10,
                )
                if r.ok:
                    results = r.json().get("results", [])
                    norm = name.strip().lower()
                    exact = next((x for x in results if (x.get("artistName") or "").strip().lower() == norm), None)
                    pick = exact or (results[0] if results else None)
                    if pick and pick.get("artistId"):
                        return str(pick["artistId"])
            except Exception:
                pass
    return None


def extract_mp4_from_m3u8(m3u8_url: str):
    """Returns (is_wide_16x9, mp4_url) or (False, None)."""
    try:
        master = sess().get(m3u8_url, timeout=10).text
        # Find all avc1 (H.264) stream entries with resolution
        entries = re.findall(
            r'CODECS="avc1[^"]*"[^\n]*RESOLUTION=(\d+)x(\d+)[^\n]*\n(https://mvod\.itunes\.apple\.com[^\s]+\.m3u8)'
            r'|RESOLUTION=(\d+)x(\d+)[^\n]*CODECS="avc1[^"]*"[^\n]*\n(https://mvod\.itunes\.apple\.com[^\s]+\.m3u8)',
            master,
        )
        parsed = []
        for g in entries:
            if g[2]:
                w, h, u = int(g[0]), int(g[1]), g[2]
            else:
                w, h, u = int(g[3]), int(g[4]), g[5]
            parsed.append((w, h, u))
        if not parsed:
            # fallback any avc1 sub-playlist
            subs = re.findall(r'CODECS="avc1[^"]*"[^\n]*\n(https://mvod\.itunes\.apple\.com[^\s]+\.m3u8)', master)
            if not subs:
                return (False, None)
            chosen = subs[len(subs) // 2]
            is_wide = False
        else:
            # Check if widescreen (w > h)
            wide_list = [p for p in parsed if p[0] > p[1]]
            is_wide = bool(wide_list)
            pool = wide_list if wide_list else parsed
            # Prefer ~1024-1280 width (crisp HD without huge bandwidth)
            pool.sort(key=lambda p: abs(p[0] - 1280))
            chosen = pool[0][2]

        sub_txt = sess().get(chosen, timeout=10).text
        m = re.search(r'URI="([^"]+\.mp4)"', sub_txt)
        if m:
            base = chosen.rsplit("/", 1)[0]
            return (is_wide, f"{base}/{m.group(1)}")
    except Exception:
        pass
    return (False, None)


def fetch_apple_artist_hero(apple_id: str):
    out = {"heroVideo": None, "heroImage": None, "logo": None, "bio": None}
    txt = ""
    for region in ("us", "in", "jp"):
        try:
            r = sess().get(f"https://music.apple.com/{region}/artist/{apple_id}", timeout=12)
            if r.ok and len(r.text) > 50000:
                txt = r.text
                break
        except Exception:
            pass
    if not txt:
        return out

    dec = json.JSONDecoder()

    # 1. Official Apple Music Artist Logo (transparent PNG wordmark)
    idx_logo = txt.find('"artistLogo":')
    if idx_logo != -1:
        try:
            obj, _ = dec.raw_decode(txt, idx_logo + len('"artistLogo":'))
            u = (obj.get("dictionary") or {}).get("url")
            if u and "{w}" in u:
                out["logo"] = (
                    u.replace("{w}", "900").replace("{h}", "340").replace("{c}", "bb").replace("{f}", "png")
                )
        except Exception:
            pass

    # 2. Official Apple Music Artist Hero Motion Video (prefer 16:9 widescreen)
    mvod_urls = list(dict.fromkeys(re.findall(r"https://mvod\.itunes\.apple\.com[^\s\"'<>\\]+\.m3u8", txt)))
    best_square = None
    for mu in mvod_urls[:4]:
        is_wide, mp4 = extract_mp4_from_m3u8(mu)
        if mp4:
            if is_wide:
                out["heroVideo"] = mp4
                break
            elif not best_square:
                best_square = mp4
    if not out["heroVideo"] and best_square:
        out["heroVideo"] = best_square

    # 3. Official Apple Music High-Res Widescreen Artist Hero Photo
    amc = re.findall(r"https://is1-ssl\.mzstatic\.com/image/thumb/AMCArtistImages[^\s\"'<>\\]+", txt)
    if amc:
        raw = amc[0]
        if "{w}" in raw:
            out["heroImage"] = raw.replace("{w}", "1600").replace("{h}", "900").replace("{c}", "cc").replace("{f}", "jpg")
        else:
            out["heroImage"] = re.sub(r"/\d+x\d+[a-z]+\.(jpg|png|webp)$", "/1600x900cc.jpg", raw)
    else:
        # Try video previewFrame as high-res wide poster
        pf = re.findall(r"https://is1-ssl\.mzstatic\.com/image/thumb/Video[^\s\"'<>\\]+PreviewImage[^\s\"'<>\\]+", txt)
        if pf:
            raw = pf[0]
            if "{w}" in raw:
                out["heroImage"] = raw.replace("{w}", "1600").replace("{h}", "900").replace("{c}", "cc").replace("{f}", "jpg")
            else:
                out["heroImage"] = re.sub(r"/\d+x\d+[a-z]+\.(jpg|png|webp)$", "/1600x900cc.jpg", raw)

    # 4. Editorial Bio / Description
    m_bio = re.search(r'"editorialNotes":\{"standard":"((?:[^"\\]|\\.)+)"', txt)
    if not m_bio:
        m_bio = re.search(r'"artistBio":"((?:[^"\\]|\\.)+)"', txt)
    if m_bio:
        try:
            bio_txt = json.loads('"' + m_bio.group(1) + '"')
            bio_txt = re.sub(r"<[^>]+>", "", bio_txt).strip()
            if len(bio_txt) > 30:
                out["bio"] = bio_txt[:600]
        except Exception:
            pass

    return out


def process_artist(item):
    aid, a = item
    name = a.get("name", "")
    apple_id = a.get("appleId") or resolve_apple_artist_id(aid, name)
    if not apple_id:
        return (aid, None, {})
    hero = fetch_apple_artist_hero(apple_id)
    return (aid, apple_id, hero)


def main():
    t0 = time.time()
    catalog = json.loads(CATALOG_PATH.read_text("utf-8"))
    artists = catalog["artists"]
    print(f"Enriching {len(artists)} artists with official Apple Music videos, banners, and wordmark logos...")

    n_vid = n_logo = n_img = n_bio = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for i, (aid, apple_id, hero) in enumerate(ex.map(process_artist, artists.items()), 1):
            a = artists[aid]
            if apple_id:
                a["appleId"] = apple_id
            if hero.get("heroVideo"):
                a["heroVideo"] = hero["heroVideo"]
                n_vid += 1
            if hero.get("heroImage"):
                a["heroImage"] = hero["heroImage"]
                n_img += 1
            if hero.get("logo"):
                a["logo"] = hero["logo"]
                n_logo += 1
            if hero.get("bio"):
                a["bio"] = hero["bio"]
                n_bio += 1
            if i % 20 == 0 or i == len(artists):
                print(
                    f"  [{i:03d}/{len(artists)}] videos={n_vid} | logos={n_logo} | heroImages={n_img} | bios={n_bio}"
                )

    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(
        f"\nDONE in {time.time() - t0:.1f}s! videos={n_vid}, official_logos={n_logo}, heroImages={n_img}, bios={n_bio}"
    )


if __name__ == "__main__":
    main()
