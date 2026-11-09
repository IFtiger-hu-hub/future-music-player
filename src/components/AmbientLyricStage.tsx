import React, { useEffect, useRef } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sliders,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { SourceId } from '../types/music';
import { formatDuration } from './TrackTable';

const SOURCE_LABELS: Record<SourceId, string> = {
  huawei: '华为音乐',
  local: '本地无损',
  netease: '网易云',
  qq: 'QQ 音乐',
  navidrome: '私有云',
};

/**
 * Isolated sub-component for the active progress & lyrics clock
 * so 50ms time ticks only run when the stage is actually open.
 */
const ActiveStageBody: React.FC<{ isStageOpen: boolean }> = ({ isStageOpen }) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // Only subscribe to 50ms currentTimeMs ticks while stage is open
  const currentTimeMs = usePlayerStore((s) => (isStageOpen ? s.currentTimeMs : 0));
  const lyricOffsetMs = usePlayerStore((s) => s.lyricOffsetMs);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const seekToMs = usePlayerStore((s) => s.seekToMs);
  const switchPlaybackSource = usePlayerStore((s) => s.switchPlaybackSource);
  const adjustLyricOffset = usePlayerStore((s) => s.adjustLyricOffset);
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);

  const effectiveTimeMs = Math.max(0, currentTimeMs + lyricOffsetMs);
  const totalMs = Math.max(1000, currentTrack.durationSeconds * 1000);
  const progressPercent = Math.min(100, (currentTimeMs / totalMs) * 100);

  const foundIdx = currentTrack.lyrics.findIndex(
    (line) => effectiveTimeMs >= line.timeMs && effectiveTimeMs < line.endMs
  );
  const activeLineIndex = foundIdx >= 0 ? foundIdx : 0;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (!isStageOpen) return;
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
  }, [activeLineIndex, isStageOpen, currentTrack.id]);

  const [c1, c2, c3] = currentTrack.dominantColors || [
    '#3F1D2B',
    '#18181B',
    '#09090B',
  ];

  return (
    <>
      {/* Pure GPU-Composited Ambient Background (Zero expensive per-frame backdrop-blur) */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{
          contain: 'strict',
          background: `radial-gradient(circle at 22% 28%, ${c1}cc 0%, transparent 58%), radial-gradient(circle at 78% 75%, ${c2}b3 0%, transparent 62%), linear-gradient(160deg, #141418 0%, ${c3} 100%)`,
        }}
      >
        <img
          src={currentTrack.coverUrl}
          alt=""
          decoding="async"
          className="w-full h-full object-cover opacity-20 scale-110 blur-2xl"
          style={{ transform: 'translateZ(0) scale(1.12)' }}
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      {/* Top Controls Bar */}
      <div className="relative z-10 px-10 pt-7 flex items-center justify-between">
        <button
          onClick={() => setStageOpen(false)}
          className="w-9 h-9 rounded-full bg-white/[0.1] hover:bg-white/[0.18] flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
          title="收起歌词视图 (ESC)"
        >
          <ChevronDown className="w-5 h-5" />
        </button>

        {/* Seamless Source Switcher Pill */}
        <div className="flex items-center gap-1 bg-black/40 border border-white/[0.08] p-1 rounded-full">
          {currentTrack.bindings.map((b) => {
            const isSelected = activeSourceForPlayback === b.source;
            return (
              <button
                key={b.source}
                onClick={() => switchPlaybackSource(b.source)}
                className={`relative px-3.5 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-white/[0.18] !text-white shadow-xs'
                    : 'text-white/55 hover:text-white/85'
                }`}
              >
                <span className="relative z-10 flex items-center gap-1.5">
                  <span>{SOURCE_LABELS[b.source]}</span>
                  <span className="text-[10px] opacity-65">{b.formatLabel}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Subtle Lyric Offset Calibration */}
        <div className="flex items-center gap-2 bg-black/35 border border-white/[0.08] px-3 py-1.5 rounded-full text-[11px] font-mono-tabular text-white/70">
          <Sliders className="w-3 h-3 text-white/60" />
          <span>
            词轴 {lyricOffsetMs >= 0 ? `+${lyricOffsetMs}` : lyricOffsetMs}ms
          </span>
          <button
            onClick={() => adjustLyricOffset(-200)}
            className="px-1.5 py-0.5 rounded-full hover:bg-white/15 text-white/80 cursor-pointer"
          >
            -0.2s
          </button>
          <button
            onClick={() => adjustLyricOffset(200)}
            className="px-1.5 py-0.5 rounded-full hover:bg-white/15 text-white/80 cursor-pointer"
          >
            +0.2s
          </button>
        </div>
      </div>

      {/* Center Apple Music Split Stage */}
      <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-14 items-center px-12 xl:px-20 max-w-[1340px] w-full mx-auto overflow-hidden">
        {/* Left Column: Breathing Album Artwork + Scrubber & Transport */}
        <div className="flex flex-col items-center lg:items-start">
          <div
            className={`w-[310px] h-[310px] xl:w-[360px] xl:h-[360px] rounded-[22px] overflow-hidden shadow-[0_28px_70px_rgba(0,0,0,0.65)] ring-1 ring-white/15 transition-transform duration-500 ease-out ${
              isPlaying ? 'scale-100' : 'scale-[0.92]'
            }`}
            style={{ willChange: 'transform' }}
          >
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="mt-8 w-full max-w-[360px]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[22px] font-bold !text-white truncate tracking-tight">
                  {currentTrack.title}
                </h1>
                <p className="text-[15px] text-white/60 truncate mt-0.5 font-medium">
                  {currentTrack.artists.join(' · ')}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-white/[0.12] text-[10px] font-medium text-white/80 shrink-0">
                无损
              </span>
            </div>

            {/* Minimal Progress Scrubber */}
            <div className="mt-6">
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width)
                  );
                  seekToMs(Math.floor(ratio * totalMs));
                }}
                className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group"
              >
                <div
                  className="h-full rounded-full bg-white/90 group-hover:bg-white"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono-tabular text-white/50">
                <span>{formatDuration(Math.floor(currentTimeMs / 1000))}</span>
                <span>
                  -
                  {formatDuration(
                    Math.max(
                      0,
                      currentTrack.durationSeconds -
                        Math.floor(currentTimeMs / 1000)
                    )
                  )}
                </span>
              </div>
            </div>

            {/* Stage Transport */}
            <div className="mt-4 flex items-center justify-center gap-10">
              <button
                onClick={prevTrack}
                className="text-white/75 hover:text-white transition-transform active:scale-90 cursor-pointer"
              >
                <SkipBack className="w-7 h-7 fill-current" />
              </button>
              <button
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 !text-white flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current ml-0.5" />
                )}
              </button>
              <button
                onClick={nextTrack}
                className="text-white/75 hover:text-white transition-transform active:scale-90 cursor-pointer"
              >
                <SkipForward className="w-7 h-7 fill-current" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Hardware-Accelerated Smooth Lyrics Viewport */}
        <div
          ref={scrollContainerRef}
          className="h-[520px] overflow-y-auto pr-6 py-44 flex flex-col space-y-7 no-scrollbar relative"
        >
          {currentTrack.lyrics.map((line, index) => {
            const isActiveLine = index === activeLineIndex;
            const distance = Math.abs(index - activeLineIndex);
            const opacityVal = isActiveLine
              ? 1
              : Math.max(0.22, 0.52 - distance * 0.1);

            return (
              <div
                key={index}
                ref={(el) => {
                  lineRefs.current[index] = el;
                }}
                onClick={() => seekToMs(line.timeMs)}
                style={{
                  opacity: opacityVal,
                  transform: isActiveLine
                    ? 'translate3d(0, 0, 0) scale(1)'
                    : 'translate3d(0, 0, 0) scale(0.96)',
                }}
                className="cursor-pointer origin-left transition-[transform,opacity] duration-300 ease-out hover:!opacity-95 py-1"
              >
                {/* Cantonese Jyutping / Romanization */}
                {line.romanization && (
                  <div className="text-[13px] font-medium text-white/55 mb-1 tracking-wide">
                    {line.romanization}
                  </div>
                )}

                {/* Main Large Bold Lyric Line */}
                <div className="text-[26px] xl:text-[34px] font-bold leading-[1.26] tracking-tight flex flex-wrap gap-x-1.5">
                  {line.words && line.words.length > 0 && isActiveLine ? (
                    line.words.map((w, wIdx) => {
                      const wordPassed = effectiveTimeMs >= w.endMs;
                      const wordCurrent =
                        effectiveTimeMs >= w.startMs && effectiveTimeMs < w.endMs;

                      return (
                        <span
                          key={wIdx}
                          className={`transition-transform duration-150 ${
                            wordCurrent
                              ? '!text-white -translate-y-[1px]'
                              : wordPassed
                              ? '!text-white'
                              : 'text-white/40'
                          }`}
                        >
                          {w.text}
                        </span>
                      );
                    })
                  ) : (
                    <span className="!text-white">{line.text}</span>
                  )}
                </div>

                {/* Subtitle Translation */}
                {line.translation && (
                  <div className="text-[15px] text-white/60 mt-1.5 font-medium">
                    {line.translation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative z-10 pb-5" />
    </>
  );
};

export const AmbientLyricStage: React.FC = () => {
  const isStageOpen = usePlayerStore((s) => s.isStageOpen);

  return (
    <div
      aria-hidden={!isStageOpen}
      style={{
        willChange: 'transform, opacity',
        contain: 'layout paint style',
        transform: isStageOpen
          ? 'translate3d(0, 0%, 0)'
          : 'translate3d(0, 6%, 0)',
        opacity: isStageOpen ? 1 : 0,
        pointerEvents: isStageOpen ? 'auto' : 'none',
        transition:
          'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden select-none bg-[#0A0A0C]"
    >
      <ActiveStageBody isStageOpen={isStageOpen} />
    </div>
  );
};
