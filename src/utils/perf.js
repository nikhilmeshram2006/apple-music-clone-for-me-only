import { useEffect, useState } from 'react';

export function isMobilePerf() {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth <= 960) return true;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  const mem = navigator.deviceMemory;
  return Boolean(mem && mem <= 4);
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

const listeners = new Set();
let listening = false;
function notify() {
  const val = isMobilePerf();
  listeners.forEach((fn) => fn(val));
}
function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const mq = window.matchMedia?.('(max-width: 960px)');
  mq?.addEventListener?.('change', notify);
  window.addEventListener('resize', notify, { passive: true });
}

export function useIsMobilePerf() {
  const [mobile, setMobile] = useState(isMobilePerf);
  useEffect(() => {
    ensureListener();
    setMobile(isMobilePerf());
    listeners.add(setMobile);
    return () => listeners.delete(setMobile);
  }, []);
  return mobile;
}
