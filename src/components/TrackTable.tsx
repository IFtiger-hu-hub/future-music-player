import React from 'react';
import { Play, Heart } from 'lucide-react';
import { CanonicalTrack, SourceId } from '../types/music';
import { usePlayerStore } from '../store/usePlayerStore';

const SOURCE_LABELS: Record<SourceId, string> = {
  huawei: '华为',
  local: '本地',
  netease: '网易',
  qq: 'QQ',
  navidrome: '云端',
};

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface TrackTableProps {
  tracks: CanonicalTrack[];
}

export const TrackTable: React.FC<TrackTableProps> = ({ tracks }) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);

  if (tracks.length === 0) {
    return (
      <div className="py-16 text-center rounded-[22px] surface-bento">
        <p className="text-[14px] font-medium text-white/60">
          当前分类下暂无歌曲
        </p>
        <p className="text-[12px] text-white/40 mt-1">
          可切换顶部音源胶囊或扫码同步华为音乐云端曲库
        </p>
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      {/* HarmonyOS Clean Chinese Column Headers */}
      <div className="grid grid-cols-[44px_2.1fr_1.15fr_140px_76px] gap-4 px-4 py-2.5 text-[12px] font-medium text-white/45 border-b border-white/[0.06]">
        <div className="text-center">序号</div>
        <div>歌曲 / 歌手</div>
        <div>专辑</div>
        <div>音源切换</div>
        <div className="text-right pr-1">时长</div>
      </div>

      {/* Track Rows */}
      <div className="divide-y divide-white/[0.03] mt-1">
        {tracks.map((track, index) => {
          const isCurrent = currentTrack.id === track.id;
          const hasLossless = track.bindings.some(
            (b) => b.quality === 'hires' || b.quality === 'lossless'
          );

          return (
            <div
              key={track.id}
              onDoubleClick={() => playTrack(track)}
              className={`group grid grid-cols-[44px_2.1fr_1.15fr_140px_76px] gap-4 items-center px-4 py-2.5 rounded-[14px] transition-colors duration-150 cursor-pointer ${
                isCurrent
                  ? 'bg-[#FA2D48]/[0.08]'
                  : 'hover:bg-white/[0.045]'
              }`}
            >
              {/* Index / Play Button / Animated Equalizer Bars */}
              <div className="flex items-center justify-center">
                {isCurrent && isPlaying ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="flex items-end gap-[2.5px] h-3.5 cursor-pointer"
                  >
                    <span
                      className="w-[2.5px] h-3.5 rounded-full animate-pulse"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    />
                    <span
                      className="w-[2.5px] h-2 rounded-full animate-pulse [animation-delay:150ms]"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    />
                    <span
                      className="w-[2.5px] h-3 rounded-full animate-pulse [animation-delay:300ms]"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    />
                  </button>
                ) : (
                  <>
                    <span
                      className={`text-[12.5px] font-mono-tabular group-hover:hidden ${
                        isCurrent ? 'font-bold' : 'text-white/40'
                      }`}
                      style={isCurrent ? { color: 'var(--theme-accent)' } : undefined}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isCurrent) {
                          togglePlay();
                        } else {
                          playTrack(track);
                        }
                      }}
                      className="hidden group-hover:flex items-center justify-center text-white cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  </>
                )}
              </div>

              {/* Artwork + Title + Huawei SQ Badge + Artist */}
              <div
                onClick={() => playTrack(track)}
                className="flex items-center gap-3.5 min-w-0"
              >
                <div className="relative w-11 h-11 rounded-[10px] overflow-hidden shrink-0 bg-white/5 ring-1 ring-black/[0.06] shadow-xs">
                  <img
                    src={track.coverUrl}
                    alt={track.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[14px] font-semibold truncate ${
                        isCurrent ? '' : 'text-white/95'
                      }`}
                      style={isCurrent ? { color: 'var(--theme-accent)' } : undefined}
                    >
                      {track.title}
                    </span>
                    {hasLossless && (
                      <span className="badge-lossless shrink-0">SQ 无损</span>
                    )}
                  </div>
                  <div className="text-[12px] text-white/50 truncate mt-0.5">
                    {track.artists.join(' / ')}
                  </div>
                </div>
              </div>

              {/* Album */}
              <div className="text-[12.5px] text-white/50 truncate pr-2">
                {track.album}
              </div>

              {/* Multi-Source Direct Capsule Switcher */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {track.bindings.map((b) => {
                  const isActiveSource =
                    isCurrent && activeSourceForPlayback === b.source;
                  return (
                    <button
                      key={b.source}
                      onClick={(e) => {
                        e.stopPropagation();
                        playTrack(track, b.source);
                      }}
                      title={`使用 ${SOURCE_LABELS[b.source]} 播放 (${b.formatLabel})`}
                      style={
                        isActiveSource
                          ? { backgroundColor: 'var(--theme-accent)' }
                          : undefined
                      }
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                        isActiveSource
                          ? '!text-white shadow-xs'
                          : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12] hover:text-white border border-white/[0.06]'
                      }`}
                    >
                      {SOURCE_LABELS[b.source]}
                    </button>
                  );
                })}
              </div>

              {/* Favorite Heart + Tabular Duration */}
              <div className="flex items-center justify-end gap-3 pr-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(track.id);
                  }}
                  className={`transition-opacity cursor-pointer ${
                    track.isFavorite
                      ? 'opacity-100 text-[#FA2D48]'
                      : 'opacity-0 group-hover:opacity-100 text-white/40 hover:text-[#FA2D48]'
                  }`}
                >
                  <Heart
                    className={`w-4 h-4 ${
                      track.isFavorite ? 'fill-current' : ''
                    }`}
                  />
                </button>
                <span className="text-[12px] font-mono-tabular text-white/50 w-9 text-right">
                  {formatDuration(track.durationSeconds)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
