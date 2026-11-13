import { useEffect, useMemo, useState } from 'react';
import { art, artistImage, artistLookup } from '../api';
import FluidBackground from '../components/FluidBackground';
import { Back, Check, Lyrics, Pause, Play, Shuffle, Star } from '../components/Icons';
import { ArtistBubble, SongCard, SongRow } from '../components/Shared';
import { useCatalog, useLibrary, usePlayer, useRouter } from '../store';

const BIO_BLURBS = {
  Pop: 'Chart-dominating hooks, widescreen production, and unmistakable vocal presence that define modern pop radio.',
  'J-Pop': 'Blending hyper-melodic songwriting, anime soundtrack energy, and razor-sharp electronic production from Tokyo’s vanguard.',
  'K-Pop': 'Precision choreography, genre-fluid production, and global fandom power reshaping contemporary pop culture.',
  Romance: 'Intimate storytelling and soaring melodies built for late-night drives, slow dances, and unforgettable moments.',
  Bollywood: 'Soul-stirring vocals and lush cinematic arrangements from the heart of Indian film music.',
};

export default function ArtistPage({ id }) {
  const catalog = useCatalog();
  const player = usePlayer();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const seeded = catalog.artists[id];

  const [remote, setRemote] = useState(null);
  const [heroImg, setHeroImg] = useState(seeded?.image || null);
  const [fans, setFans] = useState(seeded?.fans || 0);

  const localSongs = useMemo(
    () => Object.values(catalog.songs).filter((s) => s.artistId === id || (seeded && s.artist.includes(seeded.name))),
    [catalog, id, seeded]
  );

  useEffect(() => {
    let alive = true;
    setHeroImg(seeded?.image || null);
    setFans(seeded?.fans || 0);
    setRemote(null);
    artistLookup(id, seeded?.name || localSongs[0]?.artist || '').then((d) => {
      if (!alive) return;
      setRemote(d);
      if (!seeded?.image && (d.name || seeded?.name)) {
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
  }, [id, seeded]);

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
  const motionVideo = localSongs.find((s) => s.videoArt)?.videoArt || null;
  const portrait = heroImg || (essential && art(essential.art, 1000));
  const followed = lib.isFollowing(id);
  const artistPlaying = songs.some((s) => s.id === player.current?.id) && player.playing;

  const related = useMemo(
    () =>
      Object.values(catalog.artists)
        .filter((a) => a.id !== id && a.image && (a.genre === genre || a.genres?.some((g) => seeded?.genres?.includes(g))))
        .slice(0, 10),
    [catalog, id, genre, seeded]
  );

  return (
    <div className="page artist-page">
      {/* ANIMATED ARTIST PROFILE HERO */}
      <div className="artist-hero">
        <FluidBackground src={portrait} speed={1.25} dim={0.28} />
        {motionVideo ? (
          <video
            className="ah-motion-video"
            src={motionVideo}
            poster={portrait}
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <div className="ah-portrait" style={{ backgroundImage: portrait ? `url(${portrait})` : undefined }} />
        )}
        <div className="ah-vignette" />

        <button className="ah-back glass" onClick={() => navigate('/')} aria-label="Back to Home">
          <Back size={20} />
        </button>

        <div className="ah-actions-top">
          <button
            className={`pill-btn glass ${followed ? 'on' : ''}`}
            onClick={() => lib.toggleFollow({ id, name, image: portrait, genre })}
          >
            {followed ? <><Check size={15} /> Following</> : <><Star size={15} /> Favorite</>}
          </button>
        </div>

        <div className="ah-content">
          <div className="ah-avatar">
            <div className="ah-rings" aria-hidden="true">
              <span /><span /><span />
            </div>
            {portrait && <img src={portrait} alt={name} />}
            <span className="ah-live-dot" title="Animated Artist Motion" />
          </div>
          <div className="ah-text">
            <div className="ah-verified">
              <span className="v-badge">✓</span> Featured Artist · {genre}
              {fans > 0 && ` · ${(fans / 1_000_000 >= 1 ? (fans / 1_000_000).toFixed(1) + 'M' : (fans / 1000).toFixed(0) + 'K')} fans`}
            </div>
            <h1 className="ah-name">{name}</h1>
          </div>
          <div className="ah-playbar">
            <button
              className="ah-play-main"
              onClick={() => (artistPlaying ? player.toggle() : player.playList(songs, 0))}
              aria-label="Play artist"
            >
              {artistPlaying ? <Pause size={26} /> : <Play size={26} />}
            </button>
            <button className="pill-btn glass" onClick={() => player.playList(songs, 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="artist-body">
        <div className="ab-top-grid">
          {essential && (
            <div className="ab-featured">
              <h2>Featured Release</h2>
              <div
                className="feat-release"
                onClick={() => {
                  player.playSong(essential, songs);
                  if (essential.lyrics === 'synced') player.setNowOpen(true);
                }}
              >
                {essential.videoArt ? (
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
              <h2>Top Songs</h2>
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

        {/* ABOUT CARD WITH ANIMATED PORTRAIT */}
        <section className="sec">
          <h2>About {name}</h2>
          <div className="about-card">
            <FluidBackground src={portrait} speed={0.8} dim={0.45} />
            <div className="ac-inner">
              <img src={portrait} alt={name} />
              <div>
                <div className="ac-kicker">{genre.toUpperCase()} · APPLE MUSIC EDITION</div>
                <h3>{name}</h3>
                <p>
                  {BIO_BLURBS[genre] || BIO_BLURBS.Pop} Explore {name}’s catalog above — tracks badged with the quote icon
                  include word-by-word karaoke lyrics synchronized directly to the 256 kbps Apple preview stream.
                </p>
              </div>
            </div>
          </div>
        </section>

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
    </div>
  );
}
