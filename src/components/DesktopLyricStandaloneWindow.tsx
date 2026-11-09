import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { CanonicalTrack } from '../types/music';
import {
  buildLyricRenderSegments,
  computeGlyphKaraokeState,
  findActiveLyricIndex,
} from '../utils/lyricUtils';

export interface LyricPalette {
  id: string;
  label: string;
  sungColor: string;
  glowColor: string;
  upcomingColor: string;
}

export const LYRIC_PALETTES: LyricPalette[] = [
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

export const FONT_SIZES = [20, 24, 28] as const;
export const LYRIC_CHANNEL_NAME = 'future_music_desktop_lyric_v1';

export interface LyricSyncFullPayload {
  kind: 'full';
  track: CanonicalTrack;
  currentTimeMs: number;
  lyricOffsetMs: number;
  isPlaying: boolean;
  isLocked: boolean;
}

export interface LyricSyncTickPayload {
  kind: 'tick';
  currentTimeMs: number;
  lyricOffsetMs: number;
  isPlaying: boolean;
  isLocked: boolean;
}

export interface LyricActionPayload {
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

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const DesktopLyricStageContent: React.FC<{
  track: CanonicalTrack | null;
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

  const lyrics = track?.lyrics || [];
  const effectiveTimeMs = Math.max(0, currentTimeMs + lyricOffsetMs);
  const activeIdx = findActiveLyricIndex(lyrics, effectiveTimeMs);
  const activeLine =
    activeIdx >= 0
      ? lyrics[activeIdx]
      : lyrics[0] || {
          timeMs: 0,
          endMs: 5000,
          text: track ? `${track.title} - ${track.artists.join(' / ')}` : 'Future Music · 桌面歌词',
        };
  const nextLine =
    activeIdx >= 0 && activeIdx + 1 < lyrics.length
      ? lyrics[activeIdx + 1]
      : undefined;

  const segments = useMemo(
    () => (activeLine ? buildLyricRenderSegments(activeLine) : []),
    [activeLine]
  );

  return (
    <div
      onMouseDown={(e) => {
        if (isLocked) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        onStartWindowDrag?.(e);
      }}
      className={`relative w-full max-w-[820px] px-7 py-3.5 rounded-[24px] transition-colors duration-150 select-none group ${
        isLocked
          ? 'bg-transparent border border-transparent pointer-events-none'
          : isStandaloneWindow
          ? 'bg-black/15 hover:bg-[#12131A]/85 border border-transparent hover:border-white/15 cursor-move pointer-events-auto'
          : 'bg-[#14151B]/90 border border-white/15 shadow-[0_18px_52px_rgba(0,0,0,0.55)] cursor-move pointer-events-auto'
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
              title="按住歌词区域即可拖动到屏幕任意位置"
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

export const DesktopLyricStandaloneWindow: React.FC = () => {
  const [track, setTrack] = useState<CanonicalTrack | null>(null);
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

  // Local 60fps clock interpolation so the main window only needs low-frequency drift syncs
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastUiUpdate = 0;
    const step = (now: number) => {
      if (now - lastUiUpdate >= 24) {
        lastUiUpdate = now;
        const elapsed = now - lastSyncRef.current.perfNow;
        if (elapsed >= 0 && elapsed < 5000) {
          setCurrentTimeMs(Math.floor(lastSyncRef.current.baseTimeMs + elapsed));
        }
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

