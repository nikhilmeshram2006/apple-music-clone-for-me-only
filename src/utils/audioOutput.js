import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNativeAndroid } from './nativeAudio';

const STORAGE_KEY = 'am_audio_output';

const BT_RE =
  /bluetooth|a2dp|avrcp|hands-free|ag audio|le audio|\bsco\b|airpods|airpod|buds|earbuds|pods|bose|sony|wh-\d|wf-\d|xm\d|linkbuds|jbl|beats|powerbeats|studio3|solo3|wireless|\bbt\b|tws|neckband|soundcore|anker|sennheiser|momentum|accentum|marshall|jabra|skullcandy|nothing ear|cmf|oneplus|bullets|boat|airdopes|rockerz|nirvana|realme|redmi|xiaomi|oppo enco|vivo|noise|boult|mivi|oneodio|edifier|qcy|shokz|b&o|bang|galaxy buds|pixel buds|headset/i;
const BT_HFP_RE = /hands-free|ag audio|\bsco\b/i;
const WIRED_SPEAKER_RE = /realtek|high definition|internal|built-in|hdmi|displayport|nvidia|amd|intel|usb|conexant|macbook|speakerphone/i;
const HP_RE = /headphone|earphone|aux|line out|usb|dac|jack/i;

export function classifyOutput(label = '') {
  if (BT_RE.test(label)) {
    return {
      kind: 'bluetooth',
      subtitle: BT_HFP_RE.test(label) ? 'Bluetooth Hands-Free' : 'Bluetooth Audio',
      isHandsFree: BT_HFP_RE.test(label),
    };
  }
  if (/stereo/i.test(label) && !WIRED_SPEAKER_RE.test(label)) {
    return { kind: 'bluetooth', subtitle: 'Bluetooth Stereo', isHandsFree: false };
  }
  if (HP_RE.test(label)) {
    return { kind: 'headphones', subtitle: 'Headphones', isHandsFree: false };
  }
  return { kind: 'speaker', subtitle: 'Speaker', isHandsFree: false };
}

function cleanLabel(label = '') {
  return label
    .replace(/^Default\s*-\s*/i, '')
    .replace(/^Communications\s*-\s*/i, '')
    .trim();
}

function kindPriority(item) {
  if (item.kind === 'bluetooth' && !item.isHandsFree) return 0;
  if (item.kind === 'bluetooth') return 1;
  if (item.kind === 'headphones') return 2;
  return 3;
}

