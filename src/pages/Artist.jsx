import { useEffect, useMemo, useRef, useState } from 'react';
import { art, artistImage, artistLookup } from '../api';
import { Back, Close, Lyrics, Pause, Play, Shuffle, Star } from '../components/Icons';
import { ArtistBubble, SongCard, SongRow } from '../components/Shared';
import { useActiveSong, useCatalog, useLibrary, usePlayer, usePlayerActions, useRouter, useSiteConfig } from '../store';

function shouldUse4KVideo() {
  if (typeof window === 'undefined') return false;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && /^(slow-2g|2g|3g)$/.test(conn.effectiveType)) return false;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const isTV = /SMART-TV|Tizen|Web0S|WebOS|BRAVIA|Android TV|GoogleTV|FireTV|AFT/i.test(navigator.userAgent);
  if (isTV || mem < 4 || cores < 4) return false;
  return window.innerWidth >= 1280;
}

const BIO_BLURBS = {
  Pop: 'Chart-dominating hooks, widescreen production, and unmistakable vocal presence that define modern pop radio.',
  'J-Pop': 'Blending hyper-melodic songwriting, anime soundtrack energy, and razor-sharp electronic production from Tokyo’s vanguard.',
  'K-Pop': 'Precision choreography, genre-fluid production, and global fandom power reshaping contemporary pop culture.',
  Romance: 'Intimate storytelling and soaring melodies built for late-night drives, slow dances, and unforgettable moments.',
  Bollywood: 'Soul-stirring vocals and lush cinematic arrangements from the heart of Indian film music.',
  Rock: 'Anthemic guitars, arena-sized choruses, and unmistakable sonic identity spanning generations.',
  'Hip-Hop': 'Hard-hitting rhythms, lyrical craft, and culture-defining production shaping modern hip-hop.',
  'R&B': 'Velvet vocals, nocturnal grooves, and deeply emotional songwriting.',
  French: 'Chic Parisian melodies, poetic lyricism, and sleek electro-pop elegance.',
  Latin: 'Infectious global rhythms, urbano heat, and chart-topping Latin artistry.',
};

// Bespoke custom wordmark styles for artists without an official Apple Music PNG logo
const CUSTOM_WORDMARK_MAP = {
  'lana del rey': 'wm-crimson-serif',
  'cigarettes after sex': 'wm-crimson-serif',
  'édith piaf': 'wm-crimson-serif',
  'indila': 'wm-crimson-serif',
  'hozier': 'wm-crimson-serif',
  'sufjan stevens': 'wm-crimson-serif',
  'twenty one pilots': 'wm-condensed',
  'linkin park': 'wm-condensed',
  'nirvana': 'wm-condensed',
  'arctic monkeys': 'wm-condensed',
  'green day': 'wm-condensed',
  'imagine dragons': 'wm-condensed',
  'the killers': 'wm-condensed',
  'stray kids': 'wm-condensed',
  'king gnu': 'wm-condensed',
  'måneskin': 'wm-condensed',
  'ado': 'wm-condensed',
  'u2': 'wm-geometric',
  'coldplay': 'wm-geometric',
  'daft punk': 'wm-geometric',
  'tame impala': 'wm-geometric',
  'phoenix': 'wm-geometric',
  'onerepublic': 'wm-geometric',
  'the 1975': 'wm-geometric',
  'videoclub': 'wm-geometric',
  'lord huron': 'wm-geometric',
  'yung kai': 'wm-geometric',
  'd4vd': 'wm-geometric',
  'queen': 'wm-monarch',
  'elvis presley': 'wm-monarch',
  'taylor swift': 'wm-monarch',
  'adele': 'wm-monarch',
  'beyoncé': 'wm-monarch',
  'lady gaga': 'wm-monarch',
  'arijit singh': 'wm-monarch',
  'shreya ghoshal': 'wm-monarch',
  'atif aslam': 'wm-monarch',
  'yoasobi': 'wm-syne',
  'blackpink': 'wm-syne',
  'bts': 'wm-syne',
  'newjeans': 'wm-syne',
  'aespa': 'wm-syne',
  'ive': 'wm-syne',
  'le sserafim': 'wm-syne',
  'twice': 'wm-syne',
  'rosé': 'wm-syne',
  'kenshi yonezu': 'wm-syne',
  'radwimps': 'wm-syne',
  'fujii kaze': 'wm-syne',
  'travis scott': 'wm-syne',
  'kendrick lamar': 'wm-syne',
  'bad bunny': 'wm-syne',
  'rosalía': 'wm-syne',
  'billie eilish': 'wm-editorial',
  'sabrina carpenter': 'wm-editorial',
  'chappell roan': 'wm-editorial',
  'olivia rodrigo': 'wm-editorial',
  'ariana grande': 'wm-editorial',
  'rihanna': 'wm-editorial',
  'dua lipa': 'wm-editorial',
  'sza': 'wm-editorial',
  'frank ocean': 'wm-editorial',
  'bruno mars': 'wm-editorial',
  'shakira': 'wm-editorial',
  'the weeknd': 'wm-clean',
  'drake': 'wm-clean',
  'ed sheeran': 'wm-clean',
  'justin bieber': 'wm-clean',
  'charlie puth': 'wm-clean',
  'shawn mendes': 'wm-clean',
  'post malone': 'wm-clean',
  'jvke': 'wm-clean',
  'sai abhyankkar': 'wm-monarch',
  'cup of joe': 'wm-geometric',
  'sunkissed lola': 'wm-crimson-serif',
  'libianca': 'wm-editorial',
};

