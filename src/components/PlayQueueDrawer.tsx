import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Trash2,
  Play,
  Pause,
  Repeat,
  Repeat1,
  Shuffle,
  Music,
  ArrowUp,
  ArrowDown,
  ListMusic,
  Disc3,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { CanonicalTrack } from '../types/music';
import { formatDuration, toThumbnailCoverUrl } from './TrackTable';

export const PlayQueueDrawer: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isPlayQueueOpen);
  const setOpen = usePlayerStore((s) => s.setPlayQueueOpen);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const tracks = usePlayerStore((s) => s.tracks);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playMode = usePlayerStore((s) => s.playMode);
  const cyclePlayMode = usePlayerStore((s) => s.cyclePlayMode);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const displayList = playQueue.length > 0 ? playQueue : tracks;
  const isCustomQueue = playQueue.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-xs"
          />

          {/* Drawer Pane */}
          <motion.div
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="fixed bottom-20 md:bottom-24 right-3 sm:right-6 md:right-8 z-50 w-[min(94vw,440px)] max-h-[72vh] rounded-[28px] theme-modal backdrop-blur-2xl border shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center shrink-0">
                  <ListMusic
                    className="w-4 h-4"
                    style={{ color: 'var(--theme-accent)' }}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
                    <span>播放队列</span>
                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-white/[0.08] text-white/60">
                      {isCustomQueue
                        ? `插队 ${playQueue.length} 首`
                        : `列表 ${tracks.length} 首`}
                    </span>
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Play Mode Toggle */}
                <button
                  onClick={cyclePlayMode}
                  title={
                    playMode === 'sequential'
                      ? '列表循环'
                      : playMode === 'repeat_one'
                      ? '单曲循环'
                      : '随机播放'
                  }
                  className="h-8 px-2.5 rounded-full btn-harmony-secondary text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {playMode === 'shuffle' ? (
                    <Shuffle className="w-3.5 h-3.5" />
                  ) : playMode === 'repeat_one' ? (
                    <Repeat1 className="w-3.5 h-3.5 text-[#FA2D48]" />
                  ) : (
                    <Repeat className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {playMode === 'sequential'
                      ? '列表循环'
                      : playMode === 'repeat_one'
                      ? '单曲循环'
                      : '随机'}
                  </span>
                </button>

                {/* Clear queue if custom */}
                {isCustomQueue && (
                  <button
                    onClick={clearQueue}
                    title="清空插队队列"
                    className="w-8 h-8 rounded-full btn-harmony-secondary flex items-center justify-center cursor-pointer text-white/60 hover:text-white"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full btn-harmony-secondary flex items-center justify-center cursor-pointer text-white/70 hover:text-white"
                  title="关闭队列"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03] p-2 space-y-1 no-scrollbar">
              {displayList.map((track, idx) => {
                const isCurrent = currentTrack.id === track.id;
                return (
                  <div
                    key={`${track.id}-${idx}`}
                    onClick={() => {
                      if (isCurrent) {
                        togglePlay();
                      } else {
                        playTrack(track);
                      }
                    }}
                    className={`group px-3 py-2 rounded-[16px] flex items-center gap-3 transition-colors cursor-pointer select-none ${
                      isCurrent
                        ? 'bg-white/[0.08] shadow-xs'
                        : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Index / Animated Waveform */}
                    <div className="w-6 flex items-center justify-center shrink-0">
                      {isCurrent && isPlaying ? (
                        <div className="flex items-end gap-[2px] h-3">
                          <span
                            className="w-[2px] h-3 rounded-full animate-pulse"
                            style={{ backgroundColor: 'var(--theme-accent)' }}
                          />
                          <span
                            className="w-[2px] h-2 rounded-full animate-pulse [animation-delay:150ms]"
                            style={{ backgroundColor: 'var(--theme-accent)' }}
                          />
                          <span
                            className="w-[2px] h-3 rounded-full animate-pulse [animation-delay:300ms]"
                            style={{ backgroundColor: 'var(--theme-accent)' }}
                          />
                        </div>
                      ) : (
                        <span
                          className={`text-[12px] font-mono-tabular ${
                            isCurrent
                              ? 'font-bold'
                              : 'text-white/40 group-hover:hidden'
                          }`}
                          style={
                            isCurrent
                              ? { color: 'var(--theme-accent)' }
                              : undefined
                          }
                        >
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      )}
                      {!isCurrent && (
                        <Play className="w-3 h-3 text-white fill-current hidden group-hover:block ml-0.5" />
                      )}
                    </div>

                    {/* Cover */}
                    <div className="w-9 h-9 rounded-[10px] overflow-hidden shrink-0 bg-white/5 ring-1 ring-black/10">
                      <img
                        src={toThumbnailCoverUrl(track.coverUrl)}
                        alt={track.title}
                        width={36}
                        height={36}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    {/* Meta */}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13px] font-semibold truncate ${
                          isCurrent ? '' : 'text-white/90'
                        }`}
                        style={
                          isCurrent
                            ? { color: 'var(--theme-accent)' }
                            : undefined
                        }
                      >
                        {track.title}
                      </div>
                      <div className="text-[11px] text-white/50 truncate">
                        {track.artists.join(' / ')}
                      </div>
                    </div>

                    {/* Actions on hover */}
                    <div className="flex items-center gap-1 shrink-0">
                      {isCustomQueue && (
                        <>
                          {idx > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderQueue(idx, idx - 1);
                              }}
                              title="上移"
                              className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white cursor-pointer opacity-0 group-hover:opacity-100"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                          )}
                          {idx < displayList.length - 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderQueue(idx, idx + 1);
                              }}
                              title="下移"
                              className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white cursor-pointer opacity-0 group-hover:opacity-100"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromQueue(track.id);
                            }}
                            title="移出队列"
                            className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      )}

                      <span className="text-[11px] font-mono-tabular text-white/40 pl-1">
                        {formatDuration(track.durationSeconds)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer tip */}
            <div className="p-3 bg-white/[0.02] border-t border-white/[0.06] text-center text-[11px] text-white/45 shrink-0">
              {isCustomQueue
                ? '插队曲目播放完毕后将自动恢复常规列表播放'
                : '双击任意歌曲即可立即切换播放'}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
