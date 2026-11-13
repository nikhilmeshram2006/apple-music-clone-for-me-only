import { useEffect, useRef, useState } from 'react';
import { art, loadLyrics } from '../api';
import { fmt, useLibrary, usePlayer, usePlayerTime, useRouter } from '../store';
import FluidBackground from './FluidBackground';
import {
  CastIcon, ChevronDown, Explicit, LosslessWave, Lyrics as LyricsIcon, MoreVert, Next, Pause, Play,
  Prev, QueueList, Repeat, Shuffle, Star, VolHigh, VolLow,
} from './Icons';
import LyricsView from './Lyrics';
import { Bars, SongMenu } from './Shared';

function Scrubber({ offset = 0 }) {
  const player = usePlayer();
  const { t, d } = usePlayerTime();
  const [drag, setDrag] = useState(null);
  const bar = useRef(null);
  const val = drag !== null ? drag : t;
  const pct = d > 0 ? Math.min(100, Math.max(0, (val / d) * 100)) : 0;

  const pos = (e) => {
    const r = bar.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return Math.max(0, Math.min(1, x / r.width)) * (d || 30);
  };
  const down = (e) => {
    const v = pos(e);
    setDrag(v);
    const move = (ev) => setDrag(pos(ev));
    const up = (ev) => {
      const f = ev.changedTouches ? pos({ touches: ev.changedTouches }) : pos(ev);
      player.seek(f);
      setDrag(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move);
    window.addEventListener('touchend', up);
  };

  return (
    <div className={`scrubber ${drag !== null ? 'dragging' : ''}`}>
      <div className="scrub-track" ref={bar} onMouseDown={down} onTouchStart={down}>
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="scrub-times">
        <span>{fmt(val + offset)}</span>
        <span className="scrub-badge">
          <LosslessWave size={14} /> Lossless
        </span>
        <span>-{fmt(Math.max(0, (d || 180) - val))}</span>
      </div>
    </div>
  );
}

export default function NowPlaying() {
  const player = usePlayer();
  const lib = useLibrary();
  const { navigate } = useRouter();
  const song = player.current;
  const [panel, setPanel] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 960 ? 'art' : 'lyrics')); // 'art' | 'lyrics' | 'queue'
  const [lyrics, setLyrics] = useState(null);
  const [lyrLoading, setLyrLoading] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!song) return;
    let alive = true;
    setLyrLoading(true);
    loadLyrics(song).then((d) => {
      if (!alive) return;
      setLyrics(d);
      setLyrLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) return null;
  const liked = lib.isLiked(song.id);

  const goArtist = () => {
    if (!song.artistId) return;
    player.setNowOpen(false);
    navigate(`/artist/${song.artistId}`);
  };

  return (
    <div className={`np-overlay ${player.nowOpen ? 'open' : ''} panel-${panel}`} aria-hidden={!player.nowOpen}>
      <FluidBackground src={art(song.art, 300)} speed={1.1} dim={0.38} paused={!player.playing} />
      <div className="np-sheet">
        <button className="np-dismiss" onClick={() => player.setNowOpen(false)} aria-label="Collapse player">
          <span className="grabber" />
          <ChevronDown size={22} />
        </button>

        <div className="np-body">
          {/* LEFT: artwork + transport */}
          <div className="np-left">
            <div className={`np-art-stage ${player.playing ? 'playing' : 'paused'} ${song.videoArt ? 'has-video' : ''}`} onClick={() => setPanel(panel === 'art' ? 'lyrics' : 'art')}>
              {song.videoArt ? (
                <video
                  key={song.videoArt}
                  className="np-video-art"
                  src={song.videoArt}
                  poster={art(song.art, 1000)}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img src={art(song.art, 1000)} alt={song.title} />
              )}
            </div>

            <div className="np-compact-head">
              <img src={art(song.art, 200)} alt="" onClick={() => setPanel('art')} />
              <div className="np-ch-text" onClick={() => setPanel('art')}>
                <div className="np-ch-title">
                  {song.title} {song.explicit && <Explicit />}
                </div>
                <div className="np-ch-sub" onClick={(e) => { e.stopPropagation(); goArtist(); }}>
                  {song.artist}
                </div>
              </div>
              <button className={`np-circle ${liked ? 'on' : ''}`} onClick={() => lib.toggleLike(song)} aria-label="Favorite">
                <Star size={18} />
              </button>
              <div style={{ position: 'relative' }}>
                <button className="np-circle" onClick={() => setMenu((m) => !m)} aria-label="More">
                  <MoreVert size={18} />
                </button>
                {menu && <SongMenu song={song} onClose={() => setMenu(false)} />}
              </div>
            </div>

            <div className="np-meta-row">
              <div className="np-titles">
                <div className="np-title">
                  <span>{song.title}</span>
                  {song.explicit && <Explicit />}
                </div>
                <div className="np-artist" onClick={goArtist}>{song.artist}</div>
              </div>
              <div className="np-meta-actions">
                <button className={`np-circle ${liked ? 'on' : ''}`} onClick={() => lib.toggleLike(song)} aria-label="Favorite">
                  <Star size={18} />
                </button>
                <div style={{ position: 'relative' }}>
                  <button className="np-circle" onClick={() => setMenu((m) => !m)} aria-label="More">
                    <MoreVert size={18} />
                  </button>
                  {menu && <SongMenu song={song} onClose={() => setMenu(false)} />}
                </div>
              </div>
            </div>

            <Scrubber offset={lyrics?.synced ? lyrics.offset : 0} />

            <div className="np-transport">
              <button className={`np-t-aux ${player.shuffle ? 'on' : ''}`} onClick={player.toggleShuffle} title="Shuffle">
                <Shuffle size={20} />
              </button>
              <button className="np-t-skip" onClick={player.prev} aria-label="Previous">
                <Prev size={34} />
              </button>
              <button className="np-t-play" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
                {player.playing ? <Pause size={42} /> : <Play size={42} />}
              </button>
              <button className="np-t-skip" onClick={player.next} aria-label="Next">
                <Next size={34} />
              </button>
              <button
                className={`np-t-aux ${player.repeat !== 'off' ? 'on' : ''}`}
                onClick={player.cycleRepeat}
                title="Repeat"
              >
                <Repeat size={20} one={player.repeat === 'one'} />
              </button>
            </div>

            <div className="np-volume">
              <VolLow size={16} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.volume}
                style={{ '--vp': `${player.volume * 100}%` }}
                onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                aria-label="Volume"
              />
              <VolHigh size={16} />
            </div>

            <div className="np-SwitchRow">
              <button
                className={`np-pill ${panel === 'lyrics' ? 'on' : ''}`}
                onClick={() => setPanel(panel === 'lyrics' ? 'art' : 'lyrics')}
                title="Lyrics"
              >
                <LyricsIcon size={22} />
              </button>
              <button className="np-pill" onClick={() => song.appleUrl && window.open(song.appleUrl, '_blank')} title="Cast / AirPlay">
                <CastIcon size={21} />
              </button>
              <button
                className={`np-pill ${panel === 'queue' ? 'on' : ''}`}
                onClick={() => setPanel(panel === 'queue' ? 'art' : 'queue')}
                title="Playing Next"
              >
                <QueueList size={22} />
              </button>
            </div>
          </div>

          {/* RIGHT: lyrics or queue */}
          <div className="np-right">
            {panel === 'queue' ? (
              <div className="np-queue">
                <div className="np-q-head">
                  <div>
                    <div className="np-q-title">Playing Next</div>
                    <div className="np-q-sub">{player.queue.length} songs in queue</div>
                  </div>
                  <div className="np-q-pills">
                    <button className={player.shuffle ? 'on' : ''} onClick={player.toggleShuffle}><Shuffle size={16} /></button>
                    <button className={player.repeat !== 'off' ? 'on' : ''} onClick={player.cycleRepeat}>
                      <Repeat size={16} one={player.repeat === 'one'} />
                    </button>
                  </div>
                </div>
                <div className="np-q-list">
                  {player.queue.map((s, i) => (
                    <div
                      key={s.id + '-' + i}
                      className={`np-q-row ${i === player.index ? 'cur' : ''} ${i < player.index ? 'past' : ''}`}
                      onClick={() => player.jumpTo(i)}
                    >
                      <img src={art(s.art, 120)} alt="" />
                      <div className="np-q-meta">
                        <div className="t">{s.title}</div>
                        <div className="a">{s.artist}</div>
                      </div>
                      {i === player.index && player.playing && <Bars />}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <LyricsView data={lyrics} loading={lyrLoading} song={song} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
