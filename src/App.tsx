import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { listen } from '@tauri-apps/api/event';
import { usePlayerStore } from './store/usePlayerStore';
import { musicGateway } from './services/musicGateway';
import { TopSourceBar } from './components/TopSourceBar';
import { FloatingPlayerBar } from './components/FloatingPlayerBar';
import { AmbientLyricStage } from './components/AmbientLyricStage';
import { DesktopLyricOverlay } from './components/DesktopLyricOverlay';
import {
  HuaweiAuthModal,
  ImportAssetsModal,
  CommandPaletteModal,
} from './components/Modals';
import { FavoritesView } from './views/FavoritesView';
import { PlaylistsView } from './views/PlaylistsView';
import { SearchView } from './views/SearchView';
import { HistoryView } from './views/HistoryView';
import { SourcesView } from './views/SourcesView';
import { SettingsView } from './views/SettingsView';

const HARMONY_VIEW_TRANSITION = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 34,
  mass: 0.8,
};

export function App() {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const activeSourceFilter = usePlayerStore((s) => s.activeSourceFilter);
  const toasts = usePlayerStore((s) => s.toasts);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const setDesktopLyricOpen = usePlayerStore((s) => s.setDesktopLyricOpen);
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);
  const setCommandPaletteOpen = usePlayerStore((s) => s.setCommandPaletteOpen);
  const completeHuaweiReauth = usePlayerStore((s) => s.completeHuaweiReauth);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setThemeId = usePlayerStore((s) => s.setThemeId);

  // Listen for native system tray menu events
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }
    const unlisteners: Array<() => void> = [];
    listen('tray-toggle-play', () => {
      usePlayerStore.getState().togglePlay();
    })
      .then((fn) => unlisteners.push(fn))
      .catch(() => {});
    listen('tray-prev-track', () => {
      usePlayerStore.getState().prevTrack();
    })
      .then((fn) => unlisteners.push(fn))
      .catch(() => {});
    listen('tray-next-track', () => {
      usePlayerStore.getState().nextTrack();
    })
      .then((fn) => unlisteners.push(fn))
      .catch(() => {});
    listen('tray-toggle-desktop-lyric', () => {
      const curr = usePlayerStore.getState().isDesktopLyricOpen;
      setDesktopLyricOpen(!curr);
    })
      .then((fn) => unlisteners.push(fn))
      .catch(() => {});

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [prevTrack, nextTrack, setDesktopLyricOpen]);

  // Initialize HarmonyOS Pure Light theme on first desktop launch to match design blueprint
  useEffect(() => {
    try {
      const store = window.localStorage;
      if (store && typeof store.getItem === 'function') {
        if (!store.getItem('future_music_harmony_light_v1')) {
          store.setItem('future_music_harmony_light_v1', '1');
          setThemeId('light');
        }
      }
    } catch {
      // ignore
    }
  }, [setThemeId]);

  // Hydrate persisted library from SQLite (~/.config/future-music/library.db) & discover Huawei session
  useEffect(() => {
    void usePlayerStore.getState().hydrateLibraryFromSqlite();
    musicGateway.fetchHuaweiStatus().then((status) => {
      const uid = status?.snsUserID || status?.snsUserId;
      if (status?.loggedIn && uid) {
        completeHuaweiReauth(`华为账号 · ${uid}`);
        void triggerHuaweiSync();
      }
    });
  }, [completeHuaweiReauth, triggerHuaweiSync]);

  // Global keyboard shortcuts (Ctrl+K Command Palette, Space Play/Pause, Esc Close Stage)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setStageOpen(false);
        setCommandPaletteOpen(false);
      } else if (
        e.code === 'Space' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandPaletteOpen, setStageOpen, togglePlay]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col app-shell-root relative">
      {/* HarmonyOS NEXT Full-Bleed Desktop Stage */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden theme-main-area theme-stage">
        <TopSourceBar />

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 xl:px-12 pt-2 pb-40 md:pb-28">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeNav}-${activeSourceFilter}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={HARMONY_VIEW_TRANSITION}
              className="max-w-[1440px] mx-auto space-y-5 sm:space-y-7"
            >
              {activeNav === 'favorites' && <FavoritesView />}
              {(activeNav === 'local_playlists' ||
                activeNav === 'imported_playlists') && <PlaylistsView />}
              {activeNav === 'search' && <SearchView />}
              {activeNav === 'history' && <HistoryView />}
              {activeNav === 'sources' && <SourcesView />}
              {activeNav === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* HarmonyOS Dual Floating Bottom Capsules (Nav Capsule + Vinyl Mini-Player Capsule) */}
      <div className="theme-main-area">
        <FloatingPlayerBar />
      </div>

      {/* Fullscreen Optical Depth-of-Field Lyric Stage */}
      <AmbientLyricStage />

      {/* Desktop Floating Lyric Overlay */}
      <DesktopLyricOverlay />

      {/* Sheets & Modals */}
      <div className="theme-main-area">
        <HuaweiAuthModal />
        <ImportAssetsModal />
        <CommandPaletteModal />
      </div>

      {/* Toast Notification Stack */}
      <div className="fixed bottom-24 right-8 z-50 flex flex-col gap-2 max-w-xs w-full pointer-events-none theme-main-area">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="px-4 py-3 rounded-[20px] theme-modal backdrop-blur-2xl border pointer-events-auto"
            >
              <div className="text-[13px] font-bold text-white">
                {t.title}
              </div>
              {t.detail && (
                <p className="text-[11.5px] text-white/60 mt-0.5 leading-relaxed">
                  {t.detail}
                </p>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
