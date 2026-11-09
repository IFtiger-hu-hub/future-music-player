import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePlayerStore } from './store/usePlayerStore';
import { musicGateway } from './services/musicGateway';
import { Sidebar } from './components/Sidebar';
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

const FLCLASH_VIEW_TRANSITION = {
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
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);
  const setCommandPaletteOpen = usePlayerStore((s) => s.setCommandPaletteOpen);
  const completeHuaweiReauth = usePlayerStore((s) => s.completeHuaweiReauth);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);

  // Auto-discover persisted Huawei Music session on startup
  useEffect(() => {
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
      {/* Main macOS Apple Music Window Split */}
      <div className="flex-1 flex min-h-0 overflow-hidden theme-main-area">
        {/* Left Apple Music Translucent Vibrancy Sidebar */}
        <Sidebar />

        {/* Right Main Content Stage */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden theme-stage">
          <TopSourceBar />

          <main className="flex-1 overflow-y-auto px-9 pt-6 pb-28">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeNav}-${activeSourceFilter}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={FLCLASH_VIEW_TRANSITION}
                className="max-w-5xl mx-auto space-y-8"
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
      </div>

      {/* Bottom Apple Music Frosted Glass Player Bar (with real <audio> & Web Audio EQ engine) */}
      <div className="theme-main-area">
        <FloatingPlayerBar />
      </div>

      {/* Fullscreen Apple Music Optical Depth-of-Field Lyric Stage */}
      <AmbientLyricStage />

      {/* Desktop Floating Lyric Overlay */}
      <DesktopLyricOverlay />

      {/* Sheets & Modals */}
      <div className="theme-main-area">
        <HuaweiAuthModal />
        <ImportAssetsModal />
        <CommandPaletteModal />
      </div>

      {/* Subtle Apple Music Toast Pill Stack */}
      <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 max-w-xs w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="px-4 py-3 rounded-2xl bg-[#242426]/95 backdrop-blur-2xl border border-white/[0.1] shadow-[0_16px_40px_rgba(0,0,0,0.55)] pointer-events-auto"
            >
              <div className="text-[13px] font-semibold text-white">
                {t.title}
              </div>
              {t.detail && (
                <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed">
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
