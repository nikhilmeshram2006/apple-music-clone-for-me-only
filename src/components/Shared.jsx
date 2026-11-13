import { useEffect, useRef, useState } from 'react';
import { art } from '../api';
import { fmt, useLibrary, usePlayer, useRouter } from '../store';
import { Check, Explicit, Heart, Lyrics, More, Pause, Play, Plus, Queue, User } from './Icons';

export function Bars() {
  return (
    <span className="eq-bars" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export function SongMenu({ song, onClose }) {
  const player = usePlayer();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const ref = useRef(null);
  const [plOpen, setPlOpen] = useState(false);

  useEffect(() => {
    const on = (e) => !ref.current?.contains(e.target) && onClose();
    setTimeout(() => window.addEventListener('click', on), 0);
    return () => window.removeEventListener('click', on);
  }, [onClose]);

  const liked = lib.isLiked(song.id);
  return (
    <div className="pop-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => { lib.toggleLike(song); onClose(); }}>
        <Heart size={16} filled={liked} /> {liked ? 'Undo Favorite' : 'Favorite'}
      </button>
      <button onClick={() => { player.addNext(song); onClose(); }}>
        <Queue size={16} /> Play Next
      </button>
      <button onClick={() => { player.addLater(song); onClose(); }}>
        <Plus size={16} /> Play Last
      </button>
      <button onClick={() => setPlOpen((o) => !o)}>
        <Plus size={16} /> Add to a Playlist…
      </button>
      {plOpen && (
        <div className="pop-sub">
          <button
            onClick={() => {
              const name = window.prompt('Playlist name:', 'My Mix');
              if (name) lib.createPlaylist(name, [song]);
              onClose();
            }}
          >
            + New Playlist
          </button>
          {lib.playlists.map((p) => {
            const has = p.songs.some((s) => s.id === song.id);
            return (
              <button key={p.id} onClick={() => { lib.addToPlaylist(p.id, song); onClose(); }}>
                {has ? <Check size={14} /> : <span style={{ width: 14 }} />} {p.name}
              </button>
            );
          })}
        </div>
      )}
      {song.artistId && (
        <button onClick={() => { player.setNowOpen(false); navigate(`/artist/${song.artistId}`); onClose(); }}>
          <User size={16} /> Go to Artist
        </button>
      )}
    </div>
  );
}

export function SongRow({ song, list, index, showArt = true, showIndex = false, compact = false, rightSlot }) {
  const player = usePlayer();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const [menu, setMenu] = useState(false);
  const active = player.current?.id === song.id;
  const liked = lib.isLiked(song.id);

  return (
    <div
      className={`song-row ${active ? 'active' : ''} ${compact ? 'compact' : ''}`}
      onClick={() => (active ? player.toggle() : player.playSong(song, list))}
    >
      {showIndex && (
        <span className="sr-idx">
          {active && player.playing ? <Bars /> : active ? <Play size={14} /> : index + 1}
        </span>
      )}
      {showArt && (
        <div className="sr-art">
          <img src={art(song.art, 160)} alt="" loading="lazy" />
          <div className="sr-art-over">{active && player.playing ? <Bars /> : <Play size={18} />}</div>
        </div>
      )}
      <div className="sr-meta">
        <div className="sr-title">
          <span>{song.title}</span>
          {song.explicit && <Explicit />}
          {song.lyrics === 'synced' && <span className="lyric-pill" title="Word-by-word synced lyrics"><Lyrics size={12} /></span>}
        </div>
        <div className="sr-sub">
          <span
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              if (song.artistId) navigate(`/artist/${song.artistId}`);
            }}
          >
            {song.artist}
          </span>
          {song.album && !compact && <span className="sr-album"> · {song.album}</span>}
        </div>
      </div>
      {rightSlot}
      <button
        className={`icon-btn heart-btn ${liked ? 'on' : ''}`}
        title="Favorite"
        onClick={(e) => {
          e.stopPropagation();
          lib.toggleLike(song);
        }}
      >
        <Heart size={16} filled={liked} />
      </button>
      {!compact && <span className="sr-dur">{fmt(song.duration)}</span>}
      <div className="sr-more" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="More">
          <More size={18} />
        </button>
        {menu && <SongMenu song={song} onClose={() => setMenu(false)} />}
      </div>
    </div>
  );
}

export function SongCard({ song, list, subtitle }) {
  const player = usePlayer();
  const { navigate } = useRouter();
  const active = player.current?.id === song.id;
  const [hover, setHover] = useState(false);
  return (
    <div
      className="song-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => (active ? player.toggle() : player.playSong(song, list))}
    >
      <div className="sc-art">
        {song.videoArt && (hover || active) ? (
          <video
            className="sc-video"
            src={song.videoArt}
            poster={art(song.art, 600)}
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <img src={art(song.art, 600)} alt={song.title} loading="lazy" />
        )}
        <button className="sc-play" aria-label="Play">
          {active && player.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        {song.videoArt && (
          <span className="sc-motion-pill" title="Official Apple Music Animated Cover">Motion</span>
        )}
        {song.lyrics === 'synced' && (
          <span className="sc-badge" title="Word-synced lyrics">
            <Lyrics size={13} /> Lyrics
          </span>
        )}
      </div>
      <div className="sc-title">
        <span>{song.title}</span>
        {song.explicit && <Explicit />}
      </div>
      <div
        className="sc-sub"
        onClick={(e) => {
          if (song.artistId) {
            e.stopPropagation();
            navigate(`/artist/${song.artistId}`);
          }
        }}
      >
        {subtitle || song.artist}
      </div>
    </div>
  );
}

export function ArtistBubble({ artist, size = 'md' }) {
  const { navigate } = useRouter();
  const initials = (artist.name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('');
  return (
    <div className={`artist-bubble ${size}`} onClick={() => navigate(`/artist/${artist.id}`)}>
      <div className="ab-img" style={{ background: artist.colors?.[0] || '#2c2c2e' }}>
        {artist.image ? <img src={artist.image} alt={artist.name} loading="lazy" /> : <span>{initials}</span>}
      </div>
      <div className="ab-name">{artist.name}</div>
      {artist.genre && <div className="ab-sub">{artist.genre}</div>}
    </div>
  );
}
