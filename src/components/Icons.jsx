const I = ({ d, size = 24, fill = 'currentColor', stroke, sw = 2, children, vb = '0 0 24 24', ...p }) => (
  <svg width={size} height={size} viewBox={vb} fill={stroke ? 'none' : fill} stroke={stroke ? 'currentColor' : 'none'}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const Play = (p) => <I {...p} d="M7 4.6v14.8c0 .9 1 1.5 1.8 1l12-7.4c.7-.4.7-1.5 0-1.9l-12-7.4C8 3.1 7 3.7 7 4.6z" />;
export const Pause = (p) => (
  <I {...p}>
    <rect x="5.5" y="4" width="4.5" height="16" rx="1.3" />
    <rect x="14" y="4" width="4.5" height="16" rx="1.3" />
  </I>
);
export const Next = (p) => (
  <I {...p} vb="0 0 32 24">
    <path d="M2 5.2v13.6c0 .8.9 1.3 1.6.9L14 13c.6-.4.6-1.3 0-1.7L3.6 4.3C2.9 3.9 2 4.4 2 5.2z" />
    <path d="M16 5.2v13.6c0 .8.9 1.3 1.6.9L28 13c.6-.4.6-1.3 0-1.7L17.6 4.3c-.7-.4-1.6.1-1.6.9z" />
  </I>
);
export const Prev = (p) => (
  <I {...p} vb="0 0 32 24">
    <path d="M30 5.2v13.6c0 .8-.9 1.3-1.6.9L18 13c-.6-.4-.6-1.3 0-1.7l10.4-7c.7-.4 1.6.1 1.6.9z" />
    <path d="M16 5.2v13.6c0 .8-.9 1.3-1.6.9L4 13c-.6-.4-.6-1.3 0-1.7l10.4-7c.7-.4 1.6.1 1.6.9z" />
  </I>
);
export const Home = (p) => <I {...p} d="M3 10.6 12 3l9 7.6V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z" />;
export const Search = (p) => (
  <I {...p} stroke sw={2.4}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </I>
);
export const Library = (p) => (
  <I {...p}>
    <rect x="3" y="3" width="3.2" height="18" rx="1" />
    <rect x="8.4" y="3" width="3.2" height="18" rx="1" />
    <path d="m14.2 4.4 3-.9a1 1 0 0 1 1.2.7l4 15.2a1 1 0 0 1-.7 1.2l-3 .8a1 1 0 0 1-1.2-.7l-4-15.1a1 1 0 0 1 .7-1.2z" />
  </I>
);
export const User = (p) => (
  <I {...p}>
    <circle cx="12" cy="8" r="4.5" />
    <path d="M3.5 20.2C4.6 16.3 8 14 12 14s7.4 2.3 8.5 6.2c.2.7-.4 1.3-1.1 1.3H4.6c-.7 0-1.3-.6-1.1-1.3z" />
  </I>
);
export const Heart = ({ filled, ...p }) =>
  filled ? (
    <I {...p} d="M12 21s-7.5-4.6-9.6-9.4C.9 8 3 4 6.9 4c2.2 0 3.7 1.2 5.1 3 1.4-1.8 2.9-3 5.1-3C21 4 23.1 8 21.6 11.6 19.5 16.4 12 21 12 21z" />
  ) : (
    <I {...p} stroke sw={2} d="M12 20.3s-7-4.3-9-8.8C1.6 8.2 3.6 4.8 7 4.8c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.4 3.4 4 6.7-2 4.5-9 8.8-9 8.8z" />
  );
export const Lyrics = (p) => (
  <I {...p}>
    <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7.6L7.6 21.6c-.6.5-1.6 0-1.6-.8V18H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <path fill="#000" opacity=".55" d="M7.6 8.2c.4-.6 1.7-.7 2 .3.5 1.7-.5 3.6-2.2 4.2l-.3-.6c.8-.4 1.2-1 1.3-1.7-.9 0-1.4-.4-1.4-1 0-.5.2-.9.6-1.2zm5 0c.4-.6 1.7-.7 2 .3.5 1.7-.5 3.6-2.2 4.2l-.3-.6c.8-.4 1.2-1 1.3-1.7-.9 0-1.4-.4-1.4-1 0-.5.2-.9.6-1.2z" />
  </I>
);
export const Queue = (p) => (
  <I {...p} stroke sw={2.2}>
    <path d="M4 6h11M4 12h11M4 18h7" />
    <circle cx="18" cy="17" r="2.6" fill="currentColor" stroke="none" />
    <path d="M20.6 17V7.5l2 .8" />
  </I>
);
export const Shuffle = (p) => (
  <I {...p} stroke sw={2.2}>
    <path d="M3 7h3.5c2 0 3.2 1 4.3 2.8l2.4 4.4C14.3 16 15.5 17 17.5 17H21M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21" />
    <path d="m18.5 4.5 2.5 2.5-2.5 2.5M18.5 14.5l2.5 2.5-2.5 2.5" />
  </I>
);
export const Repeat = ({ one, ...p }) => (
  <I {...p} stroke sw={2.2}>
    <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4" />
    <path d="m17 3 3 3-3 3M7 21l-3-3 3-3" />
    {one && <text x="12" y="14.6" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="800">1</text>}
  </I>
);
export const More = (p) => (
  <I {...p}>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </I>
);
export const MoreVert = (p) => (
  <I {...p}>
    <circle cx="12" cy="5.5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="18.5" r="2" />
  </I>
);
export const LosslessWave = (p) => (
  <I {...p} vb="0 0 24 16" stroke sw={2}>
    <path d="M1.5 8c1.5-5 3.5-5 5 0s3.5 5 5 0 3.5-5 5 0 3.5 5 5 0" />
    <path d="M4 8c1.5-5 3.5-5 5 0s3.5 5 5 0 3.5-5 5 0" opacity=".6" />
  </I>
);
export const CastIcon = (p) => (
  <I {...p} stroke sw={2}>
    <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
    <circle cx="2.5" cy="19.5" r="1" fill="currentColor" stroke="none" />
  </I>
);
export const QueueList = (p) => (
  <I {...p} stroke sw={2.2}>
    <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
    <path d="M9 6h11M9 12h11M9 18h11" />
  </I>
);
export const ChevronDown = (p) => <I {...p} stroke sw={2.6} d="m6 9 6 6 6-6" />;
export const ChevronRight = (p) => <I {...p} stroke sw={2.4} d="m9 6 6 6-6 6" />;
export const Back = (p) => <I {...p} stroke sw={2.6} d="M15 5 8 12l7 7" />;
export const Plus = (p) => <I {...p} stroke sw={2.4} d="M12 5v14M5 12h14" />;
export const Check = (p) => <I {...p} stroke sw={2.6} d="m5 12.5 4.5 4.5L19 7.5" />;
export const Close = (p) => <I {...p} stroke sw={2.4} d="M6 6l12 12M18 6 6 18" />;
export const VolLow = (p) => <I {...p} d="M4 9h3l4.3-3.6c.6-.5 1.7-.1 1.7.8v11.6c0 .9-1 1.3-1.7.8L7 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />;
export const VolHigh = (p) => (
  <I {...p}>
    <path d="M3 9h3l4.3-3.6c.6-.5 1.7-.1 1.7.8v11.6c0 .9-1 1.3-1.7.8L6 15H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </I>
);
export const Airplay = (p) => (
  <I {...p} stroke sw={2}>
    <path d="M7 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    <path d="m12 14 5 6H7z" fill="currentColor" />
  </I>
);
export const Mic = (p) => (
  <I {...p}>
    <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
  </I>
);
export const Star = (p) => <I {...p} d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />;
export const Music = (p) => <I {...p} d="M19 3v12.5a3.5 3.5 0 1 1-2-3.2V7.6l-8 1.8v8.1a3.5 3.5 0 1 1-2-3.2V5.6L19 3z" />;
export const Explicit = () => <span className="explicit">E</span>;
export const Gear = (p) => (
  <I {...p} stroke sw={2}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </I>
);
export const Trash = (p) => <I {...p} stroke sw={2} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />;
export const Clock = (p) => (
  <I {...p} stroke sw={2.2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </I>
);
export const Wave = (p) => (
  <I {...p} stroke sw={2.4}>
    <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4" />
  </I>
);
