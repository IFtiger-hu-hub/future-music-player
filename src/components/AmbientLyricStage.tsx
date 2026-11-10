import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sliders,
  Heart,
  Repeat,
  Shuffle,
  Volume2,
  Disc3,
  Lock,
  Unlock,
  Maximize2,
  Minimize2,
  AlignCenter,
  LayoutGrid,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { CanonicalTrack, SourceId, LyricLine } from '../types/music';
import {
  buildLyricRenderSegments,
  computeGlyphKaraokeState,
  findActiveLyricIndex,
} from '../utils/lyricUtils';
import { formatDuration } from './TrackTable';

const SOURCE_LABELS: Record<SourceId, string> = {
  huawei: '华为音乐',
  local: '本地母带',
  netease: '网易云',
};

export type StageLayoutMode = 'combo' | 'vinyl' | 'lyrics';

const LAYOUT_MODES: Array<{
  id: StageLayoutMode;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'combo', label: '默认组合', icon: LayoutGrid },
  { id: 'vinyl', label: '黑胶唱片', icon: Disc3 },
  { id: 'lyrics', label: '纯歌词', icon: AlignCenter },
];

/**
 * Fast 3-pass separable horizontal + vertical box blur (converges to a true Gaussian blur)
 * on an ImageData buffer of size `w x h`. Runs in ~0.8ms once per track change.
 */
function gaussianBlurImageData(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
) {
  const tmp = new Uint8ClampedArray(data.length);
  const diam = radius * 2 + 1;

  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      const rowOffset = y * w;

      for (let ix = -radius; ix <= radius; ix++) {
        const x = Math.min(w - 1, Math.max(0, ix));
        const p = (rowOffset + x) * 4;
        rSum += data[p];
        gSum += data[p + 1];
        bSum += data[p + 2];
      }

      for (let x = 0; x < w; x++) {
        const outP = (rowOffset + x) * 4;
        tmp[outP] = rSum / diam;
        tmp[outP + 1] = gSum / diam;
        tmp[outP + 2] = bSum / diam;
        tmp[outP + 3] = 255;

        const leftX = Math.max(0, x - radius);
        const rightX = Math.min(w - 1, x + radius + 1);
        const leftP = (rowOffset + leftX) * 4;
        const rightP = (rowOffset + rightX) * 4;

        rSum += data[rightP] - data[leftP];
        gSum += data[rightP + 1] - data[leftP + 1];
        bSum += data[rightP + 2] - data[leftP + 2];
      }
    }

    for (let x = 0; x < w; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      for (let iy = -radius; iy <= radius; iy++) {
        const y = Math.min(h - 1, Math.max(0, iy));
        const p = (y * w + x) * 4;
        rSum += tmp[p];
        gSum += tmp[p + 1];
        bSum += tmp[p + 2];
      }

      for (let y = 0; y < h; y++) {
        const outP = (y * w + x) * 4;
        data[outP] = rSum / diam;
        data[outP + 1] = gSum / diam;
        data[outP + 2] = bSum / diam;
        data[outP + 3] = 255;

        const topY = Math.max(0, y - radius);
        const botY = Math.min(h - 1, y + radius + 1);
        const topP = (topY * w + x) * 4;
        const botP = (botY * w + x) * 4;

        rSum += tmp[botP] - tmp[topP];
        gSum += tmp[botP + 1] - tmp[topP + 1];
        bSum += tmp[botP + 2] - tmp[topP + 2];
      }
    }
  }
}

interface PrebakedCoverResult {
  baseUrl: string;
  glowColor: string;
}

const prebakedCache = new Map<string, PrebakedCoverResult>();
const inflightPrebakeMap = new Map<string, Promise<PrebakedCoverResult | null>>();

function bakeCoverFromImage(
  coverUrl: string,
  img: HTMLImageElement
): PrebakedCoverResult | null {
  try {
    const sw = img.naturalWidth || 300;
    const sh = img.naturalHeight || 300;

    // 160x100 offscreen buffer: 2.25x faster than 240x150 (~0.3ms CPU time)
    // and visually indistinguishable once Gaussian-blurred!
    const w = 160;
    const h = 100;
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = w;
    baseCanvas.height = h;
    const bctx = baseCanvas.getContext('2d');
    if (!bctx) return null;

    bctx.drawImage(
      img,
      sw * 0.08,
      sh * 0.08,
      sw * 0.84,
      sh * 0.84,
      0,
      0,
      w,
      h
    );
    const baseData = bctx.getImageData(0, 0, w, h);
    const bd = baseData.data;

    let maxSat = -1;
    let bestR = 220;
    let bestG = 80;
    let bestB = 100;

    for (let i = 0; i < bd.length; i += 4) {
      const r = bd[i];
      const g = bd[i + 1];
      const b = bd[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat > maxSat && luma > 40 && luma < 220) {
        maxSat = sat;
        bestR = r;
        bestG = g;
        bestB = b;
      }
      bd[i] = Math.max(0, Math.min(255, (luma + (r - luma) * 1.65) * 0.74));
      bd[i + 1] = Math.max(
        0,
        Math.min(255, (luma + (g - luma) * 1.65) * 0.74)
      );
      bd[i + 2] = Math.max(
        0,
        Math.min(255, (luma + (b - luma) * 1.65) * 0.74)
      );
    }
    gaussianBlurImageData(bd, w, h, 9);
    bctx.putImageData(baseData, 0, 0);

    const baseUrl = baseCanvas.toDataURL('image/jpeg', 0.85);
    const glowColor = `rgba(${bestR}, ${bestG}, ${bestB}, 0.28)`;
    const entry = { baseUrl, glowColor };
    prebakedCache.set(coverUrl, entry);
    return entry;
  } catch {
    return null;
  }
}

