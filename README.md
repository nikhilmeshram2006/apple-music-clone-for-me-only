<p align="center">
  <img src="public/logo.jpg" width="84" alt="Music" />
</p>

<h1 align="center">apple music</h1>

<p align="center">
  Web client for streaming 337 full-length songs with word-synchronized lyrics, motion album artwork, and 4K artist profiles.
  <br />
  <a href="https://applemusic.antideploy.app/">Live App</a>
  &nbsp;·&nbsp;
  <a href="https://nikhilmeshram2006.github.io/apple-music-clone-for-me-only/">GitHub Pages Mirror</a>
</p>

---

## Overview

A personal web player modeled after Apple Music. Built with React and Vite, backed by a Python catalog pipeline that pairs full-length AAC streams and bundled local `.m4a` audio with time-aligned Apple Music Sing lyrics from LRCLIB, looping motion album covers, and 4K artist hero pages.

### Features

- **Audio** — **337 full-length tracks** (including 44 bundled local AAC `.m4a` tracks and 320 kbps AAC streams) with MediaSession API support and keyboard shortcuts.
- **Apple Music Sing Lyrics** — **236 synced-lyric tracks** featuring luminous word-by-word and per-letter fill, syllable weighting across Latin, CJK, Hangul, and Devanagari scripts, and click-to-seek lines.
- **Cinematic Visuals** — Canvas fluid mesh backgrounds sampled from cover art, **27 looping motion album covers**, and full-bleed artist profiles across **151 curated artists** (**62** 4K/2K hero motion videos, **149** 4K artist photos, and **61** 2K transparent wordmark logos).
- **Catalog** — **337 pre-indexed tracks** across 10 genres plus live catalog search.
- **Library** — Local persistence for favorites, custom playlists, followed artists, and listening history.
- **Mobile / PWA** — Responsive layout with installable web app manifest and TV/device-adaptive hero video playback.

### Catalog Breakdown (`337 Songs` · `151 Artists`)

| Genre | Tracks | Genre | Tracks |
|---|---:|---|---:|
| Romance | 109 | J-Pop | 31 |
| Pop | 42 | K-Pop | 31 |
| Bollywood | 25 | Rock | 23 |
| French | 21 | Latin | 20 |
| Hip-Hop | 19 | R&B / Soul | 16 |

## Screenshots

### Home & Curated Genre Shelves
![Home Page — Hero Cards and Genre Sidebar](screenshots/home.png)

### Now Playing & Apple Music Sing Synced Lyrics
![Now Playing — Animated Cover Art and Word-Synced Lyrics](screenshots/now-playing-lyrics.png)

### Cinematic 4K Artist Profile
![Artist Profile — Full-Bleed Hero Banner and Wordmark Logo](screenshots/artist-page.png)

## Development

```bash
npm install
npm run dev
```

To rebuild the catalog and lyrics index:

```bash
pip install requests pycryptodome rapidfuzz pillow
npm run catalog
```

## Production Build

```bash
npm run build
```

Static output is written to `docs/` for GitHub Pages deployment.

## License

For personal use.
