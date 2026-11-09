import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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

export const AmbientLyricStage: React.FC = () => {
  const isStageOpen = usePlayerStore((s) => s.isStageOpen);
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const lyricOffsetMs = usePlayerStore((s) => s.lyricOffsetMs);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const seekToMs = usePlayerStore((s) => s.seekToMs);
  const switchPlaybackSource = usePlayerStore((s) => s.switchPlaybackSource);
  const adjustLyricOffset = usePlayerStore((s) => s.adjustLyricOffset);

  const effectiveTimeMs = Math.max(0, currentTimeMs + lyricOffsetMs);
  const totalMs = Math.max(1000, currentTrack.durationSeconds * 1000);
  const progressPercent = Math.min(100, (currentTimeMs / totalMs) * 100);

  // Find active line index for optical depth-of-field blur distance calculation
  const foundIdx = currentTrack.lyrics.findIndex(
    (line) => effectiveTimeMs >= line.timeMs && effectiveTimeMs < line.endMs
  );
  const activeLineIndex = foundIdx >= 0 ? foundIdx : 0;

  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (!isStageOpen) return;
    const targetEl = lineRefs.current[activeLineIndex];
    if (targetEl && typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIndex, isStageOpen, currentTrack.id]);

  return (
    <AnimatePresence>
      {isStageOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden select-none bg-[#0A0A0C]"
        >
          {/* Apple Music Multi-Layer Blurred Album Cover Mesh Background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <img
              src={currentTrack.coverUrl}
              alt=""
              className="absolute -top-1/4 -left-1/4 w-[95%] h-[95%] object-cover rounded-full blur-[120px] saturate-[2.1] opacity-55 scale-125"
            />
            <img
              src={currentTrack.coverUrl}
              alt=""
              className="absolute -bottom-1/4 -right-1/4 w-[90%] h-[90%] object-cover rounded-full blur-[130px] saturate-[1.9] opacity-45 scale-125"
            />
            <div className="absolute inset-0 bg-black/45 backdrop-blur-[80px]" />
          </div>

          {/* Top Controls Bar — Restrained Apple Music Pill Header */}
          <div className="relative z-10 px-10 pt-7 flex items-center justify-between">
            <button
              onClick={() => setStageOpen(false)}
              className="w-9 h-9 rounded-full bg-white/[0.1] hover:bg-white/[0.18] flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              title="收起歌词视图 (ESC)"
            >
              <ChevronDown className="w-5 h-5" />
            </button>

            {/* Seamless Source Switcher Pill */}
            <div className="flex items-center gap-1 bg-black/30 backdrop-blur-xl border border-white/[0.08] p-1 rounded-full">
              {currentTrack.bindings.map((b) => {
                const isSelected = activeSourceForPlayback === b.source;
                return (
                  <button
                    key={b.source}
                    onClick={() => switchPlaybackSource(b.source)}
                    className={`relative px-3.5 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer ${
                      isSelected ? 'text-white' : 'text-white/55 hover:text-white/85'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="stage-source-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-full bg-white/[0.18] shadow-sm"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      <span>{SOURCE_LABELS[b.source]}</span>
                      <span className="text-[10px] opacity-65">{b.formatLabel}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Subtle Lyric Offset Calibration */}
            <div className="flex items-center gap-2 bg-black/25 backdrop-blur-xl border border-white/[0.08] px-3 py-1.5 rounded-full text-[11px] font-mono-tabular text-white/70">
              <Sliders className="w-3 h-3 text-white/60" />
              <span>词轴 {lyricOffsetMs >= 0 ? `+${lyricOffsetMs}` : lyricOffsetMs}ms</span>
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
          <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-16 items-center px-12 xl:px-20 max-w-[1360px] w-full mx-auto overflow-hidden">
            {/* Left Column: Breathing Album Artwork + Apple Music Scrubber & Transport */}
            <div className="flex flex-col items-center lg:items-start">
              <motion.div
                layoutId="shared-album-cover"
                animate={{
                  scale: isPlaying ? 1 : 0.91,
                }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                className="w-[320px] h-[320px] xl:w-[370px] xl:h-[370px] rounded-[22px] overflow-hidden shadow-[0_36px_90px_rgba(0,0,0,0.75)] ring-1 ring-white/15"
              >
                <img
                  src={currentTrack.coverUrl}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              </motion.div>

              <div className="mt-8 w-full max-w-[370px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-[22px] font-bold text-white truncate tracking-tight">
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

                {/* Apple Music Minimal Progress Scrubber */}
                <div className="mt-6">
                  <div
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      seekToMs(Math.floor(ratio * totalMs));
                    }}
                    className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group"
                  >
                    <div
                      className="h-full rounded-full bg-white/90 group-hover:bg-white transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono-tabular text-white/50">
                    <span>{formatDuration(Math.floor(currentTimeMs / 1000))}</span>
                    <span>-{formatDuration(Math.max(0, currentTrack.durationSeconds - Math.floor(currentTimeMs / 1000)))}</span>
                  </div>
                </div>

                {/* Apple Music Stage Transport */}
                <div className="mt-4 flex items-center justify-center gap-10">
                  <button
                    onClick={prevTrack}
                    className="text-white/75 hover:text-white transition-transform active:scale-90 cursor-pointer"
                  >
                    <SkipBack className="w-7 h-7 fill-current" />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
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

            {/* Right Column: Apple Music Borderless Optical Depth-of-Field Lyrics */}
            <div className="h-[540px] overflow-y-auto pr-6 py-44 flex flex-col space-y-8 no-scrollbar">
              {currentTrack.lyrics.map((line, index) => {
                const isActiveLine = index === activeLineIndex;
                const distance = Math.abs(index - activeLineIndex);
                const blurPx = isActiveLine ? 0 : Math.min(3.2, distance * 1.15);
                const opacityVal = isActiveLine ? 1 : Math.max(0.22, 0.55 - distance * 0.12);

                return (
                  <motion.div
                    key={index}
                    ref={(el) => {
                      lineRefs.current[index] = el;
                    }}
                    layout
                    onClick={() => seekToMs(line.timeMs)}
                    animate={{
                      scale: isActiveLine ? 1 : 0.96,
                      opacity: opacityVal,
                      filter: `blur(${blurPx}px)`,
                    }}
                    transition={{
                      type: 'spring',
                      stiffness: 320,
                      damping: 30,
                    }}
                    className="cursor-pointer origin-left transition-opacity hover:!opacity-90 hover:!blur-none py-1"
                  >
                    {/* Cantonese Jyutping / Romanization */}
                    {line.romanization && (
                      <div className="text-[13px] font-medium text-white/55 mb-1 tracking-wide">
                        {line.romanization}
                      </div>
                    )}

                    {/* Main Apple Music Large Bold Lyric Line */}
                    <div className="text-[28px] xl:text-[36px] font-bold leading-[1.24] tracking-tight flex flex-wrap gap-x-1.5">
                      {line.words && line.words.length > 0 ? (
                        line.words.map((w, wIdx) => {
                          const wordPassed = effectiveTimeMs >= w.endMs;
                          const wordCurrent =
                            effectiveTimeMs >= w.startMs && effectiveTimeMs < w.endMs;

                          return (
                            <span
                              key={wIdx}
                              className={`transition-all duration-150 ${
                                wordCurrent
                                  ? 'text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.75)] -translate-y-[1px]'
                                  : wordPassed && isActiveLine
                                  ? 'text-white'
                                  : isActiveLine
                                  ? 'text-white/40'
                                  : 'text-white'
                              }`}
                            >
                              {w.text}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-white">{line.text}</span>
                      )}
                    </div>

                    {/* Subtitle Translation */}
                    {line.translation && (
                      <div className="text-[16px] text-white/60 mt-1.5 font-medium">
                        {line.translation}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="relative z-10 pb-5" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
