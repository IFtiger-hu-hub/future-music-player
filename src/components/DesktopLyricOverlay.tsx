import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { usePlayerStore } from '../store/usePlayerStore';
import {
  DesktopLyricStageContent,
  isTauriRuntime,
  LYRIC_CHANNEL_NAME,
  LyricActionPayload,
  LyricSyncFullPayload,
  LyricSyncTickPayload,
} from './DesktopLyricStandaloneWindow';

/**
 * Mounted in the Main Player Window (`App.tsx`).
 * - In Tauri desktop runtime: manages the independent OS-level `"desktop-lyric"` window
 *   and streams low-frequency drift-syncs to it (the standalone window interpolates 60fps locally).
 * - In browser preview mode: renders an in-page floating preview.
 */
export const DesktopLyricOverlay: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isDesktopLyricOpen);
  const isLocked = usePlayerStore((s) => s.isDesktopLyricLocked);
  const setOpen = usePlayerStore((s) => s.setDesktopLyricOpen);
  const setLocked = usePlayerStore((s) => s.setDesktopLyricLocked);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTimeMs = usePlayerStore((s) => (isOpen ? s.currentTimeMs : 0));
  const lyricOffsetMs = usePlayerStore((s) => s.lyricOffsetMs);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const adjustLyricOffset = usePlayerStore((s) => s.adjustLyricOffset);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastEmittedTimeRef = useRef<number>(-1000);
  const inTauri = isTauriRuntime();

  // 1. Open / Close the native OS-level Tauri window when `isOpen` changes
  useEffect(() => {
    if (!inTauri) return;
    void invoke('set_desktop_lyric_open', {
      open: isOpen,
      locked: isLocked,
    }).catch(() => {});
  }, [inTauri, isOpen]);

  // 2. Sync OS-level click-through (`set_ignore_cursor_events`) when `isLocked` changes
  useEffect(() => {
    if (!inTauri || !isOpen) return;
    void invoke('set_desktop_lyric_locked', { locked: isLocked }).catch(
      () => {}
    );
  }, [inTauri, isOpen, isLocked]);

  // 3. Set up cross-window BroadcastChannel + Tauri event listeners for actions from the OS lyric window
  useEffect(() => {
    const handleAction = (payload: LyricActionPayload) => {
      if (!payload || typeof payload !== 'object') return;
      const st = usePlayerStore.getState();
      switch (payload.action) {
        case 'request-sync': {
          const fullPayload: LyricSyncFullPayload = {
            kind: 'full',
            track: st.currentTrack,
            currentTimeMs: st.currentTimeMs,
            lyricOffsetMs: st.lyricOffsetMs,
            isPlaying: st.isPlaying,
            isLocked: st.isDesktopLyricLocked,
          };
          try {
            channelRef.current?.postMessage(fullPayload);
          } catch {
            // ignore
          }
          if (inTauri) {
            void emit('desktop-lyric-sync', fullPayload);
          }
          break;
        }
        case 'toggle-play':
          st.togglePlay();
          break;
        case 'prev':
          st.prevTrack();
          break;
        case 'next':
          st.nextTrack();
          break;
        case 'offset':
          if (typeof payload.value === 'number') {
            st.adjustLyricOffset(payload.value);
          }
          break;
        case 'lock':
          if (typeof payload.value === 'boolean') {
            st.setDesktopLyricLocked(payload.value);
          }
          break;
        case 'close':
          st.setDesktopLyricOpen(false);
          break;
      }
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(LYRIC_CHANNEL_NAME);
      channelRef.current = bc;
      bc.onmessage = (ev) => {
        if (ev.data && typeof ev.data.action === 'string') {
          handleAction(ev.data as LyricActionPayload);
        }
      };
    }

    const unlisteners: Array<() => void> = [];
    if (inTauri) {
      listen<LyricActionPayload>('desktop-lyric-action', (ev) => {
        handleAction(ev.payload);
      })
        .then((fn) => unlisteners.push(fn))
        .catch(() => {});

      listen('desktop-lyric-closed', () => {
        usePlayerStore.getState().setDesktopLyricOpen(false);
      })
        .then((fn) => unlisteners.push(fn))
        .catch(() => {});

      listen('tray-toggle-desktop-lyric-lock', () => {
        const currLocked = usePlayerStore.getState().isDesktopLyricLocked;
        usePlayerStore.getState().setDesktopLyricLocked(!currLocked);
      })
        .then((fn) => unlisteners.push(fn))
        .catch(() => {});
    }

    return () => {
      bc?.close();
      channelRef.current = null;
      unlisteners.forEach((fn) => fn());
    };
  }, [inTauri]);

  // 4. Broadcast full track + lyrics snapshot whenever track or playback flags change
  useEffect(() => {
    if (!isOpen) return;
    const nowTime = usePlayerStore.getState().currentTimeMs;
    lastEmittedTimeRef.current = nowTime;
    const fullPayload: LyricSyncFullPayload = {
      kind: 'full',
      track: currentTrack,
      currentTimeMs: nowTime,
      lyricOffsetMs,
      isPlaying,
      isLocked,
    };
    try {
      channelRef.current?.postMessage(fullPayload);
    } catch {
      // ignore
    }
    if (inTauri) {
      void emit('desktop-lyric-sync', fullPayload);
    }
  }, [
    inTauri,
    isOpen,
    currentTrack,
    currentTrack.lyrics,
    lyricOffsetMs,
    isPlaying,
    isLocked,
  ]);

  // 5. Throttle drift-sync ticks to >=400ms so IPC never floods memory
  useEffect(() => {
    if (!isOpen) return;
    if (Math.abs(currentTimeMs - lastEmittedTimeRef.current) < 400) {
      return;
    }
    lastEmittedTimeRef.current = currentTimeMs;
    const tickPayload: LyricSyncTickPayload = {
      kind: 'tick',
      currentTimeMs,
      lyricOffsetMs,
      isPlaying,
      isLocked,
    };
    try {
      channelRef.current?.postMessage(tickPayload);
    } catch {
      // ignore
    }
    if (inTauri) {
      void emit('desktop-lyric-tick', tickPayload);
    }
  }, [inTauri, isOpen, currentTimeMs, lyricOffsetMs, isPlaying, isLocked]);

  if (inTauri) {
    return null;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          drag={!isLocked}
          dragMomentum={false}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] min-w-[360px] max-w-[min(88vw,820px)]"
        >
          <DesktopLyricStageContent
            track={currentTrack}
            currentTimeMs={currentTimeMs}
            lyricOffsetMs={lyricOffsetMs}
            isPlaying={isPlaying}
            isLocked={isLocked}
            isStandaloneWindow={false}
            onTogglePlay={togglePlay}
            onPrev={prevTrack}
            onNext={nextTrack}
            onAdjustOffset={adjustLyricOffset}
            onToggleLock={setLocked}
            onClose={() => setOpen(false)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