function prebakeCoverAsync(coverUrl: string): Promise<PrebakedCoverResult | null> {
  if (!coverUrl) return Promise.resolve(null);
  const cached = prebakedCache.get(coverUrl);
  if (cached) return Promise.resolve(cached);
  const existing = inflightPrebakeMap.get(coverUrl);
  if (existing) return existing;

  const promise = (async (): Promise<PrebakedCoverResult | null> => {
    if (
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window &&
      coverUrl.startsWith('http')
    ) {
      try {
        const dataUrl = await invoke<string>('fetch_cover_data_url', {
          url: coverUrl,
        });
        if (dataUrl) {
          const entry = await new Promise<PrebakedCoverResult | null>((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(bakeCoverFromImage(coverUrl, img));
            img.onerror = () => resolve(null);
            img.src = dataUrl;
          });
          if (entry) return entry;
        }
      } catch {
        // fallback below
      }
    }

    return new Promise<PrebakedCoverResult | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(bakeCoverFromImage(coverUrl, img));
      img.onerror = () => resolve(null);
      img.src = coverUrl;
    });
  })().finally(() => {
    inflightPrebakeMap.delete(coverUrl);
  });

  inflightPrebakeMap.set(coverUrl, promise);
  return promise;
}

interface CrossfadingBackdropState {
  prevBaseUrl: string;
  activeBaseUrl: string;
  glowColor: string;
  transitionKey: number;
}

/**
 * Dual-buffer crossfading cover backdrop:
 * - Never blocks the main thread or applies `filter: blur()` on a 1920x1080 DOM node.
 * - Retains the previous song's blurred texture until the new song's 160x100 texture is ready,
 *   then smoothly crossfades (`opacity: 0 -> 0.92` over 680ms) on the GPU compositor!
 */
function useCrossfadingCoverBackdrop(coverUrl: string): CrossfadingBackdropState {
  const [state, setState] = useState<CrossfadingBackdropState>(() => {
    const initial = prebakedCache.get(coverUrl);
    return {
      prevBaseUrl: '',
      activeBaseUrl: initial?.baseUrl || '',
      glowColor: initial?.glowColor || 'rgba(250,45,72,0.22)',
      transitionKey: 0,
    };
  });

  useEffect(() => {
    if (!coverUrl) return;
    let cancelled = false;
    let cleanupTimer: number | null = null;

    const applyEntry = (entry: PrebakedCoverResult) => {
      if (cancelled) return;
      setState((prev) => {
        if (prev.activeBaseUrl === entry.baseUrl) return prev;
        return {
          prevBaseUrl: prev.activeBaseUrl,
          activeBaseUrl: entry.baseUrl,
          glowColor: entry.glowColor,
          transitionKey: prev.transitionKey + 1,
        };
      });
      cleanupTimer = window.setTimeout(() => {
        if (!cancelled) {
          setState((prev) =>
            prev.prevBaseUrl ? { ...prev, prevBaseUrl: '' } : prev
          );
        }
      }, 720);
    };

    const cached = prebakedCache.get(coverUrl);
    if (cached) {
      applyEntry(cached);
    } else {
      void prebakeCoverAsync(coverUrl).then((entry) => {
        if (entry) applyEntry(entry);
      });
    }

    return () => {
      cancelled = true;
      if (cleanupTimer !== null) {
        window.clearTimeout(cleanupTimer);
      }
    };
  }, [coverUrl]);

  return state;
}

/**
 * Sleek custom interactive progress / volume bar (replaces ugly browser native `<input type="range">`).
 */
const SleekProgressBar: React.FC<{
  percent: number;
  onChangePercent: (pct: number) => void;
  heightClass?: string;
}> = memo(({ percent, onChangePercent, heightClass = 'h-1 group-hover:h-1.5' }) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))
      );
      onChangePercent(ratio * 100);
    },
    [onChangePercent]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => updateFromClientX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, updateFromClientX]);

  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div
      ref={barRef}
      onMouseDown={(e) => {
        setDragging(true);
        updateFromClientX(e.clientX);
      }}
      className="w-full py-2 cursor-pointer group flex items-center select-none"
    >
      <div
        className={`relative w-full ${heightClass} rounded-full bg-white/[0.18] transition-all flex items-center`}
      >
        <div
          className="h-full rounded-full bg-white/95"
          style={{ width: `${clamped}%` }}
        />
        <div
          style={{ left: `${clamped}%` }}
          className="absolute -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        />
      </div>
    </div>
  );
});

/**
 * Isolated Scrubber Row component: ONLY this tiny leaf subscribes to `currentTimeMs`
 * quantized to 250ms (4Hz), preventing the rest of the stage (vinyl, 80 lyric rows, background)
 * from re-rendering on playback time ticks!
 */
const StageScrubberRow: React.FC<{
  durationSeconds: number;
  seekToMs: (ms: number) => void;
  showCenterBadge?: boolean;
}> = memo(({ durationSeconds, seekToMs, showCenterBadge = false }) => {
  // Quantize to 200ms (5Hz) so scrubber updates smoothly with minimal React renders
  const quantizedQuarterSec = usePlayerStore((s) =>
    Math.floor(s.currentTimeMs / 200)
  );
  const currentTimeMs = quantizedQuarterSec * 200;
  const totalMs = Math.max(1000, durationSeconds * 1000);
  const progressPercent = Math.min(100, (currentTimeMs / totalMs) * 100);

  const handleSeekPct = useCallback(
    (pct: number) => {
      seekToMs(Math.floor((pct / 100) * totalMs));
    },
    [seekToMs, totalMs]
  );

  return (
    <div>
      <SleekProgressBar
        percent={progressPercent}
        onChangePercent={handleSeekPct}
      />
      <div className="flex items-center justify-between -mt-0.5 text-[11px] font-mono-tabular !text-white/55">
        <span>{formatDuration(Math.floor(currentTimeMs / 1000))}</span>
        {showCenterBadge && (
          <span className="px-2 py-0.2 rounded bg-white/[0.08] text-[10px] !text-white/75">
            SQ 无损
          </span>
        )}
        <span>{formatDuration(durationSeconds)}</span>
      </div>
    </div>
  );
});

/**
 * Isolated Word-by-Word Karaoke component: ONLY mounted on the SINGLE active lyric line
 * when `line.words` exists. Non-active lines and standard LRC lines NEVER subscribe to `currentTimeMs`!
 */