const FALLBACK_STYLES = ['wm-editorial', 'wm-condensed', 'wm-geometric', 'wm-monarch', 'wm-syne', 'wm-crimson-serif', 'wm-clean'];

function pickWordmarkClass(name = '', genre = '') {
  const key = name.trim().toLowerCase();
  if (CUSTOM_WORDMARK_MAP[key]) return CUSTOM_WORDMARK_MAP[key];
  const g = genre.toLowerCase();
  if (g.includes('rock') || g.includes('metal') || g.includes('punk')) return 'wm-condensed';
  if (g.includes('j-pop') || g.includes('k-pop') || g.includes('hip-hop')) return 'wm-syne';
  if (g.includes('romance') || g.includes('french') || g.includes('chanson')) return 'wm-crimson-serif';
  if (g.includes('bollywood') || g.includes('indian') || g.includes('classical')) return 'wm-monarch';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_STYLES[h % FALLBACK_STYLES.length];
}

function ArtistWordmark({ name, logo, genre, accentColor }) {
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logo, name]);

  if (logo && !logoFailed) {
    return (
      <div className="ah-wordmark-wrap">
        <img
          className="ah-wordmark-img"
          src={logo}
          alt={name}
          decoding="async"
          onError={() => setLogoFailed(true)}
        />
      </div>
    );
  }

  const wmClass = pickWordmarkClass(name, genre);
  return (
    <div className="ah-wordmark-wrap">
      <h1 className={`ah-wordmark-text ${wmClass}`} style={accentColor ? { '--wm-accent': accentColor } : undefined}>
        {name}
      </h1>
    </div>
  );
}

