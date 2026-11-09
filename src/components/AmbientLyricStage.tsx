import React, { useEffect, useRef, useState } from 'react';
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
  Sparkles,
  Disc3,
  Lock,
  Unlock,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { SourceId } from '../types/music';
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
  qq: 'QQ 音乐',
  navidrome: '私有云',
};

const ActiveStageBody: React.FC<{ isStageOpen: boolean }> = ({ isStageOpen }) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTimeMs = usePlayerStore((s) => (isStageOpen ? s.currentTimeMs : 0));
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

  const [vinylMode, setVinylMode] = useState(true);
  const [spatialAudioEnabled, setSpatialAudioEnabled] = useState(true);
  const [playMode, setPlayMode] = useState<'sequence' | 'shuffle' | 'repeat'>('sequence');

  const effectiveTimeMs = Math.max(0, currentTimeMs + lyricOffsetMs);
  const totalMs = Math.max(1000, currentTrack.durationSeconds * 1000);
  const progressPercent = Math.min(100, (currentTimeMs / totalMs) * 100);

  const activeLineIndex = findActiveLyricIndex(
    currentTrack.lyrics,
    effectiveTimeMs
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimerRef = useRef<number | null>(null);

  const handleManualScrollActivity = () => {
    setIsUserScrolling(true);
    if (userScrollTimerRef.current !== null) {
      window.clearTimeout(userScrollTimerRef.current);
    }
    userScrollTimerRef.current = window.setTimeout(() => {
      setIsUserScrolling(false);
    }, 4000);
  };

  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current !== null) {
        window.clearTimeout(userScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isStageOpen || isUserScrolling) return;
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
  }, [activeLineIndex, isStageOpen, isUserScrolling, currentTrack.id]);

  const [c1, c2, c3] = currentTrack.dominantColors || [
    '#3F1D2B',
    '#18181B',
    '#09090B',
  ];

  return (
    <>
      {/* HarmonyOS NEXT Dynamic Optical Background (Zero-FBO radial mesh) */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{
          background: `radial-gradient(circle at 24% 32%, ${c1}e6 0%, transparent 58%), radial-gradient(circle at 76% 72%, ${c2}cc 0%, transparent 62%), linear-gradient(155deg, #16171D 0%, ${c3} 100%)`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/40 to-black/70" />
      </div>

      {/* 1. HarmonyOS Top Navigation Bar (PlayerNav) */}
      <div className="relative z-10 px-4 sm:px-8 xl:px-14 pt-4 sm:pt-6 flex items-center justify-between flex-wrap gap-2.5 sm:gap-4 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setStageOpen(false)}
            className="w-9 h-9 rounded-full bg-white/[0.1] hover:bg-white/[0.18] border border-white/[0.1] flex items-center justify-center !text-white/85 hover:!text-white transition-colors cursor-pointer shrink-0"
            title="收起播放页 (ESC)"
          >
            <ChevronDown className="w-5 h-5" />
          </button>

          {/* Toggle Vinyl / Cover Mode */}
          <button
            onClick={() => setVinylMode((v) => !v)}
            className="hidden lg:flex h-8 px-3.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.1] text-[11.5px] font-medium !text-white/85 items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>{vinylMode ? '黑胶唱盘' : '高清画幅'}</span>
          </button>

          {/* HarmonyOS Audio Vivid Spatial Audio Pill */}
          <button
            onClick={() => setSpatialAudioEnabled((v) => !v)}
            className={`h-8 px-3 sm:px-3.5 rounded-full border text-[11.5px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              spatialAudioEnabled
                ? 'bg-gradient-to-r from-[#F5D08A]/25 to-[#E5A93C]/25 border-[#F5D08A]/50 !text-[#FCE3B4] shadow-[0_0_20px_rgba(245,208,138,0.18)]'
                : 'bg-white/[0.06] border-white/[0.1] !text-white/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Audio Vivid 菁彩声</span>
            <span className="sm:hidden">菁彩声</span>
          </button>
        </div>

        {/* Center Multi-Source Lossless Switcher Capsule */}
        <div className="flex items-center gap-1 bg-black/35 border border-white/[0.1] p-1 rounded-full">
          {currentTrack.bindings.map((b) => {
            const isSelected = activeSourceForPlayback === b.source;
            return (
              <button
                key={b.source}
                onClick={() => switchPlaybackSource(b.source)}
                className={`relative px-3.5 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-white/[0.2] !text-white shadow-xs'
                    : '!text-white/55 hover:!text-white/90'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span>{SOURCE_LABELS[b.source]}</span>
                  <span className="text-[10px] font-mono-tabular px-1.5 py-0.2 rounded bg-white/10 !text-[#FCE3B4]">
                    {b.formatLabel}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Lyric Offset Calibration & Desktop Lyric Toggle */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 bg-black/35 border border-white/[0.1] px-3 py-1.5 rounded-full text-[11px] font-mono-tabular !text-white/75">
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
            className={`h-8 px-3.5 rounded-full border text-[11.5px] font-semibold transition-colors cursor-pointer ${
              isDesktopLyricOpen
                ? 'bg-[#FA2D48] border-[#FA2D48] !text-white'
                : 'bg-black/35 border-white/[0.1] !text-white/75 hover:!text-white'
            }`}
          >
            桌面歌词
          </button>

          {isDesktopLyricOpen && (
            <button
              onClick={() => setDesktopLyricLocked(!isDesktopLyricLocked)}
              title={
                isDesktopLyricLocked
                  ? '点击解锁桌面歌词'
                  : '锁定桌面歌词并开启鼠标穿透'
              }
              className={`h-8 px-3 rounded-full border text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                isDesktopLyricLocked
                  ? 'bg-amber-500/20 border-amber-400/50 !text-amber-300'
                  : 'bg-black/35 border-white/[0.1] !text-white/70 hover:!text-white'
              }`}
            >
              {isDesktopLyricLocked ? (
                <>
                  <Lock className="w-3 h-3" />
                  <span>解锁歌词</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3 h-3" />
                  <span>锁定穿透</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 2. HarmonyOS PC Split Stage: Left Vinyl & Control Matrix + Right Fluid Lyrics */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col-reverse lg:grid lg:grid-cols-[380px_1fr] xl:grid-cols-[440px_1fr] gap-4 lg:gap-10 xl:gap-16 items-center px-4 sm:px-8 lg:px-10 xl:px-20 max-w-[1380px] w-full mx-auto overflow-hidden">
        {/* Left Column: HarmonyOS NEXT Vinyl Turntable + 3-Tier Control Matrix */}
        <div className="w-full lg:w-auto flex flex-col items-center shrink-0 pb-2 lg:pb-0">
          {/* Turntable / Cover Display Area (Desktop lg+ only so narrow windows prioritize lyrics) */}
          <div
            onClick={() => setVinylMode((v) => !v)}
            className="hidden lg:flex relative items-center justify-center cursor-pointer pt-4 pb-2"
            title="点击切换黑胶唱盘 / 高清方形封面"
          >
            {vinylMode ? (
              <div className="relative w-[300px] h-[300px] xl:w-[336px] xl:h-[336px] flex items-center justify-center">
                {/* Audio Vivid Spatial Halo Ring */}
                {spatialAudioEnabled && (
                  <div
                    className={`absolute -inset-3 rounded-full border border-[#F5D08A]/25 transition-opacity duration-500 ${
                      isPlaying ? 'opacity-100 scale-100' : 'opacity-30 scale-95'
                    }`}
                    style={{
                      boxShadow: '0 0 50px rgba(245, 208, 138, 0.14)',
                    }}
                  />
                )}

                {/* HarmonyOS Metallic Stylus Tonearm (唱臂与唱针物理起落动效) */}
                <div
                  style={{
                    transformOrigin: '78% 18%',
                    transform: isPlaying ? 'rotate(2deg)' : 'rotate(-26deg)',
                    transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                  className="absolute -top-5 right-3 z-30 w-28 h-40 pointer-events-none"
                >
                  {/* Tonearm Pivot Base */}
                  <div className="absolute top-2 right-3 w-9 h-9 rounded-full bg-gradient-to-b from-white/35 to-white/10 border border-white/30 shadow-lg flex items-center justify-center">
                    <div className="w-3.5 h-3.5 rounded-full bg-[#1C1C20] border border-white/40" />
                  </div>
                  {/* Metallic Arm SVG */}
                  <svg
                    viewBox="0 0 110 150"
                    className="w-full h-full drop-shadow-[0_8px_16px_rgba(0,0,0,0.65)]"
                  >
                    <path
                      d="M 84 26 L 66 96 L 38 128"
                      fill="none"
                      stroke="url(#tonearmGrad)"
                      strokeWidth="5.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <rect
                      x="28"
                      y="120"
                      width="16"
                      height="10"
                      rx="3"
                      transform="rotate(-38 36 125)"
                      fill="#E5E7EB"
                    />
                    <defs>
                      <linearGradient id="tonearmGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#F3F4F6" />
                        <stop offset="50%" stopColor="#9CA3AF" />
                        <stop offset="100%" stopColor="#D1D5DB" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>

                {/* Outer Vinyl Platter with Concentric Grooves & Specular Sheen */}
                <div
                  style={{
                    animationPlayState: isPlaying ? 'running' : 'paused',
                    background:
                      'conic-gradient(from 35deg, #111114 0deg, #27272E 42deg, #111114 90deg, #1F1F25 180deg, #292932 225deg, #111114 275deg, #1E1E24 360deg)',
                  }}
                  className="w-full h-full rounded-full p-[46px] xl:p-[52px] shadow-[0_28px_70px_rgba(0,0,0,0.75)] ring-4 ring-white/10 relative flex items-center justify-center animate-[spin_24s_linear_infinite]"
                >
                  {/* Vinyl Groove Rings */}
                  <div className="absolute inset-4 rounded-full border border-white/[0.06] pointer-events-none" />
                  <div className="absolute inset-8 rounded-full border border-white/[0.05] pointer-events-none" />
                  <div className="absolute inset-11 rounded-full border border-white/[0.07] pointer-events-none" />

                  {/* Center Rotating Album Cover */}
                  <div className="w-full h-full rounded-full overflow-hidden ring-4 ring-[#0C0C0E] shadow-inner relative">
                    <img
                      src={currentTrack.coverUrl}
                      alt={currentTrack.title}
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    {/* Center Spindle Hole */}
                    <div className="absolute inset-0 m-auto w-5 h-5 rounded-full bg-[#121215] border-2 border-white/30 shadow-md" />
                  </div>
                </div>
              </div>
            ) : (
              /* High-Res Square Artwork Mode */
              <div
                className={`w-[300px] h-[300px] xl:w-[336px] xl:h-[336px] rounded-[24px] overflow-hidden shadow-[0_28px_70px_rgba(0,0,0,0.65)] ring-1 ring-white/15 transition-transform duration-500 ease-out ${
                  isPlaying ? 'scale-100' : 'scale-[0.94]'
                }`}
              >
                <img
                  src={currentTrack.coverUrl}
                  alt={currentTrack.title}
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>

          {/* HarmonyOS 3-Tier Control Matrix (MusicControlComponent) */}
          <div className="mt-2 lg:mt-6 w-full max-w-[520px] lg:max-w-[368px] space-y-3 lg:space-y-5">
            {/* Tier 1: Track Identity + Favorite & Audio Quality Badges */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="lg:hidden w-11 h-11 rounded-full overflow-hidden ring-2 ring-white/20 shrink-0 shadow-md">
                  <img
                    src={currentTrack.coverUrl}
                    alt={currentTrack.title}
                    decoding="async"
                    className={`w-full h-full object-cover ${
                      isPlaying ? 'animate-[spin_18s_linear_infinite]' : ''
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-[18px] sm:text-[20px] lg:text-[22px] font-bold !text-white truncate tracking-tight">
                    {currentTrack.title}
                  </h1>
                  <p className="text-[12.5px] sm:text-[14px] !text-white/65 truncate mt-0.5 font-medium">
                    {currentTrack.artists.join(' / ')} · {currentTrack.album}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span className="px-2 py-0.5 rounded-md bg-[#F5D08A]/15 border border-[#F5D08A]/40 text-[10px] font-mono-tabular font-semibold !text-[#FCE3B4]">
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

            {/* Tier 2: Precision Scrubber Slider + Tabular Timestamps */}
            <div>
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width)
                  );
                  seekToMs(Math.floor(ratio * totalMs));
                }}
                className="w-full h-1.5 hover:h-2 rounded-full bg-white/20 overflow-hidden cursor-pointer transition-all group"
              >
                <div
                  className="h-full rounded-full bg-white group-hover:bg-[#FA2D48] transition-colors"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono-tabular !text-white/55">
                <span>{formatDuration(Math.floor(currentTimeMs / 1000))}</span>
                <span>{formatDuration(currentTrack.durationSeconds)}</span>
              </div>
            </div>

            {/* Tier 3: 5-Button Symmetric HarmonyOS Transport Row */}
            <div className="flex items-center justify-between px-1">
              <button
                onClick={() =>
                  setPlayMode((m) =>
                    m === 'sequence'
                      ? 'shuffle'
                      : m === 'shuffle'
                      ? 'repeat'
                      : 'sequence'
                  )
                }
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
                <SkipBack className="w-6 h-6 fill-current" />
              </button>

              <button
                onClick={togglePlay}
                className="w-13 h-13 lg:w-15 lg:h-15 rounded-full bg-white hover:scale-105 active:scale-95 text-[#141418] shadow-[0_12px_30px_rgba(255,255,255,0.22)] flex items-center justify-center transition-transform cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 lg:w-6 lg:h-6 fill-current" />
                ) : (
                  <Play className="w-5 h-5 lg:w-6 lg:h-6 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={nextTrack}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center !text-white/85 hover:!text-white transition-transform active:scale-90 cursor-pointer"
              >
                <SkipForward className="w-6 h-6 fill-current" />
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

            {/* Subtle Volume Slider Strip */}
            <div className="flex items-center gap-3 pt-1 px-2">
              <Volume2 className="w-3.5 h-3.5 !text-white/45 shrink-0" />
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full h-1 accent-white/85 bg-white/15 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Right Column: HarmonyOS NEXT Fluid Lyrics Viewport (LyricComponent) */}
        <div
          ref={scrollContainerRef}
          onWheel={handleManualScrollActivity}
          onTouchMove={handleManualScrollActivity}
          style={{
            maskImage:
              'linear-gradient(to bottom, transparent 0%, black 11%, black 89%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0%, black 11%, black 89%, transparent 100%)',
          }}
          className="w-full flex-1 min-h-0 lg:h-[540px] overflow-y-auto pr-2 sm:pr-6 py-24 lg:py-48 flex flex-col space-y-5 lg:space-y-6 no-scrollbar relative"
        >
          {currentTrack.lyrics.map((line, index) => {
            const isActiveLine = index === activeLineIndex;
            const distance = Math.abs(index - activeLineIndex);
            const opacityVal = isActiveLine
              ? 1
              : isUserScrolling
              ? 0.68
              : Math.max(0.22, 0.56 - distance * 0.09);

            const segments =
              isActiveLine && line.words && line.words.length > 0
                ? buildLyricRenderSegments(line)
                : [];

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
                    ? 'translate3d(0, 0, 0) scale(1)'
                    : 'translate3d(0, 0, 0) scale(0.955)',
                }}
                className="group cursor-pointer origin-left transition-[transform,opacity] duration-300 ease-out hover:!opacity-95 py-2 px-3.5 -mx-3.5 rounded-2xl hover:bg-white/[0.045] flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  {/* Cantonese Jyutping / Romanization */}
                  {line.romanization && (
                    <div
                      className={`text-[13px] font-medium mb-1 tracking-wide transition-colors ${
                        isActiveLine ? '!text-[#FCE3B4]/80' : '!text-white/50'
                      }`}
                    >
                      {line.romanization}
                    </div>
                  )}

                  {/* Main Lyric Line: Unbreakable Word Groups + Smooth 60fps Karaoke Sweep */}
                  <div
                    className={`font-bold leading-[1.36] tracking-tight break-words ${
                      isActiveLine
                        ? 'text-[26px] xl:text-[32px]'
                        : 'text-[20px] xl:text-[24px]'
                    }`}
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
                                  <span
                                    key={gIdx}
                                    style={{
                                      color: '#FCE3B4',
                                      textShadow:
                                        '0 0 18px rgba(245, 208, 138, 0.32), 0 2px 6px rgba(0, 0, 0, 0.5)',
                                    }}
                                  >
                                    {glyph.text}
                                  </span>
                                );
                              }

                              if (state === 'upcoming') {
                                return (
                                  <span
                                    key={gIdx}
                                    style={{
                                      color: 'rgba(255, 255, 255, 0.36)',
                                    }}
                                  >
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
                                    backgroundImage: `linear-gradient(90deg, #FCE3B4 0%, #FFFFFF ${featherStart}%, rgba(255,255,255,0.36) ${featherEnd}%, rgba(255,255,255,0.36) 100%)`,
                                    WebkitBackgroundClip: 'text',
                                    backgroundClip: 'text',
                                    color: 'transparent',
                                    filter:
                                      'drop-shadow(0 0 12px rgba(245, 208, 138, 0.35))',
                                  }}
                                >
                                  {glyph.text}
                                </span>
                              );
                            })}
                          </span>
                        );
                      })
                    ) : isActiveLine ? (
                      <span
                        style={{
                          color: '#FCE3B4',
                          textShadow:
                            '0 0 18px rgba(245, 208, 138, 0.28), 0 2px 6px rgba(0, 0, 0, 0.5)',
                        }}
                      >
                        {line.text}
                      </span>
                    ) : (
                      <span className="!text-white">{line.text}</span>
                    )}
                  </div>

                  {/* Subtitle Translation */}
                  {line.translation && (
                    <div
                      className={`text-[14.5px] mt-1.5 font-medium transition-colors ${
                        isActiveLine ? '!text-white/80' : '!text-white/55'
                      }`}
                    >
                      {line.translation}
                    </div>
                  )}
                </div>

                {/* Hover Timestamp Jump Indicator (HarmonyOS Lyrics Seek Spec) */}
                <span className="opacity-0 group-hover:opacity-100 text-[11px] font-mono-tabular px-2.5 py-0.5 rounded-full bg-white/15 !text-white/85 shrink-0 transition-opacity">
                  {formatDuration(Math.floor(line.timeMs / 1000))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative z-10 pb-4" />
    </>
  );
};

export const AmbientLyricStage: React.FC = () => {
  const isStageOpen = usePlayerStore((s) => s.isStageOpen);

  if (!isStageOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden select-none bg-[#0E0F14] animate-in fade-in duration-200">
      <ActiveStageBody isStageOpen={isStageOpen} />
    </div>
  );
};