const ActiveWordKaraokeContent: React.FC<{
  line: LyricLine;
}> = memo(({ line }) => {
  const effectiveTimeMs = usePlayerStore((s) =>
    Math.max(0, s.currentTimeMs + s.lyricOffsetMs)
  );
  const segments = buildLyricRenderSegments(line);

  return (
    <>
      {segments.map((seg, sIdx) => {
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
              seg.nowrap
                ? 'inline-block whitespace-nowrap'
                : 'inline whitespace-pre-wrap'
            }
          >
            {seg.glyphs.map((glyph, gIdx) => {
              const { state, progress } = computeGlyphKaraokeState(
                glyph.startMs,
                glyph.endMs,
                effectiveTimeMs
              );

              if (state === 'passed') {
                return (
                  <span key={gIdx} className="!text-white">
                    {glyph.text}
                  </span>
                );
              }

              if (state === 'upcoming') {
                return (
                  <span key={gIdx} style={{ color: 'rgba(255, 255, 255, 0.42)' }}>
                    {glyph.text}
                  </span>
                );
              }

              const pct = Math.round(progress * 100);
              const featherStart = Math.max(0, pct - 14);
              const featherEnd = Math.min(100, pct + 14);

              return (
                <span
                  key={gIdx}
                  style={{
                    backgroundImage: `linear-gradient(90deg, #FFFFFF 0%, #FFFFFF ${featherStart}%, rgba(255,255,255,0.42) ${featherEnd}%, rgba(255,255,255,0.42) 100%)`,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  {glyph.text}
                </span>
              );
            })}
          </span>
        );
      })}
    </>
  );
});

const LyricLineText: React.FC<{
  line: LyricLine;
  isActiveLine: boolean;
}> = memo(({ line, isActiveLine }) => {
  if (isActiveLine && line.words && line.words.length > 0) {
    return <ActiveWordKaraokeContent line={line} />;
  }
  if (isActiveLine) {
    return <span className="!text-white">{line.text}</span>;
  }
  return <span className="!text-white/90">{line.text}</span>;
});

/**
 * NetEase Cloud Music Style Vinyl Turntable (`黑胶唱片机`):
 * - Supports left/right slide track-switch animation (`vinylSlideOutLeft` / `vinylSlideInRight` & reverse)
 * - Tonearm (`唱针`) automatically lifts (`-26deg`) during track transitions or horizontal drag,
 *   then gently drops (`2deg`) onto the spinning vinyl once the new record settles into place.
 * - Supports interactive mouse/touch horizontal swipe (`左滑下一首，右滑上一首`).
 */
const NeteaseVinylTurntable: React.FC<{
  track: CanonicalTrack;
  isPlaying: boolean;
  variant: 'combo' | 'vinyl';
  vinylPlatterStyle?: boolean;
  onTogglePlatterStyle?: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
}> = memo(
  ({
    track,
    isPlaying,
    variant,
    vinylPlatterStyle = true,
    onTogglePlatterStyle,
    onNextTrack,
    onPrevTrack,
  }) => {
    const prevTrackRef = useRef<CanonicalTrack>(track);
    const [outgoingTrack, setOutgoingTrack] = useState<CanonicalTrack | null>(
      null
    );
    const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next');
    const [isSwitching, setIsSwitching] = useState(false);
    const [tonearmLiftedForSwitch, setTonearmLiftedForSwitch] = useState(false);

    // Interactive horizontal swipe state
    const pointerStartXRef = useRef<number | null>(null);
    const [dragOffsetX, setDragOffsetX] = useState(0);

    useEffect(() => {
      if (prevTrackRef.current.id === track.id) {
        prevTrackRef.current = track;
        return;
      }
      const dir = usePlayerStore.getState().lastSwitchDirection || 'next';
      setSlideDir(dir);
      setOutgoingTrack(prevTrackRef.current);
      setIsSwitching(true);
      setTonearmLiftedForSwitch(true);
      prevTrackRef.current = track;

      const armTimer = window.setTimeout(() => {
        setTonearmLiftedForSwitch(false);
      }, 360);
      const doneTimer = window.setTimeout(() => {
        setIsSwitching(false);
        setOutgoingTrack(null);
      }, 520);

      return () => {
        window.clearTimeout(armTimer);
        window.clearTimeout(doneTimer);
      };
    }, [track]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      pointerStartXRef.current = e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerStartXRef.current === null) return;
      const dx = e.clientX - pointerStartXRef.current;
      setDragOffsetX(Math.max(-160, Math.min(160, dx)));
    };

    const finishPointerGesture = (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerStartXRef.current === null) return;
      const dx = e.clientX - pointerStartXRef.current;
      pointerStartXRef.current = null;
      setDragOffsetX(0);

      if (dx <= -48) {
        onNextTrack();
      } else if (dx >= 48) {
        onPrevTrack();
      } else if (Math.abs(dx) < 6 && onTogglePlatterStyle) {
        onTogglePlatterStyle();
      }
    };

    const isDragging = Math.abs(dragOffsetX) > 8;
    const isTonearmDown =
      isPlaying && !tonearmLiftedForSwitch && !isDragging;

    const sizeClass =
      variant === 'vinyl'
        ? 'w-[300px] h-[300px] sm:w-[370px] sm:h-[370px] xl:w-[420px] xl:h-[420px]'
        : 'w-[320px] h-[320px] xl:w-[376px] xl:h-[376px] 2xl:w-[410px] 2xl:h-[410px]';

    const ringPaddingClass =
      variant === 'vinyl'
        ? 'p-[52px] sm:p-[66px] xl:p-[74px]'
        : 'p-[50px] xl:p-[60px]';

    const renderDiscPlatter = (
      discTrack: CanonicalTrack,
      spinActive: boolean
    ) => (
      <div
        style={{
          willChange: 'transform',
          animationPlayState: spinActive ? 'running' : 'paused',
          background:
            'conic-gradient(from 35deg, #101014 0deg, #26262F 45deg, #101014 95deg, #1F1F27 180deg, #292933 225deg, #101014 280deg, #1B1B22 360deg)',
        }}
        className={`w-full h-full rounded-full ${ringPaddingClass} shadow-[0_28px_75px_rgba(0,0,0,0.78)] ring-1 ring-white/15 relative flex items-center justify-center animate-[spin_26s_linear_infinite]`}
      >
        <div className="absolute inset-4 rounded-full border border-white/[0.06] pointer-events-none" />
        <div className="absolute inset-9 rounded-full border border-white/[0.05] pointer-events-none" />
        <div className="absolute inset-14 rounded-full border border-white/[0.06] pointer-events-none" />

        <div className="w-full h-full rounded-full overflow-hidden ring-4 ring-[#0A0A0E] shadow-2xl relative">
          <img
            src={discTrack.coverUrl}
            alt={discTrack.title}
            draggable={false}
            decoding="async"
            className="w-full h-full object-cover select-none pointer-events-none"
          />
          <div className="absolute inset-0 m-auto w-4.5 h-4.5 rounded-full bg-[#0A0A0E] border border-white/35 shadow-md" />
        </div>
      </div>
    );

    if (!vinylPlatterStyle) {
      return (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerGesture}
          onPointerCancel={finishPointerGesture}
          style={{
            transform: isDragging
              ? `translate3d(${dragOffsetX}px, 0, 0) scale(0.97)`
              : undefined,
          }}
          title="左右滑动切歌 · 点击切换黑胶唱盘"
          className={`${sizeClass} rounded-[24px] overflow-hidden shadow-[0_28px_75px_rgba(0,0,0,0.75)] ring-1 ring-white/20 transition-transform duration-500 ease-out cursor-grab active:cursor-grabbing ${
            isPlaying ? 'scale-100' : 'scale-[0.95]'
          }`}
        >
          <img
            src={track.coverUrl}
            alt={track.title}
            draggable={false}
            decoding="async"
            className="w-full h-full object-cover select-none pointer-events-none"
          />
        </div>
      );
    }

    const incomingAnim = isSwitching
      ? slideDir === 'next'
        ? 'vinylSlideInRight 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards'
        : 'vinylSlideInLeft 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards'
      : undefined;

    const outgoingAnim =
      slideDir === 'next'
        ? 'vinylSlideOutLeft 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards'
        : 'vinylSlideOutRight 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards';

    return (
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
        title="左右滑动黑胶唱片可切歌"
        className={`relative ${sizeClass} flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-pan-y`}
      >
        {/* Tonearm (唱针): lifts on pause, drag, or track switch */}
        <div
          style={{
            transformOrigin: '78% 18%',
            transform: isTonearmDown ? 'rotate(2deg)' : 'rotate(-26deg)',
            transition: 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className={`absolute -top-5 right-2 z-30 ${
            variant === 'vinyl' ? 'w-32 h-44' : 'w-28 h-40'
          } pointer-events-none`}
        >
          <div className="absolute top-2 right-3 w-8.5 h-8.5 rounded-full bg-white/20 border border-white/30 shadow-lg flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-[#121216] border border-white/40" />
          </div>
          <svg
            viewBox="0 0 110 150"
            className="w-full h-full drop-shadow-[0_8px_18px_rgba(0,0,0,0.65)]"
          >
            <path
              d="M 84 26 L 66 96 L 38 128"
              fill="none"
              stroke="rgba(255,255,255,0.84)"
              strokeWidth="4.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="28"
              y="120"
              width="14.5"
              height="9.2"
              rx="2.5"
              transform="rotate(-38 36 125)"
              fill="#FFFFFF"
            />
          </svg>
        </div>

        {/* Outgoing Disc (slides out left or right during track transition) */}
        {isSwitching && outgoingTrack && (
          <div
            key={`out-${outgoingTrack.id}`}
            style={{
              willChange: 'transform, opacity',
              animation: outgoingAnim,
            }}
            className="absolute inset-0 pointer-events-none z-10"
          >
            {renderDiscPlatter(outgoingTrack, false)}
          </div>
        )}

        {/* Current / Incoming Disc */}
        <div
          key={`in-${track.id}`}
          style={{
            willChange: 'transform, opacity',
            animation: incomingAnim,
            transform: !isSwitching && dragOffsetX !== 0
              ? `translate3d(${dragOffsetX}px, 0, 0) scale(${
                  1 - Math.min(0.12, Math.abs(dragOffsetX) / 900)
                })`
              : undefined,
            transition:
              !isSwitching && dragOffsetX === 0
                ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
                : undefined,
          }}
          className="w-full h-full relative z-20"
        >
          {renderDiscPlatter(
            track,
            isPlaying && !tonearmLiftedForSwitch && !isDragging
          )}
        </div>
      </div>
    );
  }
);