export default function ArtistPage({ id }) {
  const catalog = useCatalog();
  const player = usePlayerActions();
  const { nowOpen } = usePlayer();
  const siteConfig = useSiteConfig();
  const { currentId, playing, toggle, playSong } = useActiveSong();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const seeded = catalog.artists[id];

  const [remote, setRemote] = useState(null);
  const [heroImg, setHeroImg] = useState(seeded?.heroImage || seeded?.image || null);
  const [fans, setFans] = useState(seeded?.fans || 0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const heroWrapRef = useRef(null);
  const videoRef = useRef(null);
  const inViewRef = useRef(true);
  const use4k = useMemo(() => shouldUse4KVideo(), []);

  const localSongs = useMemo(
    () => Object.values(catalog.songs).filter((s) => s.artistId === id || (seeded && s.artist.includes(seeded.name))),
    [catalog, id, seeded]
  );

  useEffect(() => {
    let alive = true;
    setHeroImg(seeded?.heroImage || seeded?.image || null);
    setFans(seeded?.fans || 0);
    setRemote(null);
    setInfoOpen(false);
    setVideoFailed(false);
    setVideoReady(false);
    const lookupId = seeded?.appleId || id;
    artistLookup(lookupId, seeded?.name || localSongs[0]?.artist || '').then((d) => {
      if (!alive) return;
      setRemote(d);
      if (!seeded?.heroImage && !seeded?.image && (d.name || seeded?.name)) {
        artistImage(d.name || seeded.name).then((im) => {
          if (alive && im?.image) {
            setHeroImg(im.image);
            setFans(im.fans || 0);
          }
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [id, seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = seeded?.name || remote?.name || localSongs[0]?.artist || 'Artist';
  const genre = seeded?.genre || remote?.genre || 'Music';

  // merge local (with word-synced lyrics!) first, then remote tracks
  const songs = useMemo(() => {
    const map = new Map();
    localSongs.forEach((s) => map.set(`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`, s));
    (remote?.songs || []).forEach((s) => {
      const k = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
      if (!map.has(k)) map.set(k, s);
    });
    return [...map.values()];
  }, [localSongs, remote]);

  const essential = localSongs[0] || songs[0];
  const heroVideo4k =
    use4k && siteConfig?.enableMotionArt !== false && !videoFailed ? seeded?.heroVideo4k || null : null;
  const heroVideo =
    siteConfig?.enableMotionArt !== false && !videoFailed
      ? seeded?.heroVideo || localSongs.find((s) => s.videoArt)?.videoArt || null
      : null;
  const heroBackdrop = heroImg || seeded?.image || (essential && art(essential.art, 2000));
  const portrait = seeded?.image || heroBackdrop;
  const followed = lib.isFollowing(id);
  const artistPlaying = playing && songs.some((s) => s.id === currentId);

  // Smoothly pause hero motion video when scrolled off-screen, hidden tab, or full-screen Now Playing is open
  useEffect(() => {
    const v = videoRef.current;
    const wrap = heroWrapRef.current;
    if (!v || !wrap) return;

    const syncPlayState = () => {
      const shouldPlay = inViewRef.current && !document.hidden && !nowOpen;
      if (shouldPlay) {
        if (v.paused) v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
      }
    };

    let io;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => {
          inViewRef.current = Boolean(entries[0]?.isIntersecting);
          syncPlayState();
        },
        { threshold: 0.05 }
      );
      io.observe(wrap);
    }

    document.addEventListener('visibilitychange', syncPlayState);
    syncPlayState();

    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', syncPlayState);
    };
  }, [heroVideo, heroVideo4k, nowOpen]);

  const related = useMemo(
    () =>
      Object.values(catalog.artists)
        .filter((a) => a.id !== id && a.image && (a.genre === genre || a.genres?.some((g) => seeded?.genres?.includes(g))))
        .slice(0, 10),
    [catalog, id, genre, seeded]
  );

  const shareArtist = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(
        () => lib.notify(`Copied link for ${name}`, 'success'),
        () => lib.notify(`Sharing ${name}`, 'success')
      );
    } else {
      lib.notify(`Viewing ${name}`, 'success');
    }
  };

  const bioText =
    seeded?.bio ||
    `${BIO_BLURBS[genre] || BIO_BLURBS.Pop} Explore ${name}’s full-length discography with synchronized word-by-word karaoke lyrics and animated artwork.`;

  return (
    <div className="page artist-page">
      {/* FULL-BLEED APPLE MUSIC CINEMATIC ARTIST HERO */}
      <div className="artist-hero cinematic" ref={heroWrapRef}>
        <div
          className={`ah-hero-photo ${videoReady ? 'under-video' : ''}`}
          style={{ backgroundImage: heroBackdrop ? `url(${heroBackdrop})` : undefined }}
        />
        {(heroVideo || heroVideo4k) && (
          <video
            ref={videoRef}
            key={heroVideo4k || heroVideo}
            className={`ah-hero-video ${videoReady ? 'ready' : ''}`}
            poster={heroBackdrop || undefined}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            onPlaying={() => setVideoReady(true)}
            onCanPlay={() => setVideoReady(true)}
            onEnded={(e) => {
              const v = e.currentTarget;
              v.currentTime = 0;
              v.play().catch(() => {});
            }}
            onError={() => {
              setVideoReady(false);
              setVideoFailed(true);
            }}
          >
            {heroVideo4k && <source src={heroVideo4k} type='video/mp4; codecs="hvc1.2.20000000.H150.B0"' />}
            {heroVideo && <source src={heroVideo} type="video/mp4" />}
          </video>
        )}
        <div className="ah-cinematic-fade" />

        {/* TOP-LEFT BACK + TOP-RIGHT FLOATING GLASS PILL */}
        <button className="ah-back glass" onClick={() => navigate('/')} aria-label="Back to Home">
          <Back size={20} />
        </button>

        <div className="ah-top-pill glass">
          <button
            className="ah-top-pill-btn"
            onClick={() => player.playList(songs, 0, { shuffle: true })}
            title="Shuffle Artist"
            aria-label="Shuffle artist"
          >
            <Shuffle size={17} />
          </button>
          <button
            className="ah-top-pill-btn"
            onClick={shareArtist}
            title="Copy Artist Link"
            aria-label="Share artist"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
        </div>

        {/* CENTERED CUSTOM WORDMARK + 3 ICONIC APPLE MUSIC CIRCLE BUTTONS */}
        <div className="ah-center-stage">
          <ArtistWordmark
            name={name}
            logo={seeded?.logo}
            genre={genre}
            accentColor={seeded?.colors?.[0]}
          />

          <div className="ah-action-trio">
            <button
              className="ah-trio-glass"
              onClick={() => setInfoOpen(true)}
              title={`About ${name}`}
              aria-label={`About ${name}`}
            >
              <span className="ah-info-i">i</span>
            </button>

            <button
              className="ah-trio-play"
              onClick={() => (artistPlaying ? toggle() : player.playList(songs, 0))}
              aria-label={artistPlaying ? 'Pause artist' : 'Play artist'}
            >
              {artistPlaying ? <Pause size={26} /> : <Play size={26} />}
            </button>

            <button
              className={`ah-trio-glass ${followed ? 'on' : ''}`}
              onClick={() => lib.toggleFollow({ id, name, image: portrait, genre })}
              title={followed ? 'Remove from Favorites' : 'Favorite Artist'}
              aria-label="Favorite artist"
            >
              <Star size={19} />
            </button>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="artist-body">
        <div className="ab-top-grid">
          {essential && (
            <div className="ab-featured">
              <h2>Latest Release</h2>
              <div
                className="feat-release"
                onClick={() => {
                  playSong(essential, songs);
                  if (essential.lyrics === 'synced') player.setNowOpen(true);
                }}
              >
                {essential.videoArt && siteConfig?.enableMotionArt !== false ? (
                  <video
                    className="fr-video"
                    src={essential.videoArt}
                    poster={art(essential.art, 600)}
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                ) : (
                  <img src={art(essential.art, 600)} alt={essential.title} />
                )}
                <div className="fr-info">
                  <span className="fr-tag">{essential.year || 'ESSENTIAL'} · SINGLE</span>
                  <div className="fr-title">{essential.title}</div>
                  <div className="fr-album">{essential.album}</div>
                  {essential.lyrics === 'synced' && (
                    <div className="fr-lyr">
                      <Lyrics size={14} /> Word-by-word lyrics ready
                    </div>
                  )}
                  <button className="pill-btn sm">
                    <Play size={14} /> Play Now
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="ab-topsongs">
            <div className="sec-head">
              <h2>Top Songs ›</h2>
              <span className="sec-sub">{songs.length} full-length tracks</span>
            </div>
            <div className="top-songs-grid">
              {songs.slice(0, 8).map((s, i) => (
                <SongRow key={s.id} song={s} list={songs} index={i} showIndex compact />
              ))}
            </div>
          </div>
        </div>

        {/* ALL SONGS */}
        {songs.length > 8 && (
          <section className="sec">
            <div className="sec-head">
              <h2>Popular Tracks</h2>
            </div>
            <div className="card-row">
              {songs.slice(0, 16).map((s) => (
                <SongCard key={s.id} song={s} list={songs} subtitle={s.album} />
              ))}
            </div>
          </section>
        )}

        {/* ALBUMS & SINGLES */}
        {remote?.albums?.length > 0 && (
          <section className="sec">
            <div className="sec-head">
              <h2>Albums & Singles</h2>
            </div>
            <div className="card-row">
              {remote.albums.slice(0, 14).map((al) => (
                <div key={al.id} className="song-card" onClick={() => navigate(`/album/${al.id}`)}>
                  <div className="sc-art">
                    <img src={art(al.art, 500)} alt={al.title} loading="lazy" />
                  </div>
                  <div className="sc-title"><span>{al.title}</span></div>
                  <div className="sc-sub">{al.year} · {al.count} tracks</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* SIMILAR ARTISTS */}
        {related.length > 0 && (
          <section className="sec">
            <div className="sec-head">
              <h2>Similar Artists</h2>
            </div>
            <div className="artist-row">
              {related.map((a) => (
                <ArtistBubble key={a.id} artist={a} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ABOUT ARTIST MODAL (triggered by the 'i' button) */}
      {infoOpen && (
        <div className="admin-modal-backdrop" onClick={() => setInfoOpen(false)}>
          <div className="artist-info-modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div className="aim-head-left">
                {portrait && <img src={portrait} alt={name} />}
                <div>
                  <div className="ac-kicker">{genre.toUpperCase()} · ARTIST</div>
                  <h2>{name}</h2>
                </div>
              </div>
              <button className="icon-btn" onClick={() => setInfoOpen(false)} aria-label="Close">
                <Close size={18} />
              </button>
            </div>
            <p className="aim-bio">{bioText}</p>
            <div className="aim-meta-grid">
              <div className="admin-stat-card">
                <span>Genre</span>
                <b>{genre}</b>
              </div>
              <div className="admin-stat-card">
                <span>Catalog Tracks</span>
                <b>{songs.length}</b>
              </div>
              {fans > 0 && (
                <div className="admin-stat-card">
                  <span>Listeners</span>
                  <b>{fans >= 1_000_000 ? `${(fans / 1_000_000).toFixed(1)}M` : `${Math.round(fans / 1000)}K`}</b>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
