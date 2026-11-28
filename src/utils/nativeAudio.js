export function isNativeAndroid() {
  return typeof window !== 'undefined' && Boolean(window.AurelNative);
}

export function createNativeAudio() {
  let _src = '';
  let _loadedSrc = '';
  let _currentTime = 0;
  let _duration = 180;
  let _paused = true;
  let _volume = 0.9;
  let _lastTickAt = 0;

  const listeners = new Map();
  const emit = (type) => {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn({ type });
      } catch {
        /* listener guard */
      }
    }
  };

  const resolveSrc = (val) => {
    if (!val) return '';
    try {
      const base = typeof window !== 'undefined' ? window.location.href : 'https://aurel.antideploy.app/';
      return new URL(val, base).href;
    } catch {
      return String(val);
    }
  };

  const audioAdapter = {
    isNative: true,
    dataset: {},
    playbackRate: 1,
    preload: 'auto',
    style: {},
    isConnected: true,
    setAttribute() {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    get src() {
      return _src;
    },
    set src(val) {
      const resolved = resolveSrc(val);
      _src = resolved;
      _loadedSrc = resolved;
      _currentTime = 0;
      _lastTickAt = performance.now();
      if (resolved && window.AurelNative?.load) {
        window.AurelNative.load(resolved);
      }
    },
    get currentTime() {
      if (_paused || !_lastTickAt) return _currentTime;
      const dt = Math.min(0.35, Math.max(0, (performance.now() - _lastTickAt) / 1000));
      return Math.min(_duration || 99999, _currentTime + dt);
    },
    set currentTime(t) {
      const sec = Math.max(0, Number(t) || 0);
      _currentTime = sec;
      _lastTickAt = performance.now();
      window.AurelNative?.seekTo?.(Math.round(sec * 1000));
      emit('timeupdate');
    },
    get duration() {
      return _duration;
    },
    get paused() {
      return _paused;
    },
    get volume() {
      return _volume;
    },
    set volume(v) {
      const clamped = Math.max(0, Math.min(1, Number(v) || 0));
      _volume = clamped;
      window.AurelNative?.setVolume?.(clamped);
    },
    play() {
      if (_src && _loadedSrc !== _src && window.AurelNative?.load) {
        _loadedSrc = _src;
        window.AurelNative.load(_src);
      }
      window.AurelNative?.play?.();
      return Promise.resolve();
    },
    pause() {
      window.AurelNative?.pause?.();
    },
    setMetadata(song, artUrl) {
      if (!song) return;
      const fullArt = resolveSrc(artUrl || '');
      window.AurelNative?.setMetadata?.(
        String(song.title || ''),
        String(song.artist || ''),
        String(song.album || ''),
        fullArt
      );
    },
  };

  if (typeof window !== 'undefined') {
    window.__aurelNativeEvent = (type, payload = {}) => {
      if (typeof payload.currentTime === 'number' && isFinite(payload.currentTime)) {
        _currentTime = Math.max(0, payload.currentTime);
        _lastTickAt = performance.now();
      }
      if (typeof payload.duration === 'number' && isFinite(payload.duration) && payload.duration > 0) {
        _duration = payload.duration;
      }
      if (type === 'play' || type === 'playing') {
        _paused = false;
        _lastTickAt = performance.now();
      } else if (type === 'pause' || type === 'ended' || type === 'error') {
        _paused = true;
      }
      emit(type);
    };
  }

  return audioAdapter;
}
