import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { art, setCatalogRef } from './api';
import {
  applyCatalogPatch,
  DEFAULT_SITE_CONFIG,
  loadCatalogPatch,
  loadSiteConfigOverride,
  matchesPrivateRoute,
  saveCatalogPatch,
  saveSiteConfigOverride,
} from './utils/studioCore';
import BottomDock, { TopBar } from './components/BottomDock';
import FluidBackground from './components/FluidBackground';
import { Check, Close, Home, Library, Search, User } from './components/Icons';
import NowPlaying from './components/NowPlaying';
import ArtistPage from './pages/Artist';
import HomePage from './pages/Home';
import { AlbumPage, GenrePage, LibraryPage, NotFoundPage, PlaylistPage, ProfilePage, SearchPage } from './pages/OtherPages';
import {
  CatalogProvider,
  LibraryProvider,
  PlayerProvider,
  RouterProvider,
  useCatalog,
  usePlayer,
  useRouter,
  useSiteConfig,
  useToast,
} from './store';

const StudioPanel = lazy(() => import('./pages/StudioPanel'));

function Sidebar({ mobileOpen, onCloseMobile }) {
  const { path, navigate } = useRouter();
  const catalog = useCatalog();
  const siteConfig = useSiteConfig() || DEFAULT_SITE_CONFIG;
  const hiddenSet = useMemo(() => new Set(siteConfig.hiddenGenres || []), [siteConfig.hiddenGenres]);
  const visibleGenres = useMemo(
    () => (catalog.genres || []).filter((g) => !hiddenSet.has(g.id)),
    [catalog.genres, hiddenSet]
  );
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
            <img className="sb-logo-img" src={siteConfig.logoUrl || 'logo.jpg'} alt={siteConfig.siteName} />
            <span>{siteConfig.siteName}</span>
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
          {visibleGenres.map((g) => (
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
  const siteConfig = useSiteConfig() || DEFAULT_SITE_CONFIG;
  const hiddenSet = useMemo(() => new Set(siteConfig.hiddenGenres || []), [siteConfig.hiddenGenres]);
  const visibleGenres = useMemo(
    () => (catalog.genres || []).filter((g) => !hiddenSet.has(g.id)),
    [catalog.genres, hiddenSet]
  );
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="sf-grid">
        <div className="sf-brand-col">
          <button className="top-logo-btn" onClick={() => navigate('/')}>
            <img src={siteConfig.logoUrl || 'logo.jpg'} alt={siteConfig.siteName} />
            <span>{siteConfig.siteName}</span>
          </button>
          <p className="sf-desc">{siteConfig.footerDesc}</p>
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
          {visibleGenres.slice(0, 5).map((g) => (
            <button key={g.id} onClick={() => navigate(`/genre/${g.id}`)}>{g.name}</button>
          ))}
        </div>
        <div className="sf-col">
          <div className="sf-head">More Genres</div>
          {visibleGenres.slice(5).map((g) => (
            <button key={g.id} onClick={() => navigate(`/genre/${g.id}`)}>{g.name}</button>
          ))}
        </div>
      </div>
      <div className="sf-bottom">
        <span>Copyright © {year} {siteConfig.siteName} Personal Edition. All rights reserved.</span>
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
  const toast = useToast();
  if (!toast) return null;
  return (
    <div className={`toast-banner ${toast.type}`} role="status" aria-live="polite">
      {toast.type === 'error' ? <Close size={15} /> : <Check size={15} />}
      <span>{toast.msg}</span>
    </div>
  );
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

function AmbientLayer({ path, isPrivateRoute }) {
  const catalog = useCatalog();
  const player = usePlayer();
  const siteConfig = useSiteConfig() || DEFAULT_SITE_CONFIG;

  useEffect(() => {
    if (player.current && player.playing) return;
    const brand = siteConfig.siteName || 'Apple Music';
    let title = `${brand} — Stream Full-Length Songs & Word-Synced Lyrics`;
    if (isPrivateRoute) title = `Private Console — ${brand}`;
    else if (path === '/search') title = `Browse & Search — ${brand}`;
    else if (path.startsWith('/search/')) title = `Search “${safeDecode(path.slice(8))}” — ${brand}`;
    else if (path === '/library') title = `Your Library — ${brand}`;
    else if (path === '/profile') title = `Listener Profile & Replay — ${brand}`;
    else if (path.startsWith('/artist/')) {
      const a = catalog.artists[safeDecode(path.slice(8))];
      title = `${a?.name || 'Artist'} — ${brand}`;
    } else if (path.startsWith('/genre/')) {
      const g = catalog.genres.find((x) => x.id === safeDecode(path.slice(7)));
      title = `${g?.name || 'Genre'} — ${brand}`;
    }
    document.title = title;
  }, [path, isPrivateRoute, catalog, player.current, player.playing, siteConfig.siteName]);

  if (!player.current || siteConfig.enableFluidBg === false) return null;
  return (
    <div className="ambient-bg" style={{ opacity: siteConfig.fluidIntensity ?? 0.75 }}>
      <FluidBackground
        src={art(player.current.art, 200)}
        speed={0.5}
        dim={0.82}
        paused={!player.playing}
        active={!player.nowOpen}
      />
    </div>
  );
}

function isKnownPublicPath(path) {
  return (
    path === '/' ||
    path.startsWith('/artist/') ||
    path.startsWith('/album/') ||
    path.startsWith('/genre/') ||
    path.startsWith('/playlist/') ||
    path.startsWith('/search') ||
    path === '/library' ||
    path === '/profile'
  );
}

function Shell() {
  const { path } = useRouter();
  const siteConfig = useSiteConfig() || DEFAULT_SITE_CONFIG;
  const [mobileMenu, setMobileMenu] = useState(false);
  const [routeState, setRouteState] = useState({ path: '', isPrivate: false });

  useEffect(() => {
    if (isKnownPublicPath(path)) {
      setRouteState({ path, isPrivate: false });
      return;
    }
    let alive = true;
    matchesPrivateRoute(path).then((ok) => {
      if (alive) setRouteState({ path, isPrivate: ok });
    });
    return () => {
      alive = false;
    };
  }, [path]);

  const isPrivateRoute = routeState.path === path && routeState.isPrivate;
  const checkingPrivate = !isKnownPublicPath(path) && routeState.path !== path;

  if (checkingPrivate) {
    return (
      <div className="app-shell">
        <Sidebar mobileOpen={mobileMenu} onCloseMobile={() => setMobileMenu(false)} />
        <main className="page-scroll">
          <TopBar onOpenMobileMenu={() => setMobileMenu(true)} />
          <div className="page" />
        </main>
        <BottomDock />
        <NowPlaying />
      </div>
    );
  }

  if (siteConfig.maintenanceMode && !isPrivateRoute) {
    return (
      <div className="maintenance-screen">
        <div className="nf-card glass">
          <img className="nf-logo" src={siteConfig.logoUrl || 'logo.jpg'} alt={siteConfig.siteName} />
          <h1>{siteConfig.siteName}</h1>
          <p>{siteConfig.maintenanceMessage || 'We are updating the music catalog. Please check back shortly.'}</p>
        </div>
      </div>
    );
  }

  let page;
  if (isPrivateRoute) {
    page = (
      <Suspense fallback={<div className="page"><div className="subtle-status">Loading console…</div></div>}>
        <StudioPanel />
      </Suspense>
    );
  } else if (path === '/') page = <HomePage />;
  else if (path.startsWith('/artist/')) page = <ArtistPage id={safeDecode(path.slice(8))} />;
  else if (path.startsWith('/album/')) page = <AlbumPage id={safeDecode(path.slice(7))} />;
  else if (path.startsWith('/genre/')) page = <GenrePage id={safeDecode(path.slice(7))} />;
  else if (path.startsWith('/playlist/')) page = <PlaylistPage id={safeDecode(path.slice(10))} />;
  else if (path.startsWith('/search/')) page = <SearchPage initialQuery={safeDecode(path.slice(8))} />;
  else if (path === '/search') page = <SearchPage />;
  else if (path === '/library') page = <LibraryPage />;
  else if (path === '/profile') page = <ProfilePage />;
  else page = <NotFoundPage />;

  return (
    <div className="app-shell">
      <AmbientLayer path={path} isPrivateRoute={isPrivateRoute} />
      <Sidebar mobileOpen={mobileMenu} onCloseMobile={() => setMobileMenu(false)} />
      <main className="page-scroll">
        <TopBar onOpenMobileMenu={() => setMobileMenu(true)} />
        {siteConfig.announcement && !isPrivateRoute && (
          <div className="site-announcement">{siteConfig.announcement}</div>
        )}
        {page}
        {!isPrivateRoute && <SiteFooter />}
      </main>
      <ToastBanner />
      <BottomDock />
      <NowPlaying />
    </div>
  );
}

export default function App() {
  const baseCatalogRef = useRef(null);
  const baseConfigRef = useRef(DEFAULT_SITE_CONFIG);
  const [catalog, setCatalog] = useState(null);
  const [siteConfig, setSiteConfig] = useState(() => ({
    ...DEFAULT_SITE_CONFIG,
    ...(loadSiteConfigOverride() || {}),
  }));
  const [introDone, setIntroDone] = useState(false);

  // Apply dynamic theme CSS variables from siteConfig
  useEffect(() => {
    const root = document.documentElement;
    if (siteConfig.accentColor) root.style.setProperty('--accent', siteConfig.accentColor);
    if (siteConfig.accentColor2) root.style.setProperty('--accent2', siteConfig.accentColor2);
    if (siteConfig.bgColor) root.style.setProperty('--bg', siteConfig.bgColor);
  }, [siteConfig.accentColor, siteConfig.accentColor2, siteConfig.bgColor]);

  const rebuildCatalog = useCallback((base, patch) => {
    const merged = applyCatalogPatch(base, patch);
    setCatalogRef(merged);
    setCatalog(merged);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), 1000);
    Promise.all([
      fetch('data/catalog.json').then((r) => r.json()),
      fetch('data/site-config.json')
        .then((r) => (r.ok ? r.json() : DEFAULT_SITE_CONFIG))
        .catch(() => DEFAULT_SITE_CONFIG),
    ]).then(([c, cfg]) => {
      baseCatalogRef.current = c;
      baseConfigRef.current = { ...DEFAULT_SITE_CONFIG, ...(cfg || {}) };
      const mergedCfg = { ...baseConfigRef.current, ...(loadSiteConfigOverride() || {}) };
      setSiteConfig(mergedCfg);
      if (mergedCfg.enableSplash === false) setIntroDone(true);
      rebuildCatalog(c, loadCatalogPatch());
    });
    return () => clearTimeout(t);
  }, [rebuildCatalog]);

  const adminActions = useMemo(
    () => ({
      upsertSong(song, isNew = false) {
        const patch = loadCatalogPatch();
        patch.deletedSongIds = (patch.deletedSongIds || []).filter((id) => id !== song.id);
        if (isNew || !baseCatalogRef.current?.songs?.[song.id]) {
          patch.addedSongs = { ...(patch.addedSongs || {}), [song.id]: song };
        } else {
          patch.editedSongs = { ...(patch.editedSongs || {}), [song.id]: song };
        }
        saveCatalogPatch(patch);
        rebuildCatalog(baseCatalogRef.current, patch);
      },
      deleteSong(songId) {
        const patch = loadCatalogPatch();
        if (patch.addedSongs?.[songId]) delete patch.addedSongs[songId];
        if (patch.editedSongs?.[songId]) delete patch.editedSongs[songId];
        if (!patch.deletedSongIds.includes(songId)) patch.deletedSongIds.push(songId);
        saveCatalogPatch(patch);
        rebuildCatalog(baseCatalogRef.current, patch);
      },
      upsertArtist(artist) {
        const patch = loadCatalogPatch();
        patch.deletedArtistIds = (patch.deletedArtistIds || []).filter((id) => id !== artist.id);
        patch.editedArtists = { ...(patch.editedArtists || {}), [artist.id]: artist };
        saveCatalogPatch(patch);
        rebuildCatalog(baseCatalogRef.current, patch);
      },
      deleteArtist(artistId) {
        const patch = loadCatalogPatch();
        if (patch.editedArtists?.[artistId]) delete patch.editedArtists[artistId];
        if (!patch.deletedArtistIds.includes(artistId)) patch.deletedArtistIds.push(artistId);
        saveCatalogPatch(patch);
        rebuildCatalog(baseCatalogRef.current, patch);
      },
      updateSiteConfig(nextCfg) {
        saveSiteConfigOverride(nextCfg);
        setSiteConfig(nextCfg);
      },
      replacePatch(nextPatch) {
        saveCatalogPatch(nextPatch);
        rebuildCatalog(baseCatalogRef.current, nextPatch);
      },
      reloadFromBase() {
        setSiteConfig({ ...baseConfigRef.current });
        rebuildCatalog(baseCatalogRef.current, {
          addedSongs: {},
          editedSongs: {},
          deletedSongIds: [],
          editedArtists: {},
          deletedArtistIds: [],
        });
      },
    }),
    [rebuildCatalog]
  );

  if (!catalog) {
    return (
      <div className="splash-opening">
        <div className="splash-glow" />
        <img className="splash-logo-img" src={siteConfig.logoUrl || 'logo.jpg'} alt={siteConfig.siteName} />
        <div className="splash-title">{siteConfig.siteName}</div>
        <div className="splash-sub">{siteConfig.tagline}</div>
      </div>
    );
  }

  return (
    <CatalogProvider value={catalog} adminActions={adminActions} siteConfig={siteConfig}>
      <LibraryProvider>
        <RouterProvider>
          <PlayerProvider>
            {siteConfig.enableSplash !== false && !introDone && (
              <div className="splash-opening fade-out" onClick={() => setIntroDone(true)}>
                <div className="splash-glow" />
                <img className="splash-logo-img" src={siteConfig.logoUrl || 'logo.jpg'} alt={siteConfig.siteName} />
                <div className="splash-title">{siteConfig.siteName}</div>
                <div className="splash-sub">{siteConfig.tagline}</div>
              </div>
            )}
            <Shell />
          </PlayerProvider>
        </RouterProvider>
      </LibraryProvider>
    </CatalogProvider>
  );
}
