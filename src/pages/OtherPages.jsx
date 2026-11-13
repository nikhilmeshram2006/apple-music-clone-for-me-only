import { useEffect, useMemo, useState } from 'react';
import { albumLookup, art, artistImage, searchAll } from '../api';
import FluidBackground from '../components/FluidBackground';
import {
  Back, Clock, Close, Gear, Heart, Lyrics, Music, Play, Plus, Search as SearchIcon,
  Shuffle, Star, Trash, User, Wave,
} from '../components/Icons';
import { ArtistBubble, SongCard, SongRow } from '../components/Shared';
import { fmt, useCatalog, useLibrary, usePlayer, useRouter } from '../store';

// ================================================================== SEARCH / BROWSE
export function SearchPage({ initialQuery = '' }) {
  const catalog = useCatalog();
  const { navigate } = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [remote, setRemote] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setQ(initialQuery), [initialQuery]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRemote(null);
      return;
    }
    setBusy(true);
    const id = setTimeout(() => {
      searchAll(term)
        .then(async (res) => {
          // enrich first few artists with Deezer portraits
          const enriched = await Promise.all(
            res.artists.slice(0, 6).map(async (a) => {
              const seeded = catalog.artists[a.id];
              if (seeded?.image) return seeded;
              const im = await artistImage(a.name);
              return { ...a, image: im?.image, fans: im?.fans };
            })
          );
          setRemote({ ...res, artists: enriched });
          setBusy(false);
        })
        .catch(() => setBusy(false));
    }, 220);
    return () => clearTimeout(id);
  }, [q, catalog]);

  const localSongs = useMemo(() => {
    if (!q.trim()) return [];
    const t = q.toLowerCase();
    return Object.values(catalog.songs).filter((s) => `${s.title} ${s.artist} ${s.album} ${s.genre}`.toLowerCase().includes(t));
  }, [q, catalog]);

  const localArtists = useMemo(() => {
    if (!q.trim()) return [];
    const t = q.toLowerCase();
    return Object.values(catalog.artists).filter((a) => a.name.toLowerCase().includes(t));
  }, [q, catalog]);

  const songs = useMemo(() => {
    const map = new Map();
    localSongs.forEach((s) => map.set(s.id, s));
    (remote?.songs || []).forEach((s) => !map.has(s.id) && map.set(s.id, s));
    return [...map.values()];
  }, [localSongs, remote]);

  const artists = useMemo(() => {
    const map = new Map();
    localArtists.forEach((a) => map.set(a.id, a));
    (remote?.artists || []).forEach((a) => !map.has(a.id) && map.set(a.id, a));
    return [...map.values()];
  }, [localArtists, remote]);

  const allSongs = useMemo(() => Object.values(catalog.songs), [catalog]);
  const allArtists = useMemo(
    () =>
      Object.values(catalog.artists)
        .filter((a) => a.image)
        .sort((a, b) => (b.fans || 0) - (a.fans || 0)),
    [catalog]
  );

  return (
    <div className="page search-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">apple music</div>
          <h1>Search & Browse</h1>
        </div>
      </header>

      {!q.trim() ? (
        <>
          <section className="sec">
            <h2>Browse Categories</h2>
            <div className="mood-grid large">
              {catalog.genres.map((g) => {
                const sample = allSongs.find((s) => s.genre === g.id);
                return (
                  <div
                    key={g.id}
                    className="mood-card"
                    style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }}
                    onClick={() => navigate(`/genre/${g.id}`)}
                  >
                    <span>{g.name}</span>
                    {sample && <img src={art(sample.art, 300)} alt={g.name} />}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="sec">
            <h2>Quick Filter Artists & Genres</h2>
            <div className="trend-chips">
              {['SZA', 'YOASOBI', 'Taylor Swift', 'Arijit Singh', 'Sabrina Carpenter', 'Kenshi Yonezu', 'Indila', 'Stromae', 'Ed Sheeran', 'ROSÉ', 'Bad Bunny', 'The Weeknd', 'Ado', 'Billie Eilish', 'BTS', 'Queen'].map((t) => (
                <button key={t} className="g-pill" onClick={() => setQ(t)}>
                  <SearchIcon size={13} /> {t}
                </button>
              ))}
            </div>
          </section>

          <section className="sec">
            <h2>All Featured Artists ({allArtists.length})</h2>
            <div className="artist-row">
              {allArtists.map((a) => (
                <ArtistBubble key={a.id} artist={a} />
              ))}
            </div>
          </section>

          <section className="sec">
            <h2>Complete Full-Length Song Directory ({allSongs.length})</h2>
            <div className="song-list">
              {allSongs.slice(0, 60).map((s, i) => (
                <SongRow key={s.id} song={s} list={allSongs} index={i} showIndex />
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="active-filter-bar">
            <span>Showing results for <b>“{q}”</b></span>
            <button className="pill-btn sm" onClick={() => { setQ(''); navigate('/search'); }}>
              <Close size={13} /> Clear Filter
            </button>
          </div>
          {busy && <div className="subtle-status">Searching full-length catalog & global database…</div>}
          {!busy && artists.length === 0 && songs.length === 0 && (
            <div className="empty-box">
              <SearchIcon size={32} />
              <p>No songs or artists matched “{q}”. Try another artist or song title in the top search bar.</p>
            </div>
          )}

          {artists.length > 0 && (
            <section className="sec">
              <h2>Artists</h2>
              <div className="artist-row">
                {artists.map((a) => (
                  <ArtistBubble key={a.id} artist={a} />
                ))}
              </div>
            </section>
          )}

          {songs.length > 0 && (
            <section className="sec">
              <h2>Songs ({songs.length})</h2>
              <div className="song-list">
                {songs.map((s, i) => (
                  <SongRow key={s.id} song={s} list={songs} index={i} />
                ))}
              </div>
            </section>
          )}

          {remote?.albums?.length > 0 && (
            <section className="sec">
              <h2>Albums</h2>
              <div className="card-row">
                {remote.albums.map((al) => (
                  <div key={al.id} className="song-card" onClick={() => navigate(`/album/${al.id}`)}>
                    <div className="sc-art">
                      <img src={art(al.art, 400)} alt={al.title} loading="lazy" />
                    </div>
                    <div className="sc-title"><span>{al.title}</span></div>
                    <div className="sc-sub">{al.artist} · {al.year}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================== GENRE PAGE
export function GenrePage({ id }) {
  const catalog = useCatalog();
  const player = usePlayer();
  const { navigate } = useRouter();
  const g = catalog.genres.find((x) => x.id === id);
  const songs = useMemo(() => Object.values(catalog.songs).filter((s) => s.genre === id), [catalog, id]);
  const artists = useMemo(
    () => Object.values(catalog.artists).filter((a) => a.genres?.includes(id) && a.image),
    [catalog, id]
  );

  if (!g) {
    return <NotFoundPage message={`Genre “${id}” was not found.`} />;
  }

  return (
    <div className="page">
      <div className="genre-banner" style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }}>
        <button className="ah-back glass" onClick={() => navigate('/')} aria-label="Back to Home"><Back size={20} /></button>
        <div>
          <div className="eyebrow">APPLE MUSIC GENRE</div>
          <h1>{g.name}</h1>
          <p>{songs.length} hand-curated tracks with word-by-word synced lyrics</p>
        </div>
        <div className="gb-actions">
          <button className="pill-btn glass" onClick={() => player.playList(songs, 0)}>
            <Play size={16} /> Play
          </button>
          <button className="pill-btn glass" onClick={() => player.playList(songs, 0, { shuffle: true })}>
            <Shuffle size={16} /> Shuffle
          </button>
        </div>
      </div>

      {artists.length > 0 && (
        <section className="sec">
          <h2>Featured {g.name} Artists</h2>
          <div className="artist-row">
            {artists.map((a) => <ArtistBubble key={a.id} artist={a} />)}
          </div>
        </section>
      )}

      <section className="sec">
        <h2>All {g.name} Songs</h2>
        <div className="song-list">
          {songs.map((s, i) => <SongRow key={s.id} song={s} list={songs} index={i} showIndex />)}
        </div>
      </section>
    </div>
  );
}

// ================================================================== ALBUM PAGE
export function AlbumPage({ id }) {
  const player = usePlayer();
  const { navigate } = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    albumLookup(id)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="page"><div className="subtle-status">Loading album…</div></div>;
  }
  if (!data?.album) {
    return <NotFoundPage message="Album not found or unavailable." />;
  }
  const { album, songs } = data;
  return (
    <div className="page">
      <button className="back-inline" onClick={() => navigate('/')}><Back size={18} /> Home</button>
      <div className="album-header">
        <img className="al-cover" src={art(album.art, 600)} alt={album.title} />
        <div className="al-meta">
          <div className="eyebrow">{album.genre?.toUpperCase()} · {album.year}</div>
          <h1>{album.title}</h1>
          <div className="al-artist" onClick={() => navigate(`/artist/${album.artistId}`)}>{album.artist}</div>
          <div className="al-actions">
            <button className="pill-btn primary" onClick={() => player.playList(songs, 0)}>
              <Play size={16} /> Play
            </button>
            <button className="pill-btn" onClick={() => player.playList(songs, 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </div>
      <div className="song-list">
        {songs.map((s, i) => <SongRow key={s.id} song={s} list={songs} index={i} showIndex showArt={false} />)}
      </div>
      {album.copyright && <p className="copyright">{album.copyright}</p>}
    </div>
  );
}

// ================================================================== LIBRARY PAGE
export function LibraryPage() {
  const catalog = useCatalog();
  const lib = useLibrary();
  const player = usePlayer();
  const { navigate } = useRouter();
  const [tab, setTab] = useState('favorites');

  const synced = useMemo(() => Object.values(catalog.songs).filter((s) => s.lyrics === 'synced'), [catalog]);

  const makePlaylist = () => {
    const name = window.prompt('New playlist name:', 'Late Night Mix');
    if (name) {
      const p = lib.createPlaylist(name, []);
      navigate(`/playlist/${p.id}`);
    }
  };

  return (
    <div className="page library-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">YOUR COLLECTION</div>
          <h1>Library</h1>
        </div>
        <button className="pill-btn" onClick={makePlaylist}>
          <Plus size={16} /> New Playlist
        </button>
      </header>

      <div className="lib-shortcuts">
        <button className={`lib-tile ${tab === 'favorites' ? 'on' : ''}`} onClick={() => setTab('favorites')}>
          <Heart size={20} filled /> <span>Favorite Songs</span> <b>{lib.liked.length}</b>
        </button>
        <button className={`lib-tile ${tab === 'playlists' ? 'on' : ''}`} onClick={() => setTab('playlists')}>
          <Music size={20} /> <span>Playlists</span> <b>{lib.playlists.length}</b>
        </button>
        <button className={`lib-tile ${tab === 'artists' ? 'on' : ''}`} onClick={() => setTab('artists')}>
          <Star size={20} /> <span>Following</span> <b>{lib.following.length}</b>
        </button>
        <button className={`lib-tile ${tab === 'recent' ? 'on' : ''}`} onClick={() => setTab('recent')}>
          <Clock size={20} /> <span>Recently Played</span> <b>{lib.recent.length}</b>
        </button>
        <button className={`lib-tile ${tab === 'lyrics' ? 'on' : ''}`} onClick={() => setTab('lyrics')}>
          <Lyrics size={20} /> <span>Word-Synced Catalog</span> <b>{synced.length}</b>
        </button>
      </div>

      {tab === 'favorites' && (
        <section className="sec">
          <div className="sec-head">
            <h2>Favorite Songs</h2>
            {lib.liked.length > 0 && (
              <button className="pill-btn sm" onClick={() => player.playList(lib.liked, 0)}>
                <Play size={14} /> Play All
              </button>
            )}
          </div>
          {lib.liked.length === 0 ? (
            <div className="empty-box">
              <Heart size={36} />
              <p>Tap the heart on any song to save it to your Library.</p>
            </div>
          ) : (
            <div className="song-list">
              {lib.liked.map((s, i) => <SongRow key={s.id} song={s} list={lib.liked} index={i} showIndex />)}
            </div>
          )}
        </section>
      )}

      {tab === 'playlists' && (
        <section className="sec">
          <h2>Your Playlists</h2>
          <div className="playlist-grid">
            <div className="pl-card create" onClick={makePlaylist}>
              <div className="pl-cover"><Plus size={36} /></div>
              <div className="pl-name">Create Playlist</div>
            </div>
            {lib.playlists.map((p) => (
              <div key={p.id} className="pl-card" onClick={() => navigate(`/playlist/${p.id}`)}>
                <div className="pl-cover">
                  {p.songs[0] ? <img src={art(p.songs[0].art, 400)} alt="" /> : <Music size={34} />}
                </div>
                <div className="pl-name">{p.name}</div>
                <div className="pl-sub">{p.songs.length} songs</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'artists' && (
        <section className="sec">
          <h2>Followed Artists</h2>
          {lib.following.length === 0 ? (
            <div className="empty-box">
              <User size={36} />
              <p>Visit any artist profile and tap “Favorite” to follow them here.</p>
            </div>
          ) : (
            <div className="artist-row">
              {lib.following.map((a) => <ArtistBubble key={a.id} artist={a} />)}
            </div>
          )}
        </section>
      )}

      {tab === 'recent' && (
        <section className="sec">
          <h2>Recently Played</h2>
          {lib.recent.length === 0 ? (
            <div className="empty-box"><Clock size={36} /><p>Songs you play will appear here.</p></div>
          ) : (
            <div className="song-list">
              {lib.recent.map((s, i) => <SongRow key={s.id} song={s} list={lib.recent} index={i} />)}
            </div>
          )}
        </section>
      )}

      {tab === 'lyrics' && (
        <section className="sec">
          <div className="sec-head">
            <h2>All Word-Synced Songs ({synced.length})</h2>
            <button className="pill-btn sm" onClick={() => { player.playList(synced, 0); player.setNowOpen(true); }}>
              <Play size={14} /> Sing Along
            </button>
          </div>
          <div className="song-list">
            {synced.map((s, i) => <SongRow key={s.id} song={s} list={synced} index={i} showIndex />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ================================================================== PLAYLIST PAGE
export function PlaylistPage({ id }) {
  const lib = useLibrary();
  const player = usePlayer();
  const { navigate } = useRouter();
  const pl = lib.playlists.find((p) => p.id === id);

  if (!pl) return <div className="page"><div className="subtle-status">Playlist not found.</div></div>;

  return (
    <div className="page">
      <button className="back-inline" onClick={() => navigate('/library')}><Back size={18} /> Library</button>
      <div className="album-header">
        <div className="al-cover pl-mosaic">
          {pl.songs.slice(0, 4).map((s) => <img key={s.id} src={art(s.art, 300)} alt="" />)}
          {pl.songs.length === 0 && <Music size={48} />}
        </div>
        <div className="al-meta">
          <div className="eyebrow">PERSONAL PLAYLIST</div>
          <h1>{pl.name}</h1>
          <div className="al-sub">{pl.songs.length} songs</div>
          <div className="al-actions">
            {pl.songs.length > 0 && (
              <>
                <button className="pill-btn primary" onClick={() => player.playList(pl.songs, 0)}>
                  <Play size={16} /> Play
                </button>
                <button className="pill-btn" onClick={() => player.playList(pl.songs, 0, { shuffle: true })}>
                  <Shuffle size={16} /> Shuffle
                </button>
              </>
            )}
            <button
              className="pill-btn"
              onClick={() => {
                lib.deletePlaylist(pl.id);
                navigate('/library');
              }}
            >
              <Trash size={15} /> Delete
            </button>
          </div>
        </div>
      </div>

      {pl.songs.length === 0 ? (
        <div className="empty-box">
          <p>Use the “•••” menu on any song to add tracks to this playlist.</p>
        </div>
      ) : (
        <div className="song-list">
          {pl.songs.map((s, i) => (
            <SongRow
              key={s.id}
              song={s}
              list={pl.songs}
              index={i}
              showIndex
              rightSlot={
                <button
                  className="icon-btn"
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    lib.removeFromPlaylist(pl.id, s.id);
                  }}
                >
                  <Trash size={15} />
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================== PROFILE / REPLAY PAGE
export function ProfilePage() {
  const catalog = useCatalog();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const [editing, setEditing] = useState(false);

  const favArtist = useMemo(() => {
    const entries = Object.entries(lib.stats.byArtist || {}).sort((a, b) => b[1].s - a[1].s);
    if (entries[0]) return catalog.artists[entries[0][0]] || Object.values(catalog.artists)[0];
    return lib.following[0] || Object.values(catalog.artists).find((a) => a.image);
  }, [lib, catalog]);

  const portrait = favArtist?.image || art(lib.recent[0]?.art, 600);
  const mins = Math.max(1, Math.round((lib.stats.seconds || 0) / 60));

  return (
    <div className="page profile-page">
      {/* ANIMATED PROFILE HEADER */}
      <div className="profile-hero">
        <FluidBackground src={portrait} speed={1.15} dim={0.35} />
        <div className="ph-inner">
          <div className="ph-avatar" style={{ borderColor: lib.profile.color }}>
            {portrait ? <img src={portrait} alt="" /> : <User size={44} />}
          </div>
          <div className="ph-text">
            <div className="eyebrow">APPLE MUSIC REPLAY · LISTENER PROFILE</div>
            {editing ? (
              <div className="ph-edit">
                <input
                  value={lib.profile.name}
                  onChange={(e) => lib.setProfile({ ...lib.profile, name: e.target.value })}
                />
                <input
                  value={lib.profile.handle}
                  onChange={(e) => lib.setProfile({ ...lib.profile, handle: e.target.value })}
                />
                <button className="pill-btn sm" onClick={() => { setEditing(false); lib.notify('Profile saved', 'success'); }}>Save</button>
              </div>
            ) : (
              <>
                <h1>{lib.profile.name}</h1>
                <div className="ph-handle">
                  {lib.profile.handle} · <button className="link-btn" onClick={() => setEditing(true)}>Edit Profile</button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="replay-stats">
          <div className="rs-card glass">
            <Wave size={18} />
            <div className="v">{lib.stats.plays || 0}</div>
            <div className="l">Songs Played</div>
          </div>
          <div className="rs-card glass">
            <Clock size={18} />
            <div className="v">{lib.stats.seconds ? `${mins} min` : '0 min'}</div>
            <div className="l">Listening Time</div>
          </div>
          <div className="rs-card glass">
            <Heart size={18} filled />
            <div className="v">{lib.liked.length}</div>
            <div className="l">Favorites</div>
          </div>
          <div className="rs-card glass">
            <Star size={18} />
            <div className="v">{lib.following.length}</div>
            <div className="l">Artists Followed</div>
          </div>
        </div>
      </div>

      {/* PREFERENCES */}
      <section className="sec">
        <h2><Gear size={18} /> Playback & Lyrics Preferences</h2>
        <div className="prefs-card">
          <div className="pref-row">
            <div>
              <div className="t">Karaoke Lyric Scale</div>
              <div className="s">Adjust font size inside the full-screen Apple Music lyric sheet</div>
            </div>
            <div className="seg">
              {[
                { v: 0.88, l: 'Compact' },
                { v: 1, l: 'Default' },
                { v: 1.16, l: 'Large' },
              ].map((o) => (
                <button
                  key={o.l}
                  className={lib.settings.lyricSize === o.v ? 'on' : ''}
                  onClick={() => lib.setSettings({ ...lib.settings, lyricSize: o.v })}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div className="pref-row">
            <div>
              <div className="t">Audio Quality</div>
              <div className="s">Streaming full-length 320 kbps AAC tracks + full-song word-by-word LRCLIB lyrics</div>
            </div>
            <span className="lossless-badge">Lossless · 320 kbps</span>
          </div>
          <div className="pref-row">
            <div>
              <div className="t">Reset Local Data</div>
              <div className="s">Clear favorites, playlists, and listening history stored in this browser</div>
            </div>
            <button className="pill-btn sm" onClick={lib.resetAll}><Trash size={14} /> Reset</button>
          </div>
        </div>
      </section>

      {lib.following.length > 0 && (
        <section className="sec">
          <h2>Your Artists</h2>
          <div className="artist-row">
            {lib.following.map((a) => <ArtistBubble key={a.id} artist={a} />)}
          </div>
        </section>
      )}

      {lib.recent.length > 0 && (
        <section className="sec">
          <h2>Listening History</h2>
          <div className="card-row">
            {lib.recent.slice(0, 12).map((s) => <SongCard key={s.id} song={s} list={lib.recent} />)}
          </div>
        </section>
      )}

      <section className="sec">
        <h2>Explore Featured Artists</h2>
        <div className="artist-row">
          {Object.values(catalog.artists).filter((a) => a.image).slice(0, 12).map((a) => (
            <ArtistBubble key={a.id} artist={a} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ================================================================== CUSTOM 404 PAGE
export function NotFoundPage({ message = "The page you’re looking for doesn’t exist or has been moved." }) {
  const { navigate } = useRouter();
  return (
    <div className="page not-found-page">
      <div className="nf-card glass">
        <img src="logo.jpg" alt="Apple Music" className="nf-logo" />
        <div className="eyebrow">404 · PAGE NOT FOUND</div>
        <h1>Can’t Find That Beat</h1>
        <p>{message}</p>
        <div className="nf-actions">
          <button className="pill-btn primary" onClick={() => navigate('/')}>
            <Play size={15} /> Back to Home
          </button>
          <button className="pill-btn" onClick={() => navigate('/search')}>
            <SearchIcon size={15} /> Browse Catalog
          </button>
          <button className="pill-btn" onClick={() => navigate('/library')}>
            Open Library
          </button>
        </div>
      </div>
    </div>
  );
}
