import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'am_audio_output';

const BT_RE =
  /bluetooth|airpods|buds|bose|sony\s?(wh|wf)|jbl|beats|hands-free|a2dp|\bbt\b|wireless|earbuds|soundcore|pods|headset|marshall|nothing ear|oneplus/i;
const HP_RE = /headphone|earphone|aux|line out|usb|dac|jack/i;

export function classifyOutput(label = '') {
  if (BT_RE.test(label)) return { kind: 'bluetooth', subtitle: 'Bluetooth Audio' };
  if (HP_RE.test(label)) return { kind: 'headphones', subtitle: 'Headphones' };
  return { kind: 'speaker', subtitle: 'Speaker' };
}

function cleanLabel(label = '') {
  return label.replace(/^Default\s*-\s*/i, '').trim();
}

export function useAudioOutput(audioEl, notify) {
  const canSetSinkId = Boolean(audioEl && typeof audioEl.setSinkId === 'function');
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  const canEnumerate = Boolean(mediaDevices && typeof mediaDevices.enumerateDevices === 'function');
  const canSelectOutput = Boolean(mediaDevices && typeof mediaDevices.selectAudioOutput === 'function');
  const canWebkitPicker = Boolean(audioEl && typeof audioEl.webkitShowPlaybackTargetPicker === 'function');

  const [detected, setDetected] = useState([]);
  const [sessionPicked, setSessionPicked] = useState([]);
  const [defaultLabel, setDefaultLabel] = useState('');
  const [activeId, setActiveId] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || 'auto';
      return saved === 'preset-bluetooth' ? 'auto' : saved;
    } catch {
      return 'auto';
    }
  });
  const [statusNote, setStatusNote] = useState('');
  const restoredRef = useRef(false);

  const persistId = useCallback((id) => {
    setActiveId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore quota */
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!canEnumerate) return;
    try {
      const devices = await mediaDevices.enumerateDevices();
      const outs = devices.filter((d) => d.kind === 'audiooutput');
      const def = outs.find((d) => d.deviceId === 'default');
      setDefaultLabel(def?.label ? cleanLabel(def.label) : '');

      const seen = new Set();
      const real = [];
      for (const d of outs) {
        if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const name = cleanLabel(d.label);
        if (!name || seen.has(d.deviceId)) continue;
        seen.add(d.deviceId);
        const { kind, subtitle } = classifyOutput(name);
        real.push({ id: d.deviceId, sinkId: d.deviceId, name, kind, subtitle, detected: true });
      }
      setDetected(real);

      if (!restoredRef.current) {
        restoredRef.current = true;
        if (activeId && activeId !== 'auto' && !activeId.startsWith('preset-')) {
          const match = real.find((r) => r.id === activeId);
          if (match && canSetSinkId) {
            audioEl.setSinkId(match.sinkId).catch(() => persistId('auto'));
          } else {
            persistId('auto');
          }
        }
      }
    } catch {
      /* enumerateDevices blocked or unavailable */
    }
  }, [canEnumerate, mediaDevices, activeId, canSetSinkId, audioEl, persistId]);

  useEffect(() => {
    refreshDevices();
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [mediaDevices, refreshDevices]);

  const options = useMemo(() => {
    const merged = [...detected];
    const seenIds = new Set(merged.map((d) => d.id));
    for (const p of sessionPicked) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        merged.push(p);
      }
    }

    const list = [
      {
        id: 'auto',
        sinkId: '',
        kind: 'auto',
        name: 'Automatic',
        subtitle: defaultLabel ? `System Default · ${defaultLabel}` : 'Follows system output',
      },
      ...merged,
    ];

    if (!merged.some((d) => d.kind === 'speaker')) {
      list.push({
        id: 'preset-speaker',
        sinkId: '',
        kind: 'speaker',
        name: 'Speaker',
        subtitle: 'Device Speaker',
        isPreset: true,
      });
    }

    return list;
  }, [detected, sessionPicked, defaultLabel]);

  useEffect(() => {
    if (activeId !== 'auto' && !options.some((o) => o.id === activeId)) {
      persistId('auto');
    }
  }, [options, activeId, persistId]);

  const activeOption = useMemo(
    () => options.find((o) => o.id === activeId) || options[0],
    [options, activeId]
  );

  const selectOption = useCallback(
    async (opt) => {
      if (!opt) return;
      setStatusNote('');

      if (opt.id === 'auto') {
        if (canSetSinkId) {
          try {
            await audioEl.setSinkId('');
          } catch {
            /* ignore */
          }
        }
        persistId('auto');
        notify?.('Audio output: Automatic', 'success');
        return;
      }

      if (!opt.isPreset && opt.sinkId) {
        if (canSetSinkId) {
          try {
            await audioEl.setSinkId(opt.sinkId);
            persistId(opt.id);
            notify?.(`Audio output: ${opt.name}`, 'success');
          } catch {
            notify?.('Could not switch to that device', 'error');
            refreshDevices();
          }
        } else {
          persistId(opt.id);
          notify?.(`Audio output: ${opt.name}`, 'success');
        }
        return;
      }

      if (opt.id === 'preset-speaker') {
        if (canSetSinkId) {
          try {
            await audioEl.setSinkId('');
          } catch {
            /* ignore */
          }
          persistId('preset-speaker');
          setStatusNote('Using device speaker via system audio.');
          notify?.('Audio output: Speaker', 'success');
          return;
        }
        if (canWebkitPicker) {
          try {
            audioEl.webkitShowPlaybackTargetPicker();
            persistId('preset-speaker');
            return;
          } catch {
            /* fallback */
          }
        }
        persistId('preset-speaker');
        setStatusNote('Using device speaker via system audio.');
        notify?.('Audio output: Speaker', 'success');
      }
    },
    [audioEl, canSetSinkId, canWebkitPicker, notify, persistId, refreshDevices]
  );

  const pickSystemDevice = useCallback(async () => {
    if (canSelectOutput) {
      try {
        const picked = await mediaDevices.selectAudioOutput();
        if (canSetSinkId && picked?.deviceId) {
          await audioEl.setSinkId(picked.deviceId);
        }
        const name = cleanLabel(picked?.label) || 'Audio Device';
        const { kind, subtitle } = classifyOutput(name);
        const item = { id: picked.deviceId, sinkId: picked.deviceId, name, kind, subtitle, detected: true };
        setSessionPicked((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
        persistId(item.id);
        setStatusNote('');
        notify?.(`Audio output: ${name}`, 'success');
      } catch (err) {
        if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError') {
          notify?.('Could not open system device picker', 'error');
        }
      }
      return;
    }
    if (canWebkitPicker) {
      try {
        audioEl.webkitShowPlaybackTargetPicker();
      } catch {
        /* ignore */
      }
    }
  }, [audioEl, canSelectOutput, canSetSinkId, canWebkitPicker, mediaDevices, notify, persistId]);

  return {
    options,
    activeId,
    activeOption,
    statusNote,
    canPickNative: canSelectOutput || canWebkitPicker,
    isSafariPicker: !canSelectOutput && canWebkitPicker,
    refreshDevices,
    selectOption,
    pickSystemDevice,
  };
}
