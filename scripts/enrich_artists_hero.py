"""
Enriches all artists in public/data/catalog.json with highest-quality (2K / 4K) official Apple Music assets:
  - heroVideo4k: 4K (3840x2160) or 2K (2560x1440) widescreen HEVC (hvc1) MP4 artist hero motion video
  - heroVideo: highest-bitrate 1080p (1920x1080) H.264 (avc1) MP4 universal fallback
  - heroImage: official 4K (3840x2160) Apple Music artist hero photograph (AMCArtistImages / circleArtwork / previewFrame)
  - logo: official 2K (1800x680) transparent Apple Music artist wordmark PNG (artistLogo)
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
        for country in ("us", "in", "jp", "kr", "fr", "ph"):
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


def resolve_sub_mp4(sub_url: str):
    try:
        sub_txt = sess().get(sub_url, timeout=10).text
        m = re.search(r'URI="([^"]+\.mp4)"', sub_txt)
        if m:
            base = sub_url.rsplit("/", 1)[0]
            return f"{base}/{m.group(1)}"
    except Exception:
        pass
    return None


def extract_best_mp4s_from_m3u8(m3u8_url: str):
    """Returns (is_wide_16x9, mp4_4k_hevc, mp4_hd_avc1)."""
    try:
        master = sess().get(m3u8_url, timeout=10).text
        lines = master.splitlines()
        avc_streams = []
        hevc_streams = []

        for idx, line in enumerate(lines):
            if not line.startswith("#EXT-X-STREAM-INF:"):
                continue
            if idx + 1 >= len(lines):
                continue
            uri = lines[idx + 1].strip()
            if not uri.startswith("https://"):
                continue
            m_res = re.search(r"RESOLUTION=(\d+)x(\d+)", line)
            m_bw = re.search(r"BANDWIDTH=(\d+)", line)
            m_cod = re.search(r'CODECS="([^"]+)"', line)
            if not m_res or not m_cod:
                continue
            w, h = int(m_res.group(1)), int(m_res.group(2))
            bw = int(m_bw.group(1)) if m_bw else 0
            cod = m_cod.group(1)
            entry = (w, h, bw, uri)
            if cod.startswith("avc1"):
                avc_streams.append(entry)
            elif cod.startswith("hvc1") or cod.startswith("hev1"):
                hevc_streams.append(entry)

        if not avc_streams and not hevc_streams:
            return (False, None, None)

        all_streams = avc_streams + hevc_streams
        is_wide = any(w > h for w, h, _, _ in all_streams)

        # Pick highest-quality H.264 (avc1) universal fallback (prefer 1920x1080 highest bitrate)
        mp4_avc = None
        if avc_streams:
            pool = [s for s in avc_streams if s[0] > s[1]] if is_wide else avc_streams
            if not pool:
                pool = avc_streams
            pool.sort(key=lambda s: (s[0] * s[1], s[2]), reverse=True)
            mp4_avc = resolve_sub_mp4(pool[0][3])

        # Pick highest-quality 4K (3840x2160) or 2K (2560x1440) HEVC stream
        mp4_4k = None
        if hevc_streams:
            pool = [s for s in hevc_streams if s[0] > s[1]] if is_wide else hevc_streams
            if not pool:
                pool = hevc_streams
            # Prefer >= 2560px width (2K or 4K), highest resolution then crisp high bitrate (<= 15 Mbps for smooth web playback)
            uhd = [s for s in pool if s[0] >= 2560]
            if uhd:
                uhd.sort(key=lambda s: (s[0] * s[1], -abs(s[2] - 12_000_000)), reverse=True)
                mp4_4k = resolve_sub_mp4(uhd[0][3])

        return (is_wide, mp4_4k, mp4_avc)
    except Exception:
        return (False, None, None)


def to_4k_mzstatic(raw: str):
    if "{w}" in raw:
        return raw.replace("{w}", "3840").replace("{h}", "2160").replace("{c}", "cc").replace("{f}", "jpg")
    return re.sub(r"/\d+x\d+[a-z]+\.(jpg|png|webp)$", "/3840x2160cc.jpg", raw)


def fetch_apple_artist_hero(apple_id: str):
    out = {"heroVideo4k": None, "heroVideo": None, "heroImage": None, "logo": None}
    txt = ""
    for region in ("us", "in", "jp", "kr", "fr", "ph"):
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

    # 1. Official 2K Transparent Apple Music Artist Logo (artistLogo)
    idx_logo = txt.find('"artistLogo":')
    if idx_logo != -1:
        try:
            obj, _ = dec.raw_decode(txt, idx_logo + len('"artistLogo":'))
            u = (obj.get("dictionary") or {}).get("url")
            if u and "{w}" in u:
                out["logo"] = (
                    u.replace("{w}", "1800").replace("{h}", "680").replace("{c}", "bb").replace("{f}", "png")
                )
        except Exception:
            pass

    # 2. Official 4K/2K + 1080p Apple Music Artist Hero Motion Video (prefer 16:9 widescreen)
    mvod_urls = list(dict.fromkeys(re.findall(r"https://mvod\.itunes\.apple\.com[^\s\"'<>\\]+\.m3u8", txt)))
    best_sq = (None, None)
    for mu in mvod_urls[:4]:
        is_wide, mp4_4k, mp4_avc = extract_best_mp4s_from_m3u8(mu)
        if mp4_avc or mp4_4k:
            if is_wide:
                out["heroVideo4k"] = mp4_4k
                out["heroVideo"] = mp4_avc or mp4_4k
                break
            elif not best_sq[1]:
                best_sq = (mp4_4k, mp4_avc or mp4_4k)
    if not out["heroVideo"] and best_sq[1]:
        out["heroVideo4k"] = best_sq[0]
        out["heroVideo"] = best_sq[1]

    # 3. Official 4K (3840x2160) Apple Music Artist Photograph
    amc = re.findall(r"https://is1-ssl\.mzstatic\.com/image/thumb/AMCArtistImages[^\s\"'<>\\]+", txt)
    if amc:
        out["heroImage"] = to_4k_mzstatic(amc[0])
    else:
        idx_circ = txt.find('"circleArtwork":')
        if idx_circ != -1:
            try:
                obj, _ = dec.raw_decode(txt, idx_circ + len('"circleArtwork":'))
                u = (obj.get("dictionary") or {}).get("url")
                if u:
                    out["heroImage"] = to_4k_mzstatic(u)
            except Exception:
                pass
    if not out["heroImage"]:
        pf = re.findall(r"https://is1-ssl\.mzstatic\.com/image/thumb/Video[^\s\"'<>\\]+PreviewImage[^\s\"'<>\\]+", txt)
        if pf:
            out["heroImage"] = to_4k_mzstatic(pf[0])

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
    print(f"Upgrading {len(artists)} artists to 4K/2K official Apple Music hero videos, photos, and logos...")

    n_4k_vid = n_hd_vid = n_logo = n_4k_img = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for i, (aid, apple_id, hero) in enumerate(ex.map(process_artist, artists.items()), 1):
            a = artists[aid]
            if apple_id:
                a["appleId"] = apple_id
            if hero.get("heroVideo4k"):
                a["heroVideo4k"] = hero["heroVideo4k"]
                n_4k_vid += 1
            if hero.get("heroVideo"):
                a["heroVideo"] = hero["heroVideo"]
                n_hd_vid += 1
            if hero.get("heroImage"):
                a["heroImage"] = hero["heroImage"]
                n_4k_img += 1
            if hero.get("logo"):
                a["logo"] = hero["logo"]
                n_logo += 1
            if i % 20 == 0 or i == len(artists):
                print(
                    f"  [{i:03d}/{len(artists)}] 4K/2K_videos={n_4k_vid} | 1080p_videos={n_hd_vid} | 4K_official_imgs={n_4k_img} | 2K_logos={n_logo}"
                )

    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(
        f"\nDONE in {time.time() - t0:.1f}s! 4K/2K_videos={n_4k_vid}, 1080p_videos={n_hd_vid}, 4K_official_imgs={n_4k_img}, 2K_logos={n_logo}"
    )


if __name__ == "__main__":
    main()