export function useAudioOutput(audioEl, notify) {
  const nativeAndroid = isNativeAndroid();
  const nativeBridge = nativeAndroid ? window.AurelNative : null;
  const canSetSinkId = Boolean(audioEl && typeof audioEl.setSinkId === 'function');
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  const canEnumerate = Boolean(mediaDevices && typeof mediaDevices.enumerateDevices === 'function');
  const canSelectOutput = Boolean(mediaDevices && typeof mediaDevices.selectAudioOutput === 'function');
  const canWebkitPicker = Boolean(audioEl && typeof audioEl.webkitShowPlaybackTargetPicker === 'function');

  const [detected, setDetected] = useState([]);
  const [sessionPicked, setSessionPicked] = useState([]);
  const [defaultLabel, setDefaultLabel] = useState('');
  const [defaultGroupId, setDefaultGroupId] = useState('');
  const [nativeRoutedId, setNativeRoutedId] = useState('');
  const [labelsLocked, setLabelsLocked] = useState(false);
  const [permState, setPermState] = useState(nativeAndroid ? 'granted' : 'unknown');
  const [unlocking, setUnlocking] = useState(false);
  const [androidBtInput, setAndroidBtInput] = useState(null);
  const [webkitWireless, setWebkitWireless] = useState(() =>
    Boolean(audioEl && audioEl.webkitCurrentPlaybackTargetIsWireless)
  );
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
  const attemptedAutoUnlockRef = useRef(false);

  const persistId = useCallback((id) => {
    setActiveId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore quota */
    }
  }, []);

  useEffect(() => {
    if (nativeAndroid || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let alive = true;
    let permStatus = null;
    navigator.permissions
      .query({ name: 'microphone' })
      .then((res) => {
        if (!alive) return;
        permStatus = res;
        setPermState(res.state);
        res.onchange = () => {
          if (alive) setPermState(res.state);
        };
      })
      .catch(() => {
        /* Safari/Firefox may not support querying 'microphone' */
      });
    return () => {
      alive = false;
      if (permStatus) permStatus.onchange = null;
    };
  }, [nativeAndroid]);

  const refreshDevices = useCallback(async () => {
    if (nativeBridge?.getOutputDevices) {
      try {
        const raw = nativeBridge.getOutputDevices();
        const data = JSON.parse(raw || '{}');
        const list = Array.isArray(data.devices) ? data.devices : [];
        const mapped = list.map((d) => ({
          id: String(d.id),
          sinkId: String(d.id),
          name: d.name || 'Audio Device',
          kind: d.kind || 'speaker',
          subtitle: d.subtitle || (d.kind === 'bluetooth' ? 'Bluetooth Audio' : d.kind === 'headphones' ? 'Wired Headphones' : 'Phone Speaker'),
          isHandsFree: false,
          detected: true,
        }));
        mapped.sort((a, b) => kindPriority(a) - kindPriority(b));
        setDetected(mapped);
        const rId = data.routedId ? String(data.routedId) : '';
        const pId = data.preferredId ? String(data.preferredId) : '';
        setNativeRoutedId(rId);
        const routedDev = mapped.find((d) => d.id === rId) || null;
        setDefaultLabel(routedDev?.name || '');
        setLabelsLocked(false);

        if (!restoredRef.current) {
          restoredRef.current = true;
          if (activeId && activeId !== 'auto' && mapped.some((d) => d.id === activeId)) {
            nativeBridge.setOutputDevice?.(activeId);
          } else if (pId && mapped.some((d) => d.id === pId)) {
            persistId(pId);
          } else {
            persistId('auto');
          }
        }
        return true;
      } catch {
        return true;
      }
    }

    if (audioEl && 'webkitCurrentPlaybackTargetIsWireless' in audioEl) {
      setWebkitWireless(Boolean(audioEl.webkitCurrentPlaybackTargetIsWireless));
    }
    if (!canEnumerate) return true;
    try {
      const devices = await mediaDevices.enumerateDevices();
      const outs = devices.filter((d) => d.kind === 'audiooutput');
      const ins = devices.filter((d) => d.kind === 'audioinput');

      const def = outs.find((d) => d.deviceId === 'default');
      const defLabel = def?.label ? cleanLabel(def.label) : '';
      setDefaultLabel(defLabel);
      setDefaultGroupId(def?.groupId || '');

      const seen = new Set();
      const real = [];
      for (const d of outs) {
        if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const name = cleanLabel(d.label);
        if (!name || seen.has(d.deviceId)) continue;
        seen.add(d.deviceId);
        const { kind, subtitle, isHandsFree } = classifyOutput(name);
        real.push({
          id: d.deviceId,
          sinkId: d.deviceId,
          groupId: d.groupId || '',
          name,
          kind,
          subtitle,
          isHandsFree,
          detected: true,
        });
      }
      real.sort((a, b) => kindPriority(a) - kindPriority(b));
      setDetected(real);

      // Mobile Chrome fallback: inspect labeled audioinput devices when audiooutput devices are hidden
      let btIn = null;
      let anyLabeledIn = false;
      for (const d of ins) {
        const name = cleanLabel(d.label);
        if (!name) continue;
        anyLabeledIn = true;
        const info = classifyOutput(name);
        if (info.kind === 'bluetooth') {
          btIn = {
            id: 'detected-bt',
            sinkId: '',
            groupId: d.groupId || '',
            name: /^bluetooth/i.test(name) ? name : `${name} (Bluetooth)`,
            kind: 'bluetooth',
            subtitle: canSetSinkId ? 'Bluetooth Audio' : 'Connected · Playing via OS',
            detected: true,
            osManaged: !canSetSinkId,
          };
          break;
        }
      }
      setAndroidBtInput(btIn);

      const hasAnyLabel = Boolean(real.length || defLabel || anyLabeledIn);
      setLabelsLocked(!hasAnyLabel);

      if (!restoredRef.current) {
        restoredRef.current = true;
        if (activeId && activeId !== 'auto' && !activeId.startsWith('preset-')) {
          const match = real.find((r) => r.id === activeId);
          if (match && canSetSinkId) {
            audioEl.setSinkId(match.sinkId).catch(() => persistId('auto'));
          } else if (hasAnyLabel && !match && activeId !== 'detected-bt' && activeId !== 'safari-wireless') {
            persistId('auto');
          }
        }
      }
      return hasAnyLabel;
    } catch {
      return false;
    }
  }, [nativeBridge, canEnumerate, mediaDevices, activeId, canSetSinkId, audioEl, persistId]);

  useEffect(() => {
    refreshDevices();
    const onFocus = () => refreshDevices();
    const onVis = () => {
      if (!document.hidden) refreshDevices();
    };
    const onWireless = () => {
      if (audioEl) setWebkitWireless(Boolean(audioEl.webkitCurrentPlaybackTargetIsWireless));
      refreshDevices();
    };
    if (nativeAndroid && typeof window !== 'undefined') {
      window.addEventListener('aurel-native-devices', onFocus);
    }
    if (!nativeAndroid && mediaDevices?.addEventListener) {
      mediaDevices.addEventListener('devicechange', onFocus);
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    if (!nativeAndroid && audioEl?.addEventListener) {
      audioEl.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
    }
    return () => {
      if (nativeAndroid && typeof window !== 'undefined') {
        window.removeEventListener('aurel-native-devices', onFocus);
      }
      if (!nativeAndroid && mediaDevices?.removeEventListener) {
        mediaDevices.removeEventListener('devicechange', onFocus);
      }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      if (!nativeAndroid && audioEl?.removeEventListener) {
        audioEl.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      }
    };
  }, [audioEl, mediaDevices, nativeAndroid, refreshDevices]);

  const pickSystemDevice = useCallback(async () => {
    if (nativeBridge?.openSystemOutputPicker) {
      nativeBridge.openSystemOutputPicker();
      return true;
    }
    if (canSelectOutput) {
      try {
        const picked = await mediaDevices.selectAudioOutput();
        if (canSetSinkId && picked?.deviceId) {
          await audioEl.setSinkId(picked.deviceId);
        }
        const name = cleanLabel(picked?.label) || 'Audio Device';
        const { kind, subtitle, isHandsFree } = classifyOutput(name);
        const item = {
          id: picked.deviceId,
          sinkId: picked.deviceId,
          groupId: picked.groupId || '',
          name,
          kind,
          subtitle,
          isHandsFree,
          detected: true,
        };
        setSessionPicked((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
        persistId(item.id);
        setLabelsLocked(false);
        setStatusNote('');
        notify?.(`Switched output to ${name}`, 'success');
        return true;
      } catch (err) {
        if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError') {
          notify?.('Could not open system device picker', 'error');
        }
        return false;
      }
    }
    if (canWebkitPicker) {
      try {
        audioEl.webkitShowPlaybackTargetPicker();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, [audioEl, canSelectOutput, canSetSinkId, canWebkitPicker, mediaDevices, nativeBridge, notify, persistId]);

  const unlockDevices = useCallback(async () => {
    if (nativeAndroid) {
      await refreshDevices();
      return true;
    }
    if (canSelectOutput && !mediaDevices?.getUserMedia) {
      return pickSystemDevice();
    }
    if (!mediaDevices?.getUserMedia) {
      if (canSelectOutput) return pickSystemDevice();
      setStatusNote('This browser restricts hardware audio enumeration.');
      return false;
    }
    setUnlocking(true);
    setStatusNote('');
    let stream = null;
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
      setPermState('granted');
      await refreshDevices();
      return true;
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setPermState('denied');
        setStatusNote('Allow audio device access in browser site settings to detect & switch Bluetooth and speakers.');
      } else {
        setStatusNote('Could not scan audio devices in this browser.');
      }
      return false;
    } finally {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setUnlocking(false);
    }
  }, [canSelectOutput, mediaDevices, nativeAndroid, pickSystemDevice, refreshDevices]);

  const onOpenPopover = useCallback(async () => {
    const unlocked = await refreshDevices();
    if (!nativeAndroid && !unlocked && permState !== 'denied' && !attemptedAutoUnlockRef.current && mediaDevices?.getUserMedia) {
      attemptedAutoUnlockRef.current = true;
      await unlockDevices();
    }
  }, [mediaDevices, nativeAndroid, permState, refreshDevices, unlockDevices]);

  const defaultMatched = useMemo(() => {
    if (!detected.length) return null;
    if (nativeAndroid && nativeRoutedId) {
      const byRouted = detected.find((d) => d.id === nativeRoutedId);
      if (byRouted) return byRouted;
    }
    if (defaultGroupId && defaultLabel) {
      const exactGroup = detected.find((d) => d.groupId === defaultGroupId && d.name === defaultLabel);
      if (exactGroup) return exactGroup;
    }
    if (defaultLabel) {
      const lower = defaultLabel.toLowerCase();
      return (
        detected.find((d) => d.name.toLowerCase() === lower) ||
        detected.find((d) => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase())) ||
        null
      );
    }
    return null;
  }, [detected, defaultGroupId, defaultLabel, nativeAndroid, nativeRoutedId]);

  const options = useMemo(() => {
    const merged = [...detected];
    if (!nativeAndroid) {
      const seenIds = new Set(merged.map((d) => d.id));
      for (const p of sessionPicked) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          merged.push(p);
        }
      }

      if (!merged.length) {
        if (androidBtInput) {
          merged.push(androidBtInput);
        } else if (webkitWireless) {
          merged.push({
            id: 'safari-wireless',
            sinkId: '',
            kind: 'bluetooth',
            name: 'Bluetooth / AirPlay',
            subtitle: 'Wireless Audio · Active',
            detected: true,
            osManaged: true,
          });
        }
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

    if (!nativeAndroid && !labelsLocked && !merged.some((d) => d.kind === 'speaker')) {
      list.push({
        id: 'preset-speaker',
        sinkId: '',
        kind: 'speaker',
        name: 'Speaker',
        subtitle: canSetSinkId ? 'Device Speaker' : 'Device Speaker · System route',
        isPreset: true,
        osManaged: !canSetSinkId,
      });
    }

    return list;
  }, [detected, nativeAndroid, sessionPicked, androidBtInput, webkitWireless, defaultLabel, labelsLocked, canSetSinkId]);

  useEffect(() => {
    if (activeId !== 'auto' && !options.some((o) => o.id === activeId)) {
      persistId('auto');
    }
  }, [options, activeId, persistId]);

  const activeOption = useMemo(
    () => options.find((o) => o.id === activeId) || options[0],
    [options, activeId]
  );

  const playingDevice = useMemo(() => {
    if (nativeAndroid) {
      if (nativeRoutedId) {
        const routed = options.find((o) => o.id === nativeRoutedId);
        if (routed) return routed;
      }
      if (activeId !== 'auto') {
        const selected = options.find((o) => o.id === activeId);
        if (selected) return selected;
      }
      return defaultMatched;
    }
    if (activeId !== 'auto') {
      const selected = options.find((o) => o.id === activeId);
      if (selected) return selected;
    }
    if (defaultMatched) return defaultMatched;
    if (androidBtInput) return androidBtInput;
    if (webkitWireless) {
      return options.find((o) => o.id === 'safari-wireless') || { kind: 'bluetooth', name: 'Bluetooth / AirPlay' };
    }
    return null;
  }, [nativeAndroid, nativeRoutedId, activeId, options, defaultMatched, androidBtInput, webkitWireless]);

  const defaultKind = defaultLabel ? classifyOutput(defaultLabel).kind : '';
  const isBluetoothActive = Boolean(
    webkitWireless ||
      playingDevice?.kind === 'bluetooth' ||
      (!nativeAndroid && activeId === 'auto' && defaultKind === 'bluetooth')
  );
  const playingLabel =
    playingDevice?.name || (defaultLabel ? defaultLabel : labelsLocked ? '' : 'System Default');

  const selectOption = useCallback(
    async (opt) => {
      if (!opt) return false;
      setStatusNote('');

      if (nativeBridge?.setOutputDevice) {
        const target = opt.id === 'auto' ? 'auto' : String(opt.id);
        const ok = nativeBridge.setOutputDevice(target);
        if (ok) {
          persistId(opt.id);
          await refreshDevices();
          notify?.(opt.id === 'auto' ? 'Audio output: Automatic' : `Switched output to ${opt.name}`, 'success');
          return true;
        }
        notify?.(`Could not switch directly to ${opt.name}`, 'error');
        return false;
      }

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
        return true;
      }

      if (!opt.isPreset && opt.sinkId) {
        if (canSetSinkId) {
          try {
            await audioEl.setSinkId(opt.sinkId);
            persistId(opt.id);
            notify?.(`Switched output to ${opt.name}`, 'success');
            return true;
          } catch {
            notify?.('Could not switch to that device', 'error');
            refreshDevices();
            return false;
          }
        }
        persistId(opt.id);
        notify?.(`Audio output: ${opt.name}`, 'success');
        return true;
      }

      if (opt.osManaged || opt.id === 'preset-speaker' || opt.id === 'detected-bt' || opt.id === 'safari-wireless') {
        if (canSetSinkId && opt.id === 'preset-speaker') {
          try {
            await audioEl.setSinkId('');
          } catch {
            /* ignore */
          }
          persistId('preset-speaker');
          notify?.('Audio output: Speaker', 'success');
          return true;
        }
        if (canWebkitPicker) {
          try {
            audioEl.webkitShowPlaybackTargetPicker();
            return true;
          } catch {
            /* fallback below */
          }
        }
        if (audioEl?.remote && typeof audioEl.remote.prompt === 'function') {
          try {
            await audioEl.remote.prompt();
            return true;
          } catch {
            /* fallback below */
          }
        }
        setStatusNote('Your mobile browser follows the phone’s Media Output panel — swipe down to switch Bluetooth & Speaker.');
        notify?.(
          opt.kind === 'bluetooth'
            ? `Playing via ${opt.name}`
            : 'Switch speaker in your phone Media Output panel',
          'success'
        );
        return false;
      }

      return true;
    },
    [audioEl, canSetSinkId, canWebkitPicker, nativeBridge, notify, persistId, refreshDevices]
  );

  return {
    options,
    activeId,
    activeOption,
    playingDeviceId: playingDevice?.id || '',
    playingLabel,
    isBluetoothActive,
    isNativeAndroid: nativeAndroid,
    labelsLocked,
    permState,
    unlocking,
    statusNote,
    canPickNative: nativeAndroid || canSelectOutput || canWebkitPicker,
    isSafariPicker: !nativeAndroid && !canSelectOutput && canWebkitPicker,
    refreshDevices,
    onOpenPopover,
    unlockDevices,
    selectOption,
    pickSystemDevice,
  };
}