const ActiveStageBody: React.FC<{ isStageOpen: boolean }> = ({ isStageOpen }) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const lyricOffsetMs = usePlayerStore((s) => s.lyricOffsetMs);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const isDesktopLyricOpen = usePlayerStore((s) => s.isDesktopLyricOpen);
  const isDesktopLyricLocked = usePlayerStore((s) => s.isDesktopLyricLocked);
  const setDesktopLyricOpen = usePlayerStore((s) => s.setDesktopLyricOpen);
  const setDesktopLyricLocked = usePlayerStore((s) => s.setDesktopLyricLocked);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const seekToMs = usePlayerStore((s) => s.seekToMs);
  const switchPlaybackSource = usePlayerStore((s) => s.switchPlaybackSource);
  const adjustLyricOffset = usePlayerStore((s) => s.adjustLyricOffset);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);

  // CRITICAL PERFORMANCE INVARIANT:
  // Subscribe ONLY to `activeLineIndex` (which changes once every ~4 seconds),
  // NOT `currentTimeMs` (which changes 30 times per second)!
  const activeLineIndex = usePlayerStore((s) =>
    isStageOpen
      ? findActiveLyricIndex(
          s.currentTrack.lyrics,
          Math.max(0, s.currentTimeMs + s.lyricOffsetMs)
        )
      : 0
  );

  const [layoutMode, setLayoutMode] = useState<StageLayoutMode>(() => {
    try {
      const saved = window.localStorage?.getItem('future_music_stage_layout_mode');
      if (saved === 'combo' || saved === 'vinyl' || saved === 'lyrics') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'combo';
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudIdle, setHudIdle] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  const [vinylPlatterStyle, setVinylPlatterStyle] = useState(true);
  const [playMode, setPlayMode] = useState<'sequence' | 'shuffle' | 'repeat'>('sequence');

  const { prevBaseUrl, activeBaseUrl, glowColor, transitionKey } =
    useCrossfadingCoverBackdrop(currentTrack.coverUrl);

  // Pre-warm adjacent (next & prev) track covers in idle background so switching tracks
  // hits `prebakedCache` in 0ms and starts the background crossfade immediately!
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { tracks, currentTrack: curr } = usePlayerStore.getState();
      if (tracks.length <= 1) return;
      const idx = tracks.findIndex((t) => t.id === curr.id);
      if (idx < 0) return;
      const nextUrl = tracks[(idx + 1) % tracks.length]?.coverUrl;
      const prevUrl =
        tracks[(idx - 1 + tracks.length) % tracks.length]?.coverUrl;
      if (nextUrl) void prebakeCoverAsync(nextUrl);
      if (prevUrl) void prebakeCoverAsync(prevUrl);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [currentTrack.id]);

  const handleSelectLayoutMode = (mode: StageLayoutMode) => {
    setLayoutMode(mode);
    try {
      window.localStorage?.setItem('future_music_stage_layout_mode', mode);
    } catch {
      // ignore
    }
  };

  const toggleFullscreen = useCallback(async () => {
    const nextFs = !isFullscreen;
    setIsFullscreen(nextFs);
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const actual = await invoke<boolean>('set_main_window_fullscreen', {
          fullscreen: nextFs,
        });
        setIsFullscreen(actual);
        return;
      }
    } catch {
      // fallback to browser fullscreen API
    }

    try {
      if (nextFs && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (!nextFs && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!isStageOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        void toggleFullscreen();
      } else if (
        e.key === '1' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        handleSelectLayoutMode('combo');
      } else if (
        e.key === '2' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        handleSelectLayoutMode('vinyl');
      } else if (
        e.key === '3' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        handleSelectLayoutMode('lyrics');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStageOpen, toggleFullscreen]);

  const resetHudIdleTimer = useCallback(() => {
    setHudIdle((prev) => (prev ? false : prev));
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    if (isFullscreen && isPlaying) {
      idleTimerRef.current = window.setTimeout(() => {
        setHudIdle(true);
      }, 4000);
    }
  }, [isFullscreen, isPlaying]);

  useEffect(() => {
    resetHudIdleTimer();
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [resetHudIdleTimer]);

  const currentActiveLine =
    currentTrack.lyrics[activeLineIndex] || currentTrack.lyrics[0];

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimerRef = useRef<number | null>(null);

  const handleManualScrollActivity = useCallback(() => {
    setIsUserScrolling((prev) => (prev ? prev : true));
    if (userScrollTimerRef.current !== null) {
      window.clearTimeout(userScrollTimerRef.current);
    }
    userScrollTimerRef.current = window.setTimeout(() => {
      setIsUserScrolling(false);
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current !== null) {
        window.clearTimeout(userScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isStageOpen || isUserScrolling || layoutMode === 'vinyl') return;
    const container = scrollContainerRef.current;
    const targetEl = lineRefs.current[activeLineIndex];
    if (container && targetEl) {
      const targetTop =
        targetEl.offsetTop -
        container.clientHeight / 2 +
        targetEl.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    }
  }, [activeLineIndex, isStageOpen, isUserScrolling, currentTrack.id, layoutMode]);

  const [c1, c2, c3] = currentTrack.dominantColors || [
    '#3F1D2B',
    '#18181B',
    '#09090B',
  ];

  const cyclePlayMode = useCallback(() => {
    setPlayMode((m) =>
      m === 'sequence' ? 'shuffle' : m === 'shuffle' ? 'repeat' : 'sequence'
    );
  }, []);

  const handleVolumePct = useCallback(
    (pct: number) => setVolume(Math.round(pct)),
    [setVolume]
  );

  return (
    <div
      onMouseMove={resetHudIdleTimer}
      className="relative w-full h-full flex flex-col justify-between overflow-hidden"
    >
      <style>{`
        @keyframes subtleGlowDrift {
          0%   { transform: translate3d(-18%, -12%, 0) scale(1); }
          50%  { transform: translate3d(22%, 14%, 0) scale(1.18); }
          100% { transform: translate3d(-18%, -12%, 0) scale(1); }
        }
        @keyframes bgCrossfadeIn {
          0%   { opacity: 0; transform: scale(1.12); }
          100% { opacity: 0.92; transform: scale(1.06); }
        }
        @keyframes vinylSlideOutLeft {
          0%   { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
          100% { transform: translate3d(-108%, 0, 0) scale(0.82); opacity: 0; }
        }
        @keyframes vinylSlideInRight {
          0%   { transform: translate3d(108%, 0, 0) scale(0.82); opacity: 0; }
          100% { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
        }
        @keyframes vinylSlideOutRight {
          0%   { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
          100% { transform: translate3d(108%, 0, 0) scale(0.82); opacity: 0; }
        }
        @keyframes vinylSlideInLeft {
          0%   { transform: translate3d(-108%, 0, 0) scale(0.82); opacity: 0; }
          100% { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
        }
      `}</style>

      {/* =====================================================================
          ULTRA-LIGHTWEIGHT GPU BACKDROP WITH DUAL-BUFFER CROSSFADE
          - Zero CSS `filter: blur()` on full-screen nodes (eliminates track-switch hitch)
          - Smooth 680ms opacity + subtle scale crossfade between `prevBaseUrl` & `activeBaseUrl`
         ===================================================================== */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
        <div
          className="absolute inset-0 transition-colors duration-700"
          style={{
            background: `radial-gradient(circle at 24% 32%, ${c1} 0%, transparent 65%), radial-gradient(circle at 76% 72%, ${c2} 0%, transparent 65%), linear-gradient(155deg, #101015 0%, ${c3} 100%)`,
          }}
        />

        {/* Previous Song Blurred Cover (underneath during 680ms crossfade) */}
        {prevBaseUrl && (
          <img
            src={prevBaseUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover scale-106 opacity-92"
          />
        )}

        {/* Active Song Blurred Cover (smooth 680ms GPU crossfade-in) */}
        {activeBaseUrl && (
          <img
            key={transitionKey}
            src={activeBaseUrl}
            alt=""
            aria-hidden="true"
            style={{
              willChange: 'opacity, transform',
              animation: 'bgCrossfadeIn 680ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Single Lightweight Flowing Ambient Light Halo (Pure CSS radial-gradient) */}
        <div
          style={{
            willChange: 'transform',
            background: `radial-gradient(circle, ${glowColor} 0%, rgba(255,255,255,0.06) 38%, transparent 70%)`,
            animation: 'subtleGlowDrift 22s ease-in-out infinite',
            animationPlayState: isPlaying ? 'running' : 'paused',
            transition: 'background 700ms ease',
          }}
          className="absolute top-[10%] left-[18%] w-[64vw] h-[64vw] rounded-full pointer-events-none"
        />

        {/* Subtle Vignette Scrim */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 46% 48%, rgba(10, 10, 14, 0.08) 0%, rgba(10, 10, 14, 0.38) 100%)',
          }}
        />
      </div>

      {/* =====================================================================
          1. MINIMALIST RESTRAINED TOP HUD
         ===================================================================== */}
      <header
        className={`relative z-30 px-5 sm:px-10 xl:px-14 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-wrap gap-2.5 transition-opacity duration-500 shrink-0 ${
          hudIdle ? 'opacity-15 hover:opacity-100' : 'opacity-100'
        }`}
      >
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={() => {
              if (isFullscreen) {
                void toggleFullscreen();
              }
              setStageOpen(false);
            }}
            className="w-9 h-9 rounded-full bg-white/[0.1] hover:bg-white/[0.18] border border-white/[0.1] flex items-center justify-center !text-white/85 hover:!text-white transition-colors cursor-pointer shrink-0"
            title="收起播放页 (ESC)"
          >
            <ChevronDown className="w-5 h-5" />
          </button>

          <div className="hidden md:flex items-center gap-1 bg-black/25 border border-white/[0.1] p-1 rounded-full">
            {currentTrack.bindings.map((b) => {
              const isSelected = activeSourceForPlayback === b.source;
              return (
                <button
                  key={b.source}
                  onClick={() => switchPlaybackSource(b.source)}
                  className={`relative px-3 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-white/[0.22] !text-white'
                      : '!text-white/60 hover:!text-white/95'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{SOURCE_LABELS[b.source]}</span>
                    <span className="text-[10px] font-mono-tabular px-1.5 py-0.2 rounded bg-white/10 !text-white/80">
                      {b.formatLabel}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div
            role="group"
            aria-label="播放页布局模式"
            className="flex items-center bg-black/25 border border-white/[0.1] p-0.5 rounded-full"
          >
            {LAYOUT_MODES.map((m) => {
              const Icon = m.icon;
              const active = layoutMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => handleSelectLayoutMode(m.id)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/20 !text-white font-semibold'
                      : '!text-white/60 hover:!text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          <div className="hidden xl:flex items-center gap-1.5 bg-black/25 border border-white/[0.1] px-3 py-1 rounded-full text-[11px] font-mono-tabular !text-white/75">
            <Sliders className="w-3 h-3 !text-white/60" />
            <span>
              词轴 {lyricOffsetMs >= 0 ? `+${lyricOffsetMs}` : lyricOffsetMs}ms
            </span>
            <button
              onClick={() => adjustLyricOffset(-200)}
              className="px-1.5 py-0.5 rounded-full hover:bg-white/15 !text-white/85 cursor-pointer"
            >
              -0.2s
            </button>
            <button
              onClick={() => adjustLyricOffset(200)}
              className="px-1.5 py-0.5 rounded-full hover:bg-white/15 !text-white/85 cursor-pointer"
            >
              +0.2s
            </button>
          </div>

          <button
            onClick={() => setDesktopLyricOpen(!isDesktopLyricOpen)}
            className={`h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors cursor-pointer ${
              isDesktopLyricOpen
                ? 'bg-white/25 border-white/30 !text-white font-semibold'
                : 'bg-black/25 border-white/[0.1] !text-white/75 hover:!text-white'
            }`}
          >
            桌面歌词
          </button>

          {isDesktopLyricOpen && (
            <button
              onClick={() => setDesktopLyricLocked(!isDesktopLyricLocked)}
              className={`h-8 px-2.5 rounded-full border text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                isDesktopLyricLocked
                  ? 'bg-amber-500/20 border-amber-400/50 !text-amber-200'
                  : 'bg-black/25 border-white/[0.1] !text-white/70 hover:!text-white'
              }`}
            >
              {isDesktopLyricLocked ? (
                <>
                  <Lock className="w-3 h-3" />
                  <span>解锁</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3 h-3" />
                  <span>穿透</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={() => void toggleFullscreen()}
            title={isFullscreen ? '退出全屏 (F11)' : '全屏模式 (F11)'}
            className={`h-8 px-3 rounded-full border text-[11.5px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              isFullscreen
                ? 'bg-white !text-black border-white font-semibold'
                : 'bg-black/25 hover:bg-white/[0.18] border-white/[0.12] !text-white/90'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>退出全屏</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>全屏</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* =====================================================================
          2. STAGE BODY: 3 SWITCHABLE LAYOUT MODES
         ===================================================================== */}

      {layoutMode === 'vinyl' ? (
        /* -------------------------------------------------------------------
           MODE B: 黑胶唱片 (PURE VINYL SANCTUARY + REFINED TRANSPORT MATRIX)
           ------------------------------------------------------------------- */
        <div className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-between px-6 pb-6 pt-2 max-w-[1440px] w-full mx-auto">
          <div className="flex-1 flex flex-col items-center justify-center relative w-full">
            <NeteaseVinylTurntable
              track={currentTrack}
              isPlaying={isPlaying}
              variant="vinyl"
              onNextTrack={nextTrack}
              onPrevTrack={prevTrack}
            />

            <div className="mt-6 text-center max-w-2xl space-y-1.5">
              <div className="text-[22px] sm:text-[26px] font-bold !text-white tracking-tight">
                {currentTrack.title}
              </div>
              <div className="text-[13.5px] !text-white/60 font-medium">
                {currentTrack.artists.join(' / ')} — {currentTrack.album}
              </div>

              {currentActiveLine && (
                <div className="pt-3 text-[20px] sm:text-[24px] font-bold tracking-tight !text-white/95">
                  <LyricLineText
                    line={currentActiveLine}
                    isActiveLine={true}
                  />
                  {currentActiveLine.translation && (
                    <div className="text-[13.5px] !text-white/60 font-normal mt-1">
                      {currentActiveLine.translation}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="w-full max-w-[600px] space-y-2 pt-2">
            <StageScrubberRow
              durationSeconds={currentTrack.durationSeconds}
              seekToMs={seekToMs}
              showCenterBadge={true}
            />

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2 w-36">
                <button
                  onClick={() => toggleFavorite(currentTrack.id)}
                  className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                  title="收藏至我喜欢"
                >
                  <Heart
                    className={`w-4 h-4 ${
                      currentTrack.isFavorite
                        ? 'text-[#FA2D48] fill-current'
                        : '!text-white/70 hover:!text-white'
                    }`}
                  />
                </button>
                <button
                  onClick={cyclePlayMode}
                  className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/65 hover:!text-white transition-colors cursor-pointer"
                  title="切换播放模式"
                >
                  {playMode === 'shuffle' ? (
                    <Shuffle className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-6">
                <button
                  onClick={prevTrack}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>
                <button
                  onClick={togglePlay}
                  className="w-13 h-13 rounded-full bg-white text-[#121216] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>
                <button
                  onClick={nextTrack}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2.5 w-36">
                <Volume2 className="w-4 h-4 !text-white/55 shrink-0" />
                <div className="w-20">
                  <SleekProgressBar
                    percent={volume}
                    onChangePercent={handleVolumePct}
                    heightClass="h-1"
                  />
                </div>
                <button
                  onClick={() => {
                    setStageOpen(false);
                    setActiveNav('settings');
                  }}
                  title="打开 10 段参量均衡器"
                  className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/65 hover:!text-white transition-colors cursor-pointer shrink-0"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : layoutMode === 'lyrics' ? (
        /* -------------------------------------------------------------------
           MODE C: 纯歌词 (PURE LYRICS CONCERT HALL + REFINED TRANSPORT MATRIX)
           ------------------------------------------------------------------- */
        <div className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-between px-4 sm:px-12 xl:px-24 pb-6 max-w-[1560px] w-full mx-auto overflow-hidden">
          <div
            ref={scrollContainerRef}
            onWheel={handleManualScrollActivity}
            onTouchMove={handleManualScrollActivity}
            style={{
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)',
            }}
            className="w-full flex-1 min-h-0 overflow-y-auto py-36 sm:py-52 px-4 sm:px-10 flex flex-col items-center text-center space-y-6 sm:space-y-8 no-scrollbar"
          >
            {currentTrack.lyrics.map((line, index) => {
              const isActiveLine = index === activeLineIndex;
              const distance = Math.abs(index - activeLineIndex);
              const opacityVal = isActiveLine
                ? 0.98
                : isUserScrolling
                ? 0.68
                : Math.max(0.18, 0.5 - distance * 0.11);

              return (
                <div
                  key={index}
                  ref={(el) => {
                    lineRefs.current[index] = el;
                  }}
                  onClick={() => {
                    setIsUserScrolling(false);
                    seekToMs(line.timeMs);
                  }}
                  style={{
                    opacity: opacityVal,
                    transform: isActiveLine
                      ? 'translate3d(0, 0, 0) scale(1.03)'
                      : 'translate3d(0, 0, 0) scale(0.94)',
                    transformOrigin: 'center center',
                  }}
                  className="group cursor-pointer max-w-3xl transition-[transform,opacity] duration-300 ease-out hover:!opacity-95 py-2 px-5 rounded-2xl hover:bg-white/[0.04]"
                >
                  {line.romanization && (
                    <div
                      className={`text-[13.5px] sm:text-[15px] font-medium mb-1 tracking-wide ${
                        isActiveLine ? '!text-white/80' : '!text-white/45'
                      }`}
                    >
                      {line.romanization}
                    </div>
                  )}

                  <div
                    className={`font-bold leading-snug tracking-tight break-words ${
                      isActiveLine
                        ? 'text-[28px] sm:text-[36px] xl:text-[44px] !text-white'
                        : 'text-[20px] sm:text-[24px] xl:text-[28px] !text-white/90'
                    }`}
                  >
                    <LyricLineText line={line} isActiveLine={isActiveLine} />
                  </div>

                  {line.translation && (
                    <div
                      className={`text-[14.5px] sm:text-[17px] mt-1.5 font-normal ${
                        isActiveLine ? '!text-white/75' : '!text-white/45'
                      }`}
                    >
                      {line.translation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="w-full max-w-[680px] space-y-2 pt-2">
            <StageScrubberRow
              durationSeconds={currentTrack.durationSeconds}
              seekToMs={seekToMs}
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 w-52">
                <img
                  src={currentTrack.coverUrl}
                  alt={currentTrack.title}
                  className={`w-10 h-10 rounded-full object-cover ring-1 ring-white/25 shrink-0 shadow-md ${
                    isPlaying ? 'animate-[spin_24s_linear_infinite]' : ''
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold !text-white truncate">
                    {currentTrack.title}
                  </div>
                  <div className="text-[11.5px] !text-white/60 truncate">
                    {currentTrack.artists.join(' / ')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-5">
                <button
                  onClick={prevTrack}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>
                <button
                  onClick={togglePlay}
                  className="w-12 h-12 rounded-full bg-white text-[#121216] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>
                <button
                  onClick={nextTrack}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>
              </div>

              <div className="hidden sm:flex items-center justify-end gap-3 w-52">
                <button
                  onClick={() => toggleFavorite(currentTrack.id)}
                  className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer shrink-0"
                  title="收藏至我喜欢"
                >
                  <Heart
                    className={`w-4 h-4 ${
                      currentTrack.isFavorite
                        ? 'text-[#FA2D48] fill-current'
                        : '!text-white/70 hover:!text-white'
                    }`}
                  />
                </button>
                <Volume2 className="w-4 h-4 !text-white/55 shrink-0" />
                <div className="w-24">
                  <SleekProgressBar
                    percent={volume}
                    onChangePercent={handleVolumePct}
                    heightClass="h-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* -------------------------------------------------------------------
           MODE A: 默认组合 (BALANCED WIDESCREEN SPLIT STAGE)
           ------------------------------------------------------------------- */
        <div className="relative z-10 flex-1 min-h-0 flex flex-col-reverse lg:grid lg:grid-cols-[minmax(380px,44%)_1fr] gap-6 lg:gap-20 xl:gap-28 2xl:gap-36 items-center px-6 sm:px-10 lg:px-16 xl:px-24 2xl:px-32 max-w-[1780px] w-full mx-auto overflow-hidden">
          <div className="w-full flex flex-col items-center justify-center shrink-0 pb-2 lg:pb-0">
            <div className="hidden lg:flex relative items-center justify-center pt-2 pb-2">
              <NeteaseVinylTurntable
                track={currentTrack}
                isPlaying={isPlaying}
                variant="combo"
                vinylPlatterStyle={vinylPlatterStyle}
                onTogglePlatterStyle={() => setVinylPlatterStyle((v) => !v)}
                onNextTrack={nextTrack}
                onPrevTrack={prevTrack}
              />
            </div>

            <div className="mt-2 lg:mt-6 w-full max-w-[500px] lg:max-w-[390px] space-y-2.5 lg:space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="lg:hidden w-11 h-11 rounded-full overflow-hidden ring-1 ring-white/20 shrink-0 shadow-md">
                    <img
                      src={currentTrack.coverUrl}
                      alt={currentTrack.title}
                      decoding="async"
                      className={`w-full h-full object-cover ${
                        isPlaying ? 'animate-[spin_22s_linear_infinite]' : ''
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-[19px] sm:text-[21px] lg:text-[23px] font-bold !text-white truncate tracking-tight">
                      {currentTrack.title}
                    </h1>
                    <p className="text-[13px] sm:text-[14px] !text-white/65 truncate mt-0.5">
                      {currentTrack.artists.join(' / ')} — {currentTrack.album}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded bg-white/[0.1] border border-white/[0.12] text-[10px] font-mono-tabular font-medium !text-white/80">
                    SQ 无损
                  </span>
                  <button
                    onClick={() => toggleFavorite(currentTrack.id)}
                    className="w-9 h-9 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                    title="收藏至我喜欢"
                  >
                    <Heart
                      className={`w-4 h-4 ${
                        currentTrack.isFavorite
                          ? 'text-[#FA2D48] fill-current'
                          : '!text-white/75'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <StageScrubberRow
                durationSeconds={currentTrack.durationSeconds}
                seekToMs={seekToMs}
              />

              <div className="flex items-center justify-between px-1">
                <button
                  onClick={cyclePlayMode}
                  title={
                    playMode === 'sequence'
                      ? '列表循环'
                      : playMode === 'shuffle'
                      ? '随机播放'
                      : '单曲循环'
                  }
                  className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/65 hover:!text-white transition-colors cursor-pointer"
                >
                  {playMode === 'shuffle' ? (
                    <Shuffle className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                </button>

                <button
                  onClick={prevTrack}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>

                <button
                  onClick={togglePlay}
                  className="w-12 h-12 lg:w-14 lg:h-14 rounded-full bg-white hover:scale-105 active:scale-95 text-[#121216] shadow-[0_10px_28px_rgba(0,0,0,0.35)] flex items-center justify-center transition-transform cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  onClick={nextTrack}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>

                <button
                  onClick={() => {
                    setStageOpen(false);
                    setActiveNav('settings');
                  }}
                  title="打开 10 段参量均衡器"
                  className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/65 hover:!text-white transition-colors cursor-pointer"
                >
                  <Sliders className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 px-2">
                <Volume2 className="w-3.5 h-3.5 !text-white/50 shrink-0" />
                <SleekProgressBar
                  percent={volume}
                  onChangePercent={handleVolumePct}
                  heightClass="h-1"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Pure-White Zero-FBO Composited Lyrics */}
          <div
            ref={scrollContainerRef}
            onWheel={handleManualScrollActivity}
            onTouchMove={handleManualScrollActivity}
            style={{
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
            }}
            className="w-full flex-1 min-h-0 lg:h-[600px] xl:h-[680px] overflow-y-auto pr-2 sm:pr-6 py-28 lg:py-56 flex flex-col space-y-5 lg:space-y-6 no-scrollbar relative"
          >
            {currentTrack.lyrics.map((line, index) => {
              const isActiveLine = index === activeLineIndex;
              const distance = Math.abs(index - activeLineIndex);
              const opacityVal = isActiveLine
                ? 0.98
                : isUserScrolling
                ? 0.68
                : Math.max(0.18, 0.5 - distance * 0.11);

              return (
                <div
                  key={index}
                  ref={(el) => {
                    lineRefs.current[index] = el;
                  }}
                  onClick={() => {
                    setIsUserScrolling(false);
                    seekToMs(line.timeMs);
                  }}
                  style={{
                    opacity: opacityVal,
                    transform: isActiveLine
                      ? 'translate3d(0, 0, 0) scale(1.02)'
                      : 'translate3d(0, 0, 0) scale(0.95)',
                    transformOrigin: 'left center',
                  }}
                  className="group cursor-pointer transition-[transform,opacity] duration-300 ease-out hover:!opacity-95 py-2 px-3.5 -mx-3.5 rounded-2xl hover:bg-white/[0.04] flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    {line.romanization && (
                      <div
                        className={`text-[13px] font-medium mb-1 tracking-wide transition-colors ${
                          isActiveLine ? '!text-white/80' : '!text-white/45'
                        }`}
                      >
                        {line.romanization}
                      </div>
                    )}

                    <div
                      className={`font-bold leading-snug tracking-tight break-words ${
                        isActiveLine
                          ? 'text-[28px] xl:text-[34px] 2xl:text-[38px] !text-white'
                          : 'text-[20px] xl:text-[24px] 2xl:text-[26px] !text-white/90'
                      }`}
                    >
                      <LyricLineText line={line} isActiveLine={isActiveLine} />
                    </div>

                    {line.translation && (
                      <div
                        className={`text-[14px] xl:text-[16px] mt-1 font-normal transition-colors ${
                          isActiveLine ? '!text-white/75' : '!text-white/45'
                        }`}
                      >
                        {line.translation}
                      </div>
                    )}
                  </div>

                  <span className="opacity-0 group-hover:opacity-100 text-[11px] font-mono-tabular px-2.5 py-0.5 rounded-full bg-white/15 !text-white/90 shrink-0 transition-opacity">
                    {formatDuration(Math.floor(line.timeMs / 1000))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative z-10 pb-2" />
    </div>
  );
};

export const AmbientLyricStage: React.FC = () => {
  const isStageOpen = usePlayerStore((s) => s.isStageOpen);

  if (!isStageOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden select-none bg-[#0A0A0E] animate-in fade-in duration-200">
      <ActiveStageBody isStageOpen={isStageOpen} />
    </div>
  );
};
