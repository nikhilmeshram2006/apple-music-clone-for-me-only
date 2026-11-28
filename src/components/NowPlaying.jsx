import { useEffect, useRef, useState } from 'react';
import { art, loadLyrics } from '../api';
import { useAudioOutput } from '../utils/audioOutput';
import { isSafeColor, isSafeExternalUrl } from '../utils/studioCore';
import { audio, fmt, useLibrary, useLiked, usePlayer, usePlayerTime, useRouter, useSiteConfig } from '../store';
import FluidBackground from './FluidBackground';
import LiquidCoverStage from './LiquidCoverStage';
import {
  AutoOutput, Bluetooth, CastIcon, Check, Explicit, Headphones, LosslessWave,
  Lyrics as LyricsIcon, More, Next, Pause, Play, Prev, QueueList, Repeat, Shuffle, Speaker, Star, VolHigh, VolLow,
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
      <div
        className="scrub-pill"
        ref={bar}
        onMouseDown={down}
        onTouchStart={down}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(d || 180)}
        aria-valuenow={Math.round(val)}
      >
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
        <div className="scrub-pill-times">
          <span>{fmt(val + offset)}</span>
          <span className="scrub-lossless">
            <LosslessWave size={12} /> Lossless
          </span>
          <span>-{fmt(Math.max(0, (d || 180) - val))}</span>
        </div>
      </div>
    </div>
  );
}

