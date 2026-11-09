import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Play,
  Pause,
  SkipForward,
  Heart,
  Music,
  Loader2,
  Home,
  Disc3,
  Radio,
  User,
  SlidersHorizontal,
  Lock,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { NavSection, SourceId } from '../types/music';
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

const HARMONY_BOTTOM_TABS: Array<{
  id: NavSection;
  matchIds: NavSection[];
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}> = [
  {
    id: 'favorites',
    matchIds: ['favorites'],
    label: '推荐',
    icon: Home,
  },
  {
    id: 'local_playlists',
    matchIds: ['local_playlists', 'imported_playlists'],
    label: '音乐厅',
    icon: Disc3,
  },
  {
    id: 'sources',
    matchIds: ['sources'],
    label: 'Cafe馆',
    icon: Radio,
  },
  {
    id: 'history',
    matchIds: ['history', 'search'],
    label: '我的',
    icon: User,
  },
  {
    id: 'settings',
    matchIds: ['settings'],
    label: '均衡',
    icon: SlidersHorizontal,
  },
];

export const FloatingPlayerBar: React.FC = () => {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isResolvingAudio = usePlayerStore((s) => s.isResolvingAudio);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const volume = usePlayerStore((s) => s.volume);
  const eqBands = usePlayerStore((s) => s.eqBands);
  const isStageOpen = usePlayerStore((s) => s.isStageOpen);
  const isDesktopLyricOpen = usePlayerStore((s) => s.isDesktopLyricOpen);
  const isDesktopLyricLocked = usePlayerStore((s) => s.isDesktopLyricLocked);
  const setDesktopLyricOpen = usePlayerStore((s) => s.setDesktopLyricOpen);
  const setDesktopLyricLocked = usePlayerStore((s) => s.setDesktopLyricLocked);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const setCurrentTimeMs = usePlayerStore((s) => s.setCurrentTimeMs);
  const setTrackDurationSeconds = usePlayerStore((s) => s.setTrackDurationSeconds);
  const seekToMs = usePlayerStore((s) => s.seekToMs);
  const setStageOpen = usePlayerStore((s) => s.setStageOpen);
  const switchPlaybackSource = usePlayerStore((s) => s.switchPlaybackSource);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eqEngineRef = useRef<ParametricEqualizerEngine | null>(null);

  if (!eqEngineRef.current) {
    eqEngineRef.current = new ParametricEqualizerEngine();
  }

  useEffect(() => {
    eqEngineRef.current?.updateBands(eqBands);
  }, [eqBands]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

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

  useEffect(() => {
    if (!isPlaying || (!isStageOpen && !isDesktopLyricOpen)) return;
    let rafId = 0;
    let lastDispatchedMs = -1;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused && Number.isFinite(el.currentTime)) {
        const nowMs = Math.floor(el.currentTime * 1000);
        if (Math.abs(nowMs - lastDispatchedMs) >= 24) {
          lastDispatchedMs = nowMs;
          setCurrentTimeMs(nowMs);
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, isStageOpen, isDesktopLyricOpen, setCurrentTimeMs]);

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
    <div className="fixed bottom-5 left-8 right-8 xl:left-12 xl:right-12 z-30 pointer-events-none flex items-center justify-between gap-4 select-none">
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

      {/* Bottom-Left Floating HarmonyOS Navigation Capsule (推荐 / 音乐厅 / Cafe馆 / 我的) */}
      <nav className="pointer-events-auto h-[62px] px-3 rounded-full theme-harmony-dock backdrop-blur-2xl border flex items-center gap-1 sm:gap-2">
        {HARMONY_BOTTOM_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.matchIds.includes(activeNav);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveNav(tab.id)}
              className="relative px-4 py-1.5 rounded-full flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors"
            >
              {isActive && (
                <motion.div
                  layoutId="harmony-bottom-nav-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full bg-white/[0.12]"
                />
              )}
              <Icon
                style={isActive ? { color: 'var(--theme-accent)' } : undefined}
                className={`relative z-10 w-[18px] h-[18px] transition-colors ${
                  isActive ? '' : 'text-white/55'
                }`}
              />
              <span
                style={isActive ? { color: 'var(--theme-accent)' } : undefined}
                className={`relative z-10 text-[10.5px] font-semibold leading-none ${
                  isActive ? '' : 'text-white/55'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Bottom-Right Floating HarmonyOS Vinyl Mini-Player Capsule (Exact Match to Screenshot) */}
      <div className="pointer-events-auto h-[62px] pl-2.5 pr-4 rounded-full theme-harmony-dock backdrop-blur-2xl border flex items-center gap-4 min-w-[320px] sm:min-w-[400px] max-w-[540px] relative overflow-hidden">
        {/* Subtle Bottom Progress Line Inside Capsule */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(
              0,
              Math.min(1, (e.clientX - rect.left) / rect.width)
            );
            seekToMs(Math.floor(ratio * totalDurationMs));
          }}
          className="absolute bottom-0 left-6 right-6 h-[2.5px] bg-white/[0.1] cursor-pointer"
        >
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${progressPercent}%`,
              backgroundColor: 'var(--theme-accent)',
            }}
          />
        </div>

        {/* Left: Composite Black Vinyl Record + Circular Album Cover */}
        <div
          onClick={() => setStageOpen(true)}
          className="relative flex items-center shrink-0 cursor-pointer group pl-2"
          title="展开沉浸式歌词详情页"
        >
          {/* Peeking Black Vinyl Disc on Left */}
          <div className="absolute left-0 w-10 h-10 rounded-full bg-gradient-to-tr from-[#0B0B0D] via-[#232329] to-[#111115] ring-1 ring-black/30 shadow-md flex items-center justify-center">
            <div className="w-3.5 h-3.5 rounded-full border border-white/15 bg-[#FA2D48]/80" />
          </div>

          {/* Circular Album Cover */}
          <div
            className={`relative z-10 w-11 h-11 rounded-full overflow-hidden shadow-md ring-2 ring-white/25 transition-transform duration-300 group-hover:scale-105 ${
              isPlaying ? 'animate-[spin_18s_linear_infinite]' : ''
            }`}
          >
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Center: Track Title & Artist */}
        <div
          onClick={() => setStageOpen(true)}
          className="min-w-0 flex-1 cursor-pointer"
        >
          <div className="text-[13.5px] font-bold text-white truncate leading-tight">
            {currentTrack.title}
          </div>
          <div className="text-[11px] text-white/55 truncate mt-0.5">
            {currentTrack.artists.join(' / ')}
          </div>
        </div>

        {/* Right: Multi-Source Pill + Transport Controls (Heart / Play / Next / Lyrics) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Source Selector Pill */}
          <div className="hidden sm:flex items-center p-0.5 rounded-full bg-white/[0.06] border border-white/[0.07]">
            {currentTrack.bindings.map((b) => {
              const info = SOURCE_LABELS[b.source];
              const isSelected = activeSourceForPlayback === b.source;
              return (
                <button
                  key={b.source}
                  onClick={() => switchPlaybackSource(b.source)}
                  title={`切换音源: ${info.name} (${b.formatLabel})`}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#FA2D48] !text-white'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  {info.short}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => toggleFavorite(currentTrack.id)}
            className="text-white/55 hover:text-[#FA2D48] transition-colors cursor-pointer"
            title="喜欢"
          >
            <Heart
              className={`w-4 h-4 ${
                currentTrack.isFavorite ? 'text-[#FA2D48] fill-current' : ''
              }`}
            />
          </button>

          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            title={isPlaying ? '暂停' : '播放'}
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
            className="text-white/75 hover:text-white transition-colors cursor-pointer"
            title="下一首"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>

          <button
            onClick={() => setDesktopLyricOpen(!isDesktopLyricOpen)}
            title="开启 / 关闭系统桌面悬浮歌词窗口"
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold transition-colors cursor-pointer ${
              isDesktopLyricOpen
                ? 'bg-[#FA2D48] !text-white'
                : 'text-white/55 hover:text-white'
            }`}
          >
            词
          </button>

          {isDesktopLyricOpen && isDesktopLyricLocked && (
            <button
              onClick={() => setDesktopLyricLocked(false)}
              title="桌面歌词当前已锁定穿透，点击解锁"
              className="p-1 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => setStageOpen(!isStageOpen)}
            className="text-white/75 hover:text-white transition-colors cursor-pointer"
            title="展开歌词详情页"
          >
            <Music className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
