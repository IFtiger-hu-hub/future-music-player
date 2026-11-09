import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  Lock,
  Unlock,
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Palette,
  Type,
  Move,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { CanonicalTrack } from '../types/music';
import {
  buildLyricRenderSegments,
  computeGlyphKaraokeState,
  findActiveLyricIndex,
} from '../utils/lyricUtils';

interface LyricPalette {
  id: string;
  label: string;
  sungColor: string;
  glowColor: string;
  upcomingColor: string;
}

const LYRIC_PALETTES: LyricPalette[] = [
  {
    id: 'gold',
    label: '流光金',
    sungColor: '#FCE3B4',
    glowColor: 'rgba(245, 208, 138, 0.55)',
    upcomingColor: 'rgba(255, 255, 255, 0.52)',
  },
  {
    id: 'crimson',
    label: '鸿蒙红',
    sungColor: '#FF5E69',
    glowColor: 'rgba(250, 45, 72, 0.55)',
    upcomingColor: 'rgba(255, 255, 255, 0.52)',
  },
  {
    id: 'cyan',
    label: '极光青',
    sungColor: '#67E8F9',
    glowColor: 'rgba(34, 211, 238, 0.55)',
    upcomingColor: 'rgba(255, 255, 255, 0.52)',
  },
  {
    id: 'pure',
    label: '纯臻白',
    sungColor: '#FFFFFF',
    glowColor: 'rgba(255, 255, 255, 0.5)',
    upcomingColor: 'rgba(255, 255, 255, 0.45)',
  },
];

const FONT_SIZES = [20, 24, 28] as const;
const LYRIC_CHANNEL_NAME = 'future_music_desktop_lyric_v1';

interface LyricSyncFullPayload {
  kind: 'full';
  track: CanonicalTrack;
  currentTimeMs: number;
  lyricOffsetMs: number;
  isPlaying: boolean;
  isLocked: boolean;
}

interface LyricSyncTickPayload {
  kind: 'tick';
  currentTimeMs: number;
  lyricOffsetMs: number;
  isPlaying: boolean;
  isLocked: boolean;
}