export default function NowPlaying() {
  const player = usePlayer();
  const lib = useLiked();
  const { notify } = useLibrary();
  const { navigate } = useRouter();
  const siteConfig = useSiteConfig();
  const song = player.current;
  const [panel, setPanel] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 960 ? 'art' : 'lyrics')); // 'art' | 'lyrics' | 'queue'
  const [artMode, setArtMode] = useState(() => {
    try {
      return localStorage.getItem('am_art_mode') === 'card' ? 'card' : 'aura';
    } catch {
      return 'aura';
    }
  });
  const [artAnim, setArtAnim] = useState(''); // 'going-down' | 'going-up' | 'dip-down'
  const [panelAnimKey, setPanelAnimKey] = useState(0);
  const animTimerRef = useRef(null);
  const [lyrics, setLyrics] = useState(null);
  const [lyrLoading, setLyrLoading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [bloomKey, setBloomKey] = useState(0);
  const prevOpenRef = useRef(false);
  const outputRef = useRef(null);
  const overlayRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startT: 0, dy: 0, dragging: false });
  const justDraggedRef = useRef(false);
  const output = useAudioOutput(audio, notify);

  const toggleArtMode = () => {
    setBloomKey((k) => k + 1);
    setArtMode((m) => {
      const next = m === 'aura' ? 'card' : 'aura';
      try {
        localStorage.setItem('am_art_mode', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const switchPanel = (target) => {
    const next = panel === target ? 'art' : target;
    if (next === panel) return;
    let anim = 'dip-down';
    if (panel === 'art' && (next === 'lyrics' || next === 'queue')) {
      anim = 'going-down';
    } else if ((panel === 'lyrics' || panel === 'queue') && next === 'art') {
      anim = 'going-up';
    }
    setPanel(next);
    setArtAnim(anim);
    setPanelAnimKey((k) => k + 1);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setArtAnim(''), 620);
  };

  useEffect(() => () => animTimerRef.current && clearTimeout(animTimerRef.current), []);

  useEffect(() => {
    if (!player.nowOpen) {
      setOutputOpen(false);
    } else if (!prevOpenRef.current) {
      setBloomKey((k) => k + 1);
    }
    prevOpenRef.current = player.nowOpen;
  }, [player.nowOpen]);

  useEffect(() => {
    if (player.nowOpen && song?.id) {
      setBloomKey((k) => k + 1);
    }
  }, [song?.id, player.nowOpen]);

  useEffect(() => {
    if (!outputOpen) return;
    const onDown = (e) => {
      if (!outputRef.current?.contains(e.target)) setOutputOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.stopPropagation();
        setOutputOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [outputOpen]);

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
  const auraC1 = isSafeColor(song.colors?.[0]) ? song.colors[0] : '#e4be8b';
  const auraC2 = isSafeColor(song.colors?.[1]) ? song.colors[1] : '#7692d8';

  const goArtist = () => {
    if (!song.artistId) return;
    player.setNowOpen(false);
    navigate(`/artist/${song.artistId}`);
  };

  const canStartSwipe = (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('.scrubber, .np-volume, .np-output-pop, .pop-menu, input')) return false;
    const scroller = target.closest('.np-q-list, .lyrics-wrap.plain');
    if (scroller && scroller.scrollTop > 2) return false;
    return true;
  };

  const beginDrag = (x, y) => {
    dragRef.current = { active: true, startX: x, startY: y, startT: performance.now(), dy: 0, dragging: false };
  };

  const moveDrag = (x, y) => {
    const d = dragRef.current;
    if (!d.active) return false;
    const dx = x - d.startX;
    const dy = y - d.startY;
    if (!d.dragging) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > dy) {
        d.active = false;
        return false;
      }
      if (dy > 8 && dy > Math.abs(dx) * 1.1) {
        d.dragging = true;
        overlayRef.current?.classList.add('dragging');
      }
    }
    if (d.dragging) {
      const clampedY = Math.max(0, dy);
      d.dy = clampedY;
      if (overlayRef.current) {
        overlayRef.current.style.transform = `translate3d(0, ${clampedY}px, 0)`;
      }
      return true;
    }
    return false;
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (!d.active) return;
    const wasDragging = d.dragging;
    const dy = d.dy;
    const dt = Math.max(1, performance.now() - d.startT);
    const velocity = dy / dt;
    d.active = false;
    d.dragging = false;
    d.dy = 0;

    if (overlayRef.current) {
      overlayRef.current.classList.remove('dragging');
      overlayRef.current.style.transform = '';
    }
    if (wasDragging) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 280);
      if (dy >= 95 || (dy >= 42 && velocity >= 0.45)) {
        player.setNowOpen(false);
      }
    }
  };

  const onTouchStart = (e) => {
    if (!player.nowOpen || e.touches.length !== 1) return;
    if (!canStartSwipe(e.target)) return;
    const t = e.touches[0];
    beginDrag(t.clientX, t.clientY);
  };

  const onTouchMove = (e) => {
    if (!dragRef.current.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
  };

  const onGrabberMouseDown = (e) => {
    if (!player.nowOpen || e.button !== 0) return;
    beginDrag(e.clientX, e.clientY);
    const onMove = (ev) => moveDrag(ev.clientX, ev.clientY);
    const onUp = () => {
      endDrag();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={overlayRef}
      className={`np-overlay ${player.nowOpen ? 'open' : ''} panel-${panel} ${artAnim ? `anim-${artAnim}` : ''}`}
      aria-hidden={!player.nowOpen}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endDrag}
      onTouchCancel={endDrag}
    >
      {siteConfig?.enableFluidBg !== false && (
        <FluidBackground src={art(song.art, 300)} speed={1.0} dim={0.48} paused={!player.playing} active={player.nowOpen} />
      )}
      <div className="np-sheet">
        <button
          className="np-dismiss"
          onMouseDown={onGrabberMouseDown}
          onClick={() => {
            if (!justDraggedRef.current) player.setNowOpen(false);
          }}
          title="Swipe down to minimize"
          aria-label="Swipe down to minimize player"
        >
          <span className="grabber" />
        </button>

        <div className="np-body">
          {/* LEFT: frosted aura artwork + pill bar + capsule scrubber + circular glass transport */}
          <div className="np-left">
            <div
              className={`np-art-stage mode-${artMode} ${player.playing ? 'playing' : 'paused'} ${song.videoArt && siteConfig?.enableMotionArt !== false ? 'has-video' : ''}`}
              style={{ '--aura-c1': auraC1, '--aura-c2': auraC2 }}
              title={artMode === 'aura' ? 'Switch to Square Cover' : 'Switch to Liquid Aura'}
            >
              <LiquidCoverStage
                src={art(song.art, 1000)}
                videoSrc={song.videoArt && siteConfig?.enableMotionArt !== false ? song.videoArt : null}
                alt={song.title}
                playing={player.playing}
                active={player.nowOpen}
                artMode={artMode}
                triggerKey={bloomKey}
                auraC1={auraC1}
                auraC2={auraC2}
                onClick={() => {
                  if (!justDraggedRef.current) toggleArtMode();
                }}
              />
            </div>

            <div className="np-compact-head">
              <img src={art(song.art, 200)} alt="" onClick={() => switchPanel(panel)} />
              <div className="np-ch-text" onClick={() => switchPanel(panel)}>
                <div className="np-ch-title">
                  {song.title} {song.explicit && <Explicit />}
                </div>
                <div className="np-ch-sub" onClick={(e) => { e.stopPropagation(); goArtist(); }}>
                  {song.artist}
                </div>
              </div>
              <button className={`np-circle ${liked ? 'on' : ''}`} onClick={() => lib.toggleLike(song)} aria-label="Favorite">
                <Star size={17} />
              </button>
              <div style={{ position: 'relative' }}>
                <button className="np-circle" onClick={() => setMenu((m) => !m)} aria-label="More">
                  <More size={17} />
                </button>
                {menu && <SongMenu song={song} onClose={() => setMenu(false)} />}
              </div>
            </div>

            <div className="np-info-pill">
              <button className={`np-circle np-pill-icon ${liked ? 'on' : ''}`} onClick={() => lib.toggleLike(song)} aria-label="Favorite">
                <Star size={17} />
              </button>
              <div className="np-pill-center">
                <div className="np-title">
                  <span>{song.title}</span>
                  {song.explicit && <Explicit />}
                </div>
                <div className="np-artist" onClick={goArtist}>{song.artist}</div>
              </div>
              <div className="np-pill-more" style={{ position: 'relative' }}>
                <button className="np-circle np-pill-icon" onClick={() => setMenu((m) => !m)} aria-label="More">
                  <More size={18} />
                </button>
                {menu && <SongMenu song={song} onClose={() => setMenu(false)} />}
              </div>
            </div>

            <Scrubber offset={lyrics?.synced ? lyrics.offset : 0} />

            <div className="np-transport">
              <button className={`np-t-aux ${player.shuffle ? 'on' : ''}`} onClick={player.toggleShuffle} title="Shuffle" aria-label="Shuffle">
                <Shuffle size={18} />
              </button>
              <button className="np-t-skip" onClick={player.prev} aria-label="Previous">
                <Prev size={28} />
              </button>
              <button className="np-t-play" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
                {player.playing ? <Pause size={30} /> : <Play size={30} />}
              </button>
              <button className="np-t-skip" onClick={player.next} aria-label="Next">
                <Next size={28} />
              </button>
              <button
                className={`np-t-aux ${player.repeat !== 'off' ? 'on' : ''}`}
                onClick={player.cycleRepeat}
                title="Repeat"
                aria-label="Repeat"
              >
                <Repeat size={18} one={player.repeat === 'one'} />
              </button>
            </div>

            <div className="np-volume">
              <VolLow size={15} />
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
              <VolHigh size={15} />
              {isSafeExternalUrl(song.appleUrl) && (
                <button
                  className="np-vol-ext"
                  onClick={() => window.open(song.appleUrl, '_blank', 'noopener,noreferrer')}
                  title="Open External Track Page"
                  aria-label="Open External Track Page"
                >
                  <CastIcon size={15} />
                </button>
              )}
            </div>

            <div className="np-SwitchRow">
              <button
                className={`np-pill ${panel === 'lyrics' ? 'on' : ''}`}
                onClick={() => switchPanel('lyrics')}
                title="Lyrics"
                aria-label="Lyrics"
              >
                <LyricsIcon size={21} />
              </button>
              <div className="np-output-wrap" ref={outputRef}>
                <button
                  className={`np-pill ${outputOpen || output.activeId !== 'auto' ? 'on' : ''} ${output.isBluetoothActive ? 'bt-active' : ''}`}
                  onClick={() => {
                    const nextOpen = !outputOpen;
                    setOutputOpen(nextOpen);
                    if (nextOpen) output.onOpenPopover();
                  }}
                  title={`Audio Output · ${output.playingLabel || output.activeOption?.name || 'Automatic'}`}
                  aria-label="Audio Output"
                  aria-haspopup="menu"
                  aria-expanded={outputOpen}
                >
                  <Headphones size={21} />
                </button>
                {outputOpen && (
                  <div className="np-output-pop" role="menu" aria-label="Audio Output">
                    <div className="np-out-head">
                      <span className="np-out-title">Audio Output</span>
                      <span className="np-out-count">
                        {output.unlocking ? 'Scanning…' : `${output.options.length} available`}
                      </span>
                    </div>
                    {output.playingLabel && (
                      <div className={`np-out-now ${output.isBluetoothActive ? 'bt' : ''}`}>
                        {output.isBluetoothActive ? <Bluetooth size={13} /> : <Speaker size={13} />}
                        <span>Playing on {output.playingLabel}</span>
                      </div>
                    )}
                    <div className="np-out-list">
                      {output.options.map((opt) => {
                        const isActive = opt.id === output.activeId;
                        const isLivePlaying = output.activeId === 'auto' && opt.id === output.playingDeviceId;
                        const IconComp =
                          opt.kind === 'auto' ? AutoOutput
                            : opt.kind === 'bluetooth' ? Bluetooth
                              : opt.kind === 'headphones' ? Headphones
                                : Speaker;
                        return (
                          <button
                            key={opt.id}
                            role="menuitemradio"
                            aria-checked={isActive}
                            className={`np-out-item ${isActive ? 'active' : ''}`}
                            onClick={async () => {
                              const switched = await output.selectOption(opt);
                              if (switched !== false) setOutputOpen(false);
                            }}
                          >
                            <span className="np-out-ico"><IconComp size={17} /></span>
                            <span className="np-out-meta">
                              <span className="np-out-name">{opt.name}</span>
                              <span className="np-out-sub">{opt.subtitle}</span>
                            </span>
                            {isLivePlaying && <span className="np-out-live">Playing</span>}
                            {isActive && (
                              <span className="np-out-check"><Check size={16} /></span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {output.labelsLocked && (
                      <button
                        className="np-out-unlock"
                        onClick={() => output.unlockDevices()}
                        disabled={output.unlocking}
                      >
                        <Bluetooth size={15} />
                        <span>
                          <strong>{output.unlocking ? 'Scanning devices…' : 'Detect Bluetooth & Speakers'}</strong>
                          <small>Grant browser audio-device access to list & switch outputs</small>
                        </span>
                      </button>
                    )}
                    {output.canPickNative && (
                      <button
                        className="np-out-picker"
                        onClick={async () => {
                          const picked = await output.pickSystemDevice();
                          if (picked) setOutputOpen(false);
                        }}
                      >
                        {output.isNativeAndroid ? 'System Media Output…' : output.isSafariPicker ? 'Other Audio Devices…' : '+ Choose System Device…'}
                      </button>
                    )}
                    {output.statusNote && <div className="np-out-note">{output.statusNote}</div>}
                  </div>
                )}
              </div>
              <button
                className={`np-pill ${panel === 'queue' ? 'on' : ''}`}
                onClick={() => switchPanel('queue')}
                title="Playing Next"
                aria-label="Playing Next"
              >
                <QueueList size={21} />
              </button>
            </div>
          </div>

          {/* RIGHT: lyrics or queue */}
          <div className="np-right">
            <div key={`${panel}-${panelAnimKey}`} className="np-right-stage">
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
                <LyricsView data={lyrics} loading={lyrLoading} song={song} visible={player.nowOpen && panel !== 'queue' && panel !== 'art'} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
