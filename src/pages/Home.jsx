import { useMemo, useState } from 'react';
import { art } from '../api';
import { ArtistBubble, SongCard, SongRow } from '../components/Shared';
import { ChevronRight, Lyrics, Play, Shuffle } from '../components/Icons';
import FluidBackground from '../components/FluidBackground';
import { useCatalog, useLibrary, usePlayer, useRouter } from '../store';

export default function HomePage() {
  const catalog = useCatalog();
  const player = usePlayer();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const [genre, setGenre] = useState('all');

  const allSongs = useMemo(() => Object.values(catalog.songs), [catalog]);
  const allArtists = useMemo(
    () =>
      Object.values(catalog.artists)
        .filter((a) => a.image)
        .sort((a, b) => (b.fans || 0) - (a.fans || 0)),
    [catalog]
  );

  // Featured hero cards (pick songs with synced lyrics across genres)
  const heroes = useMemo(() => {
    const picks = [
      { match: 'Cruel Summer', tag: 'GLOBAL #1 · FULL SONG · ANIMATED COVER', headline: 'Pop Anthems in Motion' },
      { match: 'Idol', tag: 'J-POP ESSENTIALS · KANJI / KANA SYNC', headline: 'YOASOBI & Japanese Hits' },
      { match: 'Dernière danse', tag: 'CHANSON & POP FRANÇAISE · FULL SONG', headline: 'French Hits: Indila & Stromae' },
      { match: 'Perfect', tag: 'ROMANCE · SLOW DANCE', headline: 'Love Songs Forever' },
      { match: 'APT.', tag: 'K-POP FEVER · SING-ALONG', headline: 'ROSÉ, BTS, NewJeans & More' },
      { match: 'Tití Me Preguntó', tag: 'MÚSICA URBANA & LATIN POP', headline: 'Bad Bunny, KAROL G & Shakira' },
      { match: 'Bohemian Rhapsody', tag: 'ROCK LEGENDS · FULL LENGTH', headline: 'Timeless Rock Anthems' },
      { match: 'Tum Hi Ho', tag: 'BOLLYWOOD ROMANCE', headline: 'Arijit Singh Essentials' },
    ];
    return picks
      .map((p) => {
        const s = allSongs.find((x) => x.title.toLowerCase().includes(p.match.toLowerCase()));
        return s ? { ...p, song: s } : null;
      })
      .filter(Boolean);
  }, [allSongs]);

  const filtered = useMemo(
    () => (genre === 'all' ? allSongs : allSongs.filter((s) => s.genre === genre)),
    [allSongs, genre]
  );

  const syncedSongs = useMemo(() => allSongs.filter((s) => s.lyrics === 'synced'), [allSongs]);
  const byGenre = (g) => allSongs.filter((s) => s.genre === g);

  return (
    <div className="page home-page">
      <header className="page-header">
        <div className="ph-brand-row" onClick={() => navigate('/')} style={{ cursor: 'pointer' }} title="Go to Home">
          <img className="ph-logo-img" src="logo.jpg" alt="Apple Music" />
          <div>
            <div className="eyebrow">apple music</div>
            <h1>Home</h1>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="pill-btn"
            onClick={() => {
              player.playList(syncedSongs, 0, { shuffle: true });
              player.setNowOpen(true);
            }}
          >
            <Lyrics size={16} /> Sing-Along Shuffle
          </button>
        </div>
      </header>

      {/* HERO SHOWCASE */}
      <section className="hero-strip">
        {heroes.map((h) => {
          const s = h.song;
          const artist = catalog.artists[s.artistId];
          return (
            <div
              key={s.id}
              className="hero-card"
              onClick={() => {
                player.playSong(s, byGenre(s.genre));
                player.setNowOpen(true);
              }}
            >
              <div className="hc-top">
                <div className="hc-tag">{h.tag}</div>
                <div className="hc-head">{h.headline}</div>
                <div className="hc-sub">{s.title} — {s.artist}</div>
              </div>
              <div className="hc-visual">
                {s.videoArt ? (
                  <video
                    className="hc-bg-video"
                    src={s.videoArt}
                    poster={art(s.art, 600)}
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                ) : (
                  <FluidBackground src={artist?.image || art(s.art, 300)} speed={0.9} dim={0.22} />
                )}
                <img className="hc-art" src={art(s.art, 600)} alt={s.title} />
                <div className="hc-footer">
                  <div className="hc-f-text">
                    <div className="t">{s.title}</div>
                    <div className="a">{s.artist} · {s.album}</div>
                  </div>
                  <button className="hc-play" aria-label="Play with lyrics">
                    <Play size={18} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* GENRE PILLS */}
      <div className="genre-bar">
        <button className={`g-pill ${genre === 'all' ? 'on' : ''}`} onClick={() => setGenre('all')}>
          All Genres
        </button>
        {catalog.genres.map((g) => (
          <button
            key={g.id}
            className={`g-pill ${genre === g.id ? 'on' : ''}`}
            style={genre === g.id ? { background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` } : undefined}
            onClick={() => setGenre(g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>

      {/* FILTERED VIEW WHEN A GENRE IS PICKED */}
      {genre !== 'all' && (
        <section className="sec">
          <div className="sec-head">
            <h2>{catalog.genres.find((g) => g.id === genre)?.name} Hits</h2>
            <div className="sec-actions">
              <button className="pill-btn sm" onClick={() => player.playList(filtered, 0)}>
                <Play size={14} /> Play
              </button>
              <button className="pill-btn sm" onClick={() => player.playList(filtered, 0, { shuffle: true })}>
                <Shuffle size={14} /> Shuffle
              </button>
            </div>
          </div>
          <div className="card-row">
            {filtered.map((s) => (
              <SongCard key={s.id} song={s} list={filtered} />
            ))}
          </div>
        </section>
      )}

      {/* TOP ARTISTS (animated profiles) */}
      <section className="sec">
        <div className="sec-head">
          <div>
            <h2>Top Artists</h2>
            <p className="sec-sub">Tap any artist for their animated motion portrait & discography</p>
          </div>
        </div>
        <div className="artist-row">
          {allArtists.slice(0, 18).map((a) => (
            <ArtistBubble key={a.id} artist={a} />
          ))}
        </div>
      </section>

      {/* WORD-TO-WORD SING ALONG */}
      <section className="sec">
        <div className="sec-head">
          <div>
            <h2>Word-for-Word Sing-Along</h2>
            <p className="sec-sub">Tap a track — the full-screen Apple Music lyric sheet opens automatically</p>
          </div>
          <button
            className="sec-more"
            onClick={() => {
              player.playList(syncedSongs, 0);
              player.setNowOpen(true);
            }}
          >
            Play All <ChevronRight size={16} />
          </button>
        </div>
        <div className="QuickGrid">
          {syncedSongs.slice(0, 12).map((s) => (
            <SongRow key={s.id} song={s} list={syncedSongs} compact />
          ))}
        </div>
      </section>

      {/* RECENTLY PLAYED */}
      {lib.recent.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <h2>Recently Played</h2>
          </div>
          <div className="card-row">
            {lib.recent.slice(0, 10).map((s) => (
              <SongCard key={s.id} song={s} list={lib.recent} />
            ))}
          </div>
        </section>
      )}

      {/* GENRE SHELVES */}
      {[
        { id: 'pop', title: 'Today’s Pop Superstars', sub: 'Full-length chart toppers with animated album covers & word-by-word lyrics' },
        { id: 'jpop', title: 'J-Pop & Anime Essentials', sub: 'YOASOBI, Kenshi Yonezu, Ado, Fujii Kaze, RADWIMPS & Tokyo hits' },
        { id: 'kpop', title: 'K-Pop Global Wave', sub: 'ROSÉ, BTS, NewJeans, BLACKPINK, aespa, Stray Kids & LE SSERAFIM' },
        { id: 'romance', title: 'Romance & Slow Dance', sub: 'Timeless love songs & ballads with full-length sing-along lyrics' },
        { id: 'french', title: 'Pop Française & Chanson', sub: 'Indila, Stromae, Aya Nakamura, Angèle, Daft Punk & Édith Piaf' },
        { id: 'latin', title: 'Éxitos Latinos', sub: 'Bad Bunny, KAROL G, Shakira, Peso Pluma, Feid & Rauw Alejandro' },
        { id: 'rock', title: 'Rock & Alternative Legends', sub: 'Queen, Arctic Monkeys, Linkin Park, Coldplay, Nirvana & Tame Impala' },
        { id: 'hiphop', title: 'Rap Life & R&B', sub: 'Kendrick Lamar, SZA, The Weeknd, Travis Scott, Drake & Frank Ocean', extra: 'rnb' },
        { id: 'bollywood', title: 'Bollywood Romance & Indie', sub: 'Arijit Singh, Anuv Jain, AP Dhillon & Diljit Dosanjh' },
      ].map((shelf) => {
        const list = allSongs.filter((s) => s.genre === shelf.id || s.genre === shelf.extra);
        if (!list.length) return null;
        return (
          <section className="sec" key={shelf.id}>
            <div className="sec-head">
              <div>
                <h2>{shelf.title}</h2>
                <p className="sec-sub">{shelf.sub}</p>
              </div>
              <button className="sec-more" onClick={() => setGenre(shelf.id)}>
                See All <ChevronRight size={16} />
              </button>
            </div>
            <div className="card-row">
              {list.map((s) => (
                <SongCard key={s.id} song={s} list={list} />
              ))}
            </div>
          </section>
        );
      })}

      {/* BROWSE BY CATEGORY CARDS */}
      <section className="sec">
        <div className="sec-head">
          <h2>Browse by Mood & Genre</h2>
        </div>
        <div className="mood-grid">
          {catalog.genres.map((g) => {
            const sample = byGenre(g.id)[0];
            return (
              <div
                key={g.id}
                className="mood-card"
                style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }}
                onClick={() => navigate(`/genre/${g.id}`)}
              >
                <span>{g.name}</span>
                {sample && <img src={art(sample.art, 300)} alt="" />}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
