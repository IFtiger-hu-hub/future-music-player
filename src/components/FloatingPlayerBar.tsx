import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Maximize2,
  Heart,
  MessageSquareQuote,
  Loader2,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { formatDuration } from './TrackTable';
import { SourceId } from '../types/music';
import {
  ParametricEqualizerEngine,
  subscribeAudioSeek,
} from '../services/audioEngine';

const SOURCE_LABELS: Record<SourceId, { name: string; short: string }> = {
  huawei: { name: '华为音乐', short: '华为' },
  local: { name: '本地音频', short: '本地' },
  netease: { name: '网易云', short: '网易' },
  qq: { name: 'QQ音乐', short: 'QQ' },
  navidrome: { name: '私有云', short: '云端' },
};

export const FloatingPlayerBar: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isResolvingAudio = usePlayerStore((s) => s.isResolvingAudio);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const volume = usePlayerStore((s) => s.volume);
  const eqBands = usePlayerStore((s) => s.eqBands);
  const isStageOpen = usePlayerStore((s) => s.isStageOpen);
  const isDesktopLyricOpen = usePlayerStore((s) => s.isDesktopLyricOpen);
  const setDesktopLyricOpen = usePlayerStore((s) => s.setDesktopLyricOpen);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const setCurrentTimeMs = usePlayerStore((s) => s.setCurrentTimeMs);
  const setTrackDurationSeconds = usePlayerStore((s) => s.setTrackDurationSeconds);
  const seekToMs = usePlayerStore((s) => s.seekToMs);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);
  const switchPlaybackSource = usePlayerStore((s) => s.switchPlaybackSource);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eqEngineRef = useRef<ParametricEqualizerEngine | null>(null);

  if (!eqEngineRef.current) {
    eqEngineRef.current = new ParametricEqualizerEngine();
  }

  // Sync 10-band EQ gains in real time
  useEffect(() => {
    eqEngineRef.current?.updateBands(eqBands);
  }, [eqBands]);

  // Sync volume
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  // Sync play/pause and stream URL changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!currentTrack.audioUrl) {
      el.pause();
      return;
    }
    if (isPlaying) {
      eqEngineRef.current?.attach(el, eqBands);
      eqEngineRef.current?.resumeIfNeeded();
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, currentTrack.audioUrl]);

  // High-precision 60ms clock only active when a word-by-word lyric view is visible
  useEffect(() => {
    if (!isPlaying || (!isStageOpen && !isDesktopLyricOpen)) return;
    const timer = setInterval(() => {
      const el = audioRef.current;
      if (el && !el.paused && Number.isFinite(el.currentTime)) {
        setCurrentTimeMs(Math.floor(el.currentTime * 1000));
      }
    }, 60);
    return () => clearInterval(timer);
  }, [isPlaying, isStageOpen, isDesktopLyricOpen, setCurrentTimeMs]);

  // Subscribe to seek events from scrubber or lyric click
  useEffect(() => {
    return subscribeAudioSeek((targetMs) => {
      const el = audioRef.current;
      if (el && currentTrack.audioUrl) {
        el.currentTime = Math.max(0, targetMs / 1000);
      }
    });
  }, [currentTrack.audioUrl]);

  const totalDurationMs = Math.max(1000, currentTrack.durationSeconds * 1000);
  const progressPercent = Math.min(100, (currentTimeMs / totalDurationMs) * 100);

  return (
    <div className="px-6 pb-4 pt-1 shrink-0 z-30">
      {/* Production HTML5 Audio Engine */}
      <audio
        ref={audioRef}
        crossOrigin={
          typeof window !== 'undefined' &&
          window.location.protocol.startsWith('http')
            ? 'anonymous'
            : undefined
        }
        preload="auto"
        src={currentTrack.audioUrl || undefined}
        onLoadedMetadata={(e) => {
          const dur = e.currentTarget.duration;
          if (Number.isFinite(dur) && dur > 0) {
            setTrackDurationSeconds(currentTrack.id, dur);
          }
          if (isPlaying) {
            e.currentTarget.play().catch(() => {});
          }
        }}
        onDurationChange={(e) => {
          const dur = e.currentTarget.duration;
          if (Number.isFinite(dur) && dur > 0) {
            setTrackDurationSeconds(currentTrack.id, dur);
          }
        }}
        onTimeUpdate={(e) => {
          setCurrentTimeMs(Math.floor(e.currentTarget.currentTime * 1000));
        }}
        onEnded={nextTrack}
      />

      <div className="h-[68px] rounded-[16px] theme-playerbar backdrop-blur-3xl border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] px-4 flex items-center justify-between gap-6">
        {/* Left: Album Art + Track Title + Artist */}
        <div className="flex items-center gap-3.5 min-w-0 w-[30%]">
          <div
            onClick={() => setStageOpen(true)}
            className="relative w-11 h-11 rounded-[9px] overflow-hidden shadow-md shrink-0 cursor-pointer group bg-white/5 transition-transform duration-200 active:scale-95"
          >
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Maximize2 className="w-3.5 h-3.5 text-white" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStageOpen(true)}
                className="text-[13.5px] font-medium text-white/95 hover:text-white truncate cursor-pointer tracking-[-0.01em]"
              >
                {currentTrack.title}
              </button>
              <button
                onClick={() => toggleFavorite(currentTrack.id)}
                className="text-white/35 hover:text-[#FA2D48] transition-colors cursor-pointer shrink-0"
              >
                <Heart
                  className={`w-3.5 h-3.5 ${
                    currentTrack.isFavorite ? 'text-[#FA2D48] fill-current' : ''
                  }`}
                />
              </button>
            </div>
            <div className="text-[11.5px] text-white/45 truncate mt-0.5">
              {currentTrack.artists.join('、')}
            </div>
          </div>
        </div>

        {/* Center: Apple Music Transport + Full-Duration Scrubber Bar */}
        <div className="flex flex-col items-center justify-center flex-1 max-w-md">
          <div className="flex items-center gap-5">
            <button
              onClick={prevTrack}
              className="text-white/70 hover:text-white transition-colors cursor-pointer"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={togglePlay}
              style={{
                backgroundColor: 'var(--theme-text)',
                color: 'var(--theme-base)',
              }}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-sm cursor-pointer"
            >
              {isResolvingAudio ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={nextTrack}
              className="text-white/70 hover:text-white transition-colors cursor-pointer"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* Apple-style Slim Scrubber (Full Track Duration) */}
          <div className="w-full flex items-center gap-2.5 mt-1.5">
            <span className="text-[10px] font-mono-tabular text-white/35 w-8 text-right">
              {formatDuration(Math.floor(currentTimeMs / 1000))}
            </span>
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const targetMs = Math.floor(ratio * totalDurationMs);
                seekToMs(targetMs);
              }}
              className="flex-1 h-[3px] hover:h-[6px] rounded-full bg-white/[0.12] overflow-hidden cursor-pointer transition-all"
            >
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: 'var(--theme-accent)',
                }}
              />
            </div>
            <span className="text-[10px] font-mono-tabular text-white/35 w-8">
              {formatDuration(currentTrack.durationSeconds)}
            </span>
          </div>
        </div>

        {/* Right: Restrained Source Selector + Volume + Lyrics Stage Toggle */}
        <div className="flex items-center justify-end gap-3 w-[30%]">
          {/* Subtle Multi-source Segmented Pill */}
          <div className="hidden xl:flex items-center p-0.5 rounded-lg bg-white/[0.06]">
            {currentTrack.bindings.map((b) => {
              const info = SOURCE_LABELS[b.source];
              const isSelected = activeSourceForPlayback === b.source;
              return (
                <button
                  key={b.source}
                  onClick={() => switchPlaybackSource(b.source)}
                  title={`切换音源: ${info.name} (${b.formatLabel})`}
                  className={`relative px-2 py-0.5 rounded-[6px] text-[11px] transition-colors cursor-pointer ${
                    isSelected ? 'text-white font-medium' : 'text-white/45 hover:text-white/80'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="player-bar-source-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-[6px] bg-white/[0.15]"
                    />
                  )}
                  <span className="relative z-10">{info.short}</span>
                </button>
              );
            })}
          </div>

          {/* Volume Slider */}
          <div className="hidden md:flex items-center gap-1.5 w-24">
            <Volume2 className="w-3.5 h-3.5 text-white/45 shrink-0" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full h-1 accent-white/80 bg-white/15 rounded-lg cursor-pointer"
            />
          </div>

          {/* Desktop Floating Lyric Toggle */}
          <button
            onClick={() => setDesktopLyricOpen(!isDesktopLyricOpen)}
            title="桌面悬浮歌词"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
              isDesktopLyricOpen
                ? 'bg-white/20 text-white'
                : 'text-white/45 hover:text-white/85 hover:bg-white/[0.06]'
            }`}
          >
            桌面词
          </button>

          {/* Apple Music Lyric Bubble Icon Button */}
          <button
            onClick={() => setStageOpen(!isStageOpen)}
            title="打开沉浸式歌词"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              isStageOpen
                ? 'bg-white/20 text-white'
                : 'text-white/55 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            <MessageSquareQuote className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
