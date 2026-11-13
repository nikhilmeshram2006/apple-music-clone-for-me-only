import { useEffect, useState } from 'react';
import { art, setCatalogRef } from './api';
import BottomDock, { TopBar } from './components/BottomDock';
import FluidBackground from './components/FluidBackground';
import { Check, Close, Home, Library, Search, User } from './components/Icons';
import NowPlaying from './components/NowPlaying';
import ArtistPage from './pages/Artist';
import HomePage from './pages/Home';
import { AlbumPage, GenrePage, LibraryPage, NotFoundPage, PlaylistPage, ProfilePage, SearchPage } from './pages/OtherPages';
import { CatalogProvider, LibraryProvider, PlayerProvider, RouterProvider, useCatalog, useLibrary, usePlayer, useRouter } from './store';

function Sidebar({ mobileOpen, onCloseMobile }) {
  const { path, navigate } = useRouter();
  const catalog = useCatalog();
  const nav = (p) => {
    navigate(p);
    onCloseMobile?.();
  };

  return (
    <>
      {mobileOpen && <div className="mobile-drawer-backdrop" onClick={onCloseMobile} />}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sb-top-row">
          <div className="sb-brand" onClick={() => nav('/')}>
            <img className="sb-logo-img" src="logo.jpg" alt="Apple Music" />
            <span>apple music</span>
          </div>
          <button className="sb-close-mobile icon-btn" onClick={onCloseMobile} aria-label="Close menu">
            <Close size={18} />
          </button>
        </div>

        <div className="sb-group">
          <button className={path === '/' ? 'on' : ''} onClick={() => nav('/')}><Home size={18} /> Home</button>
          <button className={path.startsWith('/search') ? 'on' : ''} onClick={() => nav('/search')}><Search size={18} /> Browse</button>
          <button className={path.startsWith('/library') ? 'on' : ''} onClick={() => nav('/library')}><Library size={18} /> Library</button>
          <button className={path.startsWith('/profile') ? 'on' : ''} onClick={() => nav('/profile')}><User size={18} /> Profile</button>
        </div>

        <div className="sb-group">
          <div className="sb-head">Genres</div>
          {catalog.genres.map((g) => (
            <button
              key={g.id}
              className={path === `/genre/${g.id}` ? 'on' : ''}
              onClick={() => nav(`/genre/${g.id}`)}
            >
              <span className="g-dot" style={{ background: g.colors[0] }} />
              {g.name}
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function SiteFooter() {
  const { navigate } = useRouter();
  const catalog = useCatalog();
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="sf-grid">
        <div className="sf-brand-col">
          <button className="top-logo-btn" onClick={() => navigate('/')}>
            <img src="logo.jpg" alt="Apple Music" />
            <span>apple music</span>
          </button>
          <p className="sf-desc">
            Personal full-length 320 kbps streaming experience with word-by-word synchronized karaoke lyrics and animated motion artwork.
          </p>
        </div>
        <div className="sf-col">
          <div className="sf-head">Navigation</div>
          <button onClick={() => navigate('/')}>Home</button>
          <button onClick={() => navigate('/search')}>Browse & Search</button>
          <button onClick={() => navigate('/library')}>Your Library</button>
          <button onClick={() => navigate('/profile')}>Listener Profile</button>
        </div>
        <div className="sf-col">
          <div className="sf-head">Top Genres</div>
          {catalog.genres.slice(0, 5).map((g) => (
            <button key={g.id} onClick={() => navigate(`/genre/${g.id}`)}>{g.name}</button>
          ))}
        </div>
        <div className="sf-col">
          <div className="sf-head">More Genres</div>
          {catalog.genres.slice(5).map((g) => (
            <button key={g.id} onClick={() => navigate(`/genre/${g.id}`)}>{g.name}</button>
          ))}
        </div>
      </div>
      <div className="sf-bottom">
        <span>Copyright © {year} Apple Music Personal Edition. All rights reserved.</span>
        <div className="sf-links">
          <button onClick={() => navigate('/')}>Home</button>
          <span>·</span>
          <button onClick={() => navigate('/library')}>Favorites</button>
          <span>·</span>
          <button onClick={() => navigate('/profile')}>Audio Settings</button>
        </div>
      </div>
    </footer>
  );
}

function ToastBanner() {
  const { toast } = useLibrary();
  if (!toast) return null;
  return (
    <div className={`toast-banner ${toast.type}`} role="status" aria-live="polite">
      {toast.type === 'error' ? <Close size={15} /> : <Check size={15} />}
      <span>{toast.msg}</span>
    </div>
  );
}

function Shell() {
  const { path } = useRouter();
  const catalog = useCatalog();
  const player = usePlayer();
  const [mobileMenu, setMobileMenu] = useState(false);

  // Dynamic page titles & meta descriptions per route
  useEffect(() => {
    if (player.current && player.playing) return;
    let title = 'Apple Music — Stream Full-Length Songs & Word-Synced Lyrics';
    if (path === '/search') title = 'Browse & Search — Apple Music';
    else if (path.startsWith('/search/')) title = `Search “${decodeURIComponent(path.slice(8))}” — Apple Music`;
    else if (path === '/library') title = 'Your Library — Apple Music';
    else if (path === '/profile') title = 'Listener Profile & Replay — Apple Music';
    else if (path.startsWith('/artist/')) {
      const a = catalog.artists[decodeURIComponent(path.slice(8))];
      title = `${a?.name || 'Artist'} — Apple Music`;
    } else if (path.startsWith('/genre/')) {
      const g = catalog.genres.find((x) => x.id === decodeURIComponent(path.slice(7)));
      title = `${g?.name || 'Genre'} — Apple Music`;
    }
    document.title = title;
  }, [path, catalog, player.current, player.playing]);

  let page;
  if (path === '/') page = <HomePage />;
  else if (path.startsWith('/artist/')) page = <ArtistPage id={decodeURIComponent(path.slice(8))} />;
  else if (path.startsWith('/album/')) page = <AlbumPage id={decodeURIComponent(path.slice(7))} />;
  else if (path.startsWith('/genre/')) page = <GenrePage id={decodeURIComponent(path.slice(7))} />;
  else if (path.startsWith('/playlist/')) page = <PlaylistPage id={decodeURIComponent(path.slice(10))} />;
  else if (path.startsWith('/search/')) page = <SearchPage initialQuery={decodeURIComponent(path.slice(8))} />;
  else if (path === '/search') page = <SearchPage />;
  else if (path === '/library') page = <LibraryPage />;
  else if (path === '/profile') page = <ProfilePage />;
  else page = <NotFoundPage />;

  return (
    <div className="app-shell">
      {player.current && (
        <div className="ambient-bg">
          <FluidBackground src={art(player.current.art, 200)} speed={0.5} dim={0.82} paused={!player.playing} />
        </div>
      )}
      <Sidebar mobileOpen={mobileMenu} onCloseMobile={() => setMobileMenu(false)} />
      <main className="page-scroll">
        <TopBar onOpenMobileMenu={() => setMobileMenu(true)} />
        {page}
        <SiteFooter />
      </main>
      <ToastBanner />
      <BottomDock />
      <NowPlaying />
    </div>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), 1000);
    fetch('data/catalog.json')
      .then((r) => r.json())
      .then((c) => {
        setCatalogRef(c);
        setCatalog(c);
      });
    return () => clearTimeout(t);
  }, []);

  if (!catalog) {
    return (
      <div className="splash-opening">
        <div className="splash-glow" />
        <img className="splash-logo-img" src="logo.jpg" alt="Apple Music" />
        <div className="splash-title">apple music</div>
        <div className="splash-sub">Lossless · Word-Synced Lyrics · Animated Motion</div>
      </div>
    );
  }

  return (
    <CatalogProvider value={catalog}>
      <LibraryProvider>
        <RouterProvider>
          <PlayerProvider>
            {!introDone && (
              <div className="splash-opening fade-out" onClick={() => setIntroDone(true)}>
                <div className="splash-glow" />
                <img className="splash-logo-img" src="logo.jpg" alt="Apple Music" />
                <div className="splash-title">apple music</div>
                <div className="splash-sub">Lossless · Word-Synced Lyrics · Animated Motion</div>
              </div>
            )}
            <Shell />
          </PlayerProvider>
        </RouterProvider>
      </LibraryProvider>
    </CatalogProvider>
  );
}