interface LyricActionPayload {
  action:
    | 'request-sync'
    | 'toggle-play'
    | 'prev'
    | 'next'
    | 'offset'
    | 'lock'
    | 'close';
  value?: number | boolean;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Shared visual renderer for the desktop lyric bar (used both by the OS-level
 * standalone Tauri window and the browser fallback preview).
 */
const DesktopLyricStageContent: React.FC<{
  track: CanonicalTrack;
  currentTimeMs: number;
  lyricOffsetMs: number;
  isPlaying: boolean;
  isLocked: boolean;
  isStandaloneWindow: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAdjustOffset: (deltaMs: number) => void;
  onToggleLock: (locked: boolean) => void;
  onClose: () => void;
  onStartWindowDrag?: (e: React.MouseEvent) => void;
}> = ({
  track,
  currentTimeMs,
  lyricOffsetMs,
  isPlaying,
  isLocked,
  isStandaloneWindow,
  onTogglePlay,
  onPrev,
  onNext,
  onAdjustOffset,
  onToggleLock,
  onClose,
  onStartWindowDrag,
}) => {
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [fontSizeIdx, setFontSizeIdx] = useState(1);

  const palette = LYRIC_PALETTES[paletteIdx] || LYRIC_PALETTES[0];
  const mainFontSize = FONT_SIZES[fontSizeIdx] || 24;

  const effectiveTimeMs = Math.max(0, currentTimeMs + lyricOffsetMs);
  const activeIdx = findActiveLyricIndex(track.lyrics, effectiveTimeMs);
  const activeLine =
    activeIdx >= 0 ? track.lyrics[activeIdx] : track.lyrics[0];
  const nextLine =
    activeIdx >= 0 && activeIdx + 1 < track.lyrics.length
      ? track.lyrics[activeIdx + 1]
      : undefined;

  const segments = useMemo(
    () => (activeLine ? buildLyricRenderSegments(activeLine) : []),
    [activeLine]
  );

  if (!activeLine) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (isLocked) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        onStartWindowDrag?.(e);
      }}
      className={`relative w-full max-w-[820px] px-7 py-3.5 rounded-[24px] transition-all duration-200 select-none group ${
        isLocked
          ? 'bg-transparent border border-transparent pointer-events-none'
          : isStandaloneWindow
          ? 'bg-black/15 hover:bg-[#12131A]/82 border border-transparent hover:border-white/15 hover:backdrop-blur-xl hover:shadow-[0_14px_40px_rgba(0,0,0,0.55)] cursor-move pointer-events-auto'
          : 'bg-[#14151B]/90 border border-white/15 backdrop-blur-2xl shadow-[0_18px_52px_rgba(0,0,0,0.55)] cursor-move pointer-events-auto'
      }`}
    >
      {/* Top Floating Controls Bar (appears on hover when unlocked) */}
      <div
        className={`absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/95 border border-white/15 shadow-lg transition-opacity z-20 ${
          isLocked
            ? 'pointer-events-auto opacity-0 group-hover:opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {!isLocked && (
          <>
            <span
              className="flex items-center gap-1 text-[10px] !text-white/50 pr-1"
              title="按住歌词区域即可任意拖动到屏幕任意位置"
            >
              <Move className="w-3 h-3" />
            </span>

            <button
              onClick={onPrev}
              title="上一首"
              className="p-1 rounded-full hover:bg-white/15 !text-white/80 hover:!text-white cursor-pointer"
            >
              <SkipBack className="w-3 h-3 fill-current" />
            </button>
            <button
              onClick={onTogglePlay}
              title={isPlaying ? '暂停' : '播放'}
              className="p-1 rounded-full bg-white/15 hover:bg-white/25 !text-white cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-3 h-3 fill-current" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
            </button>
            <button
              onClick={onNext}
              title="下一首"
              className="p-1 rounded-full hover:bg-white/15 !text-white/80 hover:!text-white cursor-pointer"
            >
              <SkipForward className="w-3 h-3 fill-current" />
            </button>

            <span className="w-px h-3 bg-white/15 mx-0.5" />

            <button
              onClick={() => onAdjustOffset(-200)}
              title="歌词提前 0.2s"
              className="px-1.5 py-0.5 rounded-full hover:bg-white/15 text-[10px] font-mono-tabular !text-white/75 hover:!text-white cursor-pointer"
            >
              -0.2s
            </button>
            <button
              onClick={() => onAdjustOffset(200)}
              title="歌词延后 0.2s"
              className="px-1.5 py-0.5 rounded-full hover:bg-white/15 text-[10px] font-mono-tabular !text-white/75 hover:!text-white cursor-pointer"
            >
              +0.2s
            </button>

            <span className="w-px h-3 bg-white/15 mx-0.5" />

            <button
              onClick={() =>
                setPaletteIdx((i) => (i + 1) % LYRIC_PALETTES.length)
              }
              title={`切换歌词配色 (${palette.label})`}
              className="px-1.5 py-0.5 rounded-full hover:bg-white/15 text-[10px] !text-white/85 flex items-center gap-1 cursor-pointer"
            >
              <Palette
                className="w-3 h-3"
                style={{ color: palette.sungColor }}
              />
              <span>{palette.label}</span>
            </button>

            <button
              onClick={() =>
                setFontSizeIdx((i) => (i + 1) % FONT_SIZES.length)
              }
              title="切换桌面歌词字号"
              className="p-1 rounded-full hover:bg-white/15 !text-white/80 hover:!text-white cursor-pointer"
            >
              <Type className="w-3 h-3" />
            </button>

            <span className="w-px h-3 bg-white/15 mx-0.5" />
          </>
        )}

        <button
          onClick={() => onToggleLock(!isLocked)}
          title={
            isLocked
              ? '解锁桌面歌词'
              : '锁定并开启系统级鼠标穿透（可通过托盘图标或播放器主界面解锁）'
          }
          className="px-2 py-0.5 rounded-full hover:bg-white/15 text-[10px] !text-white flex items-center gap-1 cursor-pointer"
        >
          {isLocked ? (
            <>
              <Lock className="w-3 h-3 text-amber-400" />
              <span>已锁定穿透 · 点击解锁</span>
            </>
          ) : (
            <>
              <Unlock className="w-3 h-3 text-emerald-400" />
              <span>锁定穿透</span>
            </>
          )}
        </button>

        {!isLocked && (
          <button
            onClick={onClose}
            title="关闭桌面歌词"
            className="p-1 rounded-full hover:bg-white/15 !text-white/75 hover:!text-white cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Romanization / Cantonese Jyutping */}
      {activeLine.romanization && (
        <div
          style={{
            textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.7)',
          }}
          className="text-center text-[12px] font-mono-tabular !text-amber-200/95 tracking-wide mb-0.5"
        >
          {activeLine.romanization}
        </div>
      )}

      {/* Word-by-Word Continuous Karaoke Sweep Line (Zero mid-word breaks!) */}
      <div
        style={{
          fontSize: `${mainFontSize}px`,
          WebkitTextStroke: '0.6px rgba(0, 0, 0, 0.55)',
        }}
        className="text-center font-extrabold leading-[1.34] tracking-normal"
      >
        {segments.length > 0 ? (
          segments.map((seg, sIdx) => {
            if (seg.kind === 'space') {
              return (
                <span key={sIdx} className="inline whitespace-pre">
                  {' '}
                </span>
              );
            }
            return (
              <span
                key={sIdx}
                className={
                  seg.nowrap ? 'inline-block whitespace-nowrap' : 'inline'
                }
              >
                {seg.glyphs.map((g, gIdx) => {
                  const { state, progress } = computeGlyphKaraokeState(
                    g.startMs,
                    g.endMs,
                    effectiveTimeMs
                  );

                  if (state === 'passed') {
                    return (
                      <span
                        key={gIdx}
                        style={{
                          color: palette.sungColor,
                          textShadow: `0 0 14px ${palette.glowColor}, 0 2px 6px rgba(0,0,0,0.92)`,
                        }}
                      >
                        {g.text}
                      </span>
                    );
                  }

                  if (state === 'upcoming') {
                    return (
                      <span
                        key={gIdx}
                        style={{
                          color: palette.upcomingColor,
                          textShadow:
                            '0 2px 6px rgba(0,0,0,0.92), 0 0 3px rgba(0,0,0,0.85)',
                        }}
                      >
                        {g.text}
                      </span>
                    );
                  }

                  const pct = Math.round(progress * 100);
                  const featherEnd = Math.min(100, pct + 16);
                  return (
                    <span
                      key={gIdx}
                      style={{
                        backgroundImage: `linear-gradient(90deg, ${palette.sungColor} 0%, ${palette.sungColor} ${pct}%, ${palette.upcomingColor} ${featherEnd}%, ${palette.upcomingColor} 100%)`,
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        color: 'transparent',
                        filter: `drop-shadow(0 2px 5px rgba(0,0,0,0.9)) drop-shadow(0 0 8px ${palette.glowColor})`,
                      }}
                    >
                      {g.text}
                    </span>
                  );
                })}
              </span>
            );
          })
        ) : (
          <span
            style={{
              color: palette.sungColor,
              textShadow: `0 0 14px ${palette.glowColor}, 0 2px 8px rgba(0,0,0,0.92)`,
            }}
          >
            {activeLine.text}
          </span>
        )}
      </div>

      {/* Secondary Line: Translation or Next Lyric Line Preview */}
      {activeLine.translation ? (
        <div
          style={{
            textShadow: '0 1px 5px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.8)',
          }}
          className="text-center text-[13.5px] !text-white/90 mt-1 font-semibold truncate max-w-[740px] mx-auto"
        >
          {activeLine.translation}
        </div>
      ) : nextLine ? (
        <div
          style={{
            textShadow: '0 1px 5px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.8)',
          }}
          className="text-center text-[13px] !text-white/60 mt-1 font-medium truncate max-w-[700px] mx-auto"
        >
          {nextLine.text}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Standalone OS-level Desktop Lyric Window root component.
 * Rendered when `?window=desktop-lyric` is loaded in the borderless transparent Always-on-Top Tauri window.
 */
export const DesktopLyricStandaloneWindow: React.FC = () => {
  const defaultTrack = usePlayerStore((s) => s.currentTrack);
  const [track, setTrack] = useState<CanonicalTrack>(defaultTrack);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastSyncRef = useRef<{ baseTimeMs: number; perfNow: number }>({
    baseTimeMs: 0,
    perfNow: performance.now(),
  });

  const dispatchAction = (payload: LyricActionPayload) => {
    try {
      channelRef.current?.postMessage(payload);
    } catch {
      // ignore
    }
    if (isTauriRuntime()) {
      void emit('desktop-lyric-action', payload);
    }
  };

  useEffect(() => {
    const applyFull = (data: LyricSyncFullPayload) => {
      if (data.track) setTrack(data.track);
      setCurrentTimeMs(data.currentTimeMs);
      setLyricOffsetMs(data.lyricOffsetMs);
      setIsPlaying(data.isPlaying);
      setIsLocked(data.isLocked);
      lastSyncRef.current = {
        baseTimeMs: data.currentTimeMs,
        perfNow: performance.now(),
      };
    };

    const applyTick = (data: LyricSyncTickPayload) => {
      setCurrentTimeMs(data.currentTimeMs);
      setLyricOffsetMs(data.lyricOffsetMs);
      setIsPlaying(data.isPlaying);
      setIsLocked(data.isLocked);
      lastSyncRef.current = {
        baseTimeMs: data.currentTimeMs,
        perfNow: performance.now(),
      };
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(LYRIC_CHANNEL_NAME);
      channelRef.current = bc;
      bc.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.kind === 'full') applyFull(msg as LyricSyncFullPayload);
        else if (msg.kind === 'tick') applyTick(msg as LyricSyncTickPayload);
      };
    }

    const unlisteners: Array<() => void> = [];
    if (isTauriRuntime()) {
      listen<LyricSyncFullPayload>('desktop-lyric-sync', (ev) => {
        applyFull(ev.payload);
      })
        .then((fn) => unlisteners.push(fn))
        .catch(() => {});

      listen<LyricSyncTickPayload>('desktop-lyric-tick', (ev) => {
        applyTick(ev.payload);
      })
        .then((fn) => unlisteners.push(fn))
        .catch(() => {});

      listen<boolean>('desktop-lyric-lock-changed', (ev) => {
        setIsLocked(Boolean(ev.payload));
      })
        .then((fn) => unlisteners.push(fn))
        .catch(() => {});
    }

    // Request initial state immediately & with short retries
    dispatchAction({ action: 'request-sync' });
    const t1 = window.setTimeout(
      () => dispatchAction({ action: 'request-sync' }),
      120
    );
    const t2 = window.setTimeout(
      () => dispatchAction({ action: 'request-sync' }),
      450
    );

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      bc?.close();
      channelRef.current = null;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Local 60fps interpolation between IPC ticks so karaoke sweep is silk-smooth
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const step = () => {
      const elapsed = performance.now() - lastSyncRef.current.perfNow;
      if (elapsed >= 16 && elapsed < 250) {
        setCurrentTimeMs(Math.floor(lastSyncRef.current.baseTimeMs + elapsed));
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-transparent px-3 pt-4 pb-1 select-none overflow-hidden">
      <DesktopLyricStageContent
        track={track}
        currentTimeMs={currentTimeMs}
        lyricOffsetMs={lyricOffsetMs}
        isPlaying={isPlaying}
        isLocked={isLocked}
        isStandaloneWindow={true}
        onTogglePlay={() => dispatchAction({ action: 'toggle-play' })}
        onPrev={() => dispatchAction({ action: 'prev' })}
        onNext={() => dispatchAction({ action: 'next' })}
        onAdjustOffset={(delta) =>
          dispatchAction({ action: 'offset', value: delta })
        }
        onToggleLock={(locked) => {
          setIsLocked(locked);
          dispatchAction({ action: 'lock', value: locked });
          if (isTauriRuntime()) {
            void invoke('set_desktop_lyric_locked', { locked });
          }
        }}
        onClose={() => {
          dispatchAction({ action: 'close' });
          if (isTauriRuntime()) {
            void invoke('set_desktop_lyric_open', {
              open: false,
              locked: isLocked,
            });
          }
        }}
        onStartWindowDrag={() => {
          if (isTauriRuntime()) {
            void invoke('start_desktop_lyric_dragging');
          }
        }}
      />
    </div>
  );
};

/**
 * Mounted in the Main Player Window (`App.tsx`).
 * - In Tauri desktop runtime: manages the independent OS-level `"desktop-lyric"` window
 *   and streams 60fps lyric state to it (does NOT render an in-app overlay inside the player window).
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
  const inTauri = isTauriRuntime();

  // 1. Open / Close the native OS-level Tauri window when `isOpen` changes
  useEffect(() => {
    if (!inTauri) return;
    void invoke('set_desktop_lyric_open', {
      open: isOpen,
      locked: isLocked,
    }).catch(() => {});
  }, [inTauri, isOpen, isLocked]);

  // 2. Sync OS-level click-through (`set_ignore_cursor_events`) when `isLocked` changes
  useEffect(() => {
    if (!inTauri) return;
    void invoke('set_desktop_lyric_locked', { locked: isLocked }).catch(
      () => {}
    );
  }, [inTauri, isLocked]);

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
    const fullPayload: LyricSyncFullPayload = {
      kind: 'full',
      track: currentTrack,
      currentTimeMs: usePlayerStore.getState().currentTimeMs,
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

  // 5. Broadcast high-frequency playback timestamps while `isOpen` is true
  useEffect(() => {
    if (!isOpen) return;
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

  // In native Tauri desktop app, the lyric lives in its own OS-level window on the desktop,
  // NEVER trapped inside the main player window!
  if (inTauri) {
    return null;
  }

  // Browser-only fallback preview (when running `pnpm dev` in a web browser)
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
