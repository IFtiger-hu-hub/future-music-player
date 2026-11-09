import React from 'react';
import { motion } from 'motion/react';
import { Play, Pause, Heart, Volume2 } from 'lucide-react';
import { CanonicalTrack, SourceId } from '../types/music';
import { usePlayerStore } from '../store/usePlayerStore';

const SOURCE_NAMES: Record<SourceId, { short: string; full: string }> = {
  huawei: { short: '华为', full: '华为音乐无损' },
  local: { short: '本地', full: '本地音频文件' },
  netease: { short: '网易', full: '网易云音乐' },
  qq: { short: 'QQ', full: 'QQ 音乐' },
  navidrome: { short: '私有云', full: '私有云 Subsonic' },
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface TrackTableProps {
  tracks: CanonicalTrack[];
  emptyMessage?: string;
}

export const TrackTable: React.FC<TrackTableProps> = ({
  tracks,
  emptyMessage = '暂无曲目',
}) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const activeSourceForPlayback = usePlayerStore((s) => s.activeSourceForPlayback);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);

  if (tracks.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-[14px] text-white/45">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      {/* Subtle Apple Music Column Header */}
      <div className="grid grid-cols-[36px_1.8fr_1.1fr_1fr_72px] items-center px-3 pb-2 border-b border-white/[0.06] text-[11px] font-medium text-white/35">
        <span className="text-center">#</span>
        <span>歌曲</span>
        <span>专辑</span>
        <span>可用音源</span>
        <span className="text-right pr-1">时长</span>
      </div>

      {/* Clean Track List */}
      <div className="mt-1 space-y-0.5">
        {tracks.map((track, idx) => {
          const isCurrent = currentTrack.id === track.id;

          return (
            <motion.div
              key={track.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.18,
                delay: Math.min(idx * 0.015, 0.2),
              }}
              onDoubleClick={() => playTrack(track)}
              className={`grid grid-cols-[36px_1.8fr_1.1fr_1fr_72px] items-center px-3 py-2 rounded-xl transition-colors group ${
                isCurrent
                  ? 'bg-white/[0.09]'
                  : 'hover:bg-white/[0.045] odd:bg-white/[0.012]'
              }`}
            >
              {/* Track Index / Play */}
              <div className="flex items-center justify-center">
                <button
                  onClick={() => (isCurrent ? togglePlay() : playTrack(track))}
                  className="w-6 h-6 flex items-center justify-center text-white/35 group-hover:text-white transition-colors cursor-pointer"
                >
                  {isCurrent && isPlaying ? (
                    <Volume2
                      className="w-3.5 h-3.5"
                      style={{ color: 'var(--theme-accent)' }}
                    />
                  ) : isCurrent ? (
                    <Play
                      className="w-3.5 h-3.5 fill-current"
                      style={{ color: 'var(--theme-accent)' }}
                    />
                  ) : (
                    <>
                      <span className="font-mono-tabular text-[12px] group-hover:hidden">
                        {idx + 1}
                      </span>
                      <Play className="w-3.5 h-3.5 hidden group-hover:block text-white fill-current" />
                    </>
                  )}
                </button>
              </div>

              {/* Cover + Title + Artist */}
              <div className="flex items-center gap-3.5 min-w-0 pr-4">
                <div
                  onClick={() => (isCurrent ? togglePlay() : playTrack(track))}
                  className="relative w-10 h-10 rounded-[7px] overflow-hidden shrink-0 shadow-sm bg-white/5 cursor-pointer"
                >
                  <img
                    src={track.coverUrl}
                    alt={track.title}
                    className="w-full h-full object-cover"
                  />
                  {isCurrent && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      {isPlaying ? (
                        <Pause className="w-3.5 h-3.5 text-white fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 text-white fill-current" />
                      )}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      onClick={() => playTrack(track)}
                      style={{
                        color: isCurrent ? 'var(--theme-accent)' : undefined,
                      }}
                      className={`text-[13.5px] font-medium tracking-[-0.01em] truncate cursor-pointer ${
                        isCurrent ? '' : 'text-white/92'
                      }`}
                    >
                      {track.title}
                    </span>
                    <span className="text-[9px] font-semibold tracking-wider uppercase px-1.5 py-[1px] rounded-[4px] bg-white/[0.08] text-white/55 shrink-0">
                      无损
                    </span>
                  </div>
                  <div className="text-[12px] text-white/45 truncate mt-0.5">
                    {track.artists.join('、')}
                  </div>
                </div>
              </div>

              {/* Album */}
              <div className="text-[12.5px] text-white/45 truncate pr-4">
                {track.album}
              </div>

              {/* Restrained Apple-style Source Pills */}
              <div className="flex items-center flex-wrap gap-1 pr-2">
                {track.bindings.map((binding) => {
                  const meta = SOURCE_NAMES[binding.source];
                  const isSelected =
                    isCurrent && activeSourceForPlayback === binding.source;

                  return (
                    <button
                      key={`${track.id}-${binding.source}`}
                      onClick={() => playTrack(track, binding.source)}
                      title={`点击切换至 ${meta.full} (${binding.formatLabel})`}
                      className={`px-2 py-0.5 rounded-md text-[11px] transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-white/20 text-white font-medium shadow-xs'
                          : binding.access === 'preview'
                          ? 'bg-white/[0.03] text-white/30 hover:text-white/60'
                          : 'bg-white/[0.05] text-white/50 hover:bg-white/[0.11] hover:text-white/90'
                      }`}
                    >
                      {meta.short}
                    </button>
                  );
                })}
              </div>

              {/* Favorite + Duration */}
              <div className="flex items-center justify-end gap-3 pr-1">
                <button
                  onClick={() => toggleFavorite(track.id)}
                  style={{
                    color: track.isFavorite ? 'var(--theme-accent)' : undefined,
                  }}
                  className={`transition-opacity cursor-pointer ${
                    track.isFavorite
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 text-white/35 hover:text-white/80'
                  }`}
                >
                  <Heart
                    className={`w-3.5 h-3.5 ${track.isFavorite ? 'fill-current' : ''}`}
                  />
                </button>
                <span className="font-mono-tabular text-[12px] text-white/40 w-9 text-right">
                  {formatDuration(track.durationSeconds)}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
