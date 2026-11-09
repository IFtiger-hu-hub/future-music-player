import React from 'react';
import { Plus, RefreshCw, Play, Shuffle, Disc3 } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

export const PlaylistsView: React.FC = () => {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const playlists = usePlayerStore((s) => s.playlists);
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId);
  const tracks = usePlayerStore((s) => s.tracks);
  const sources = usePlayerStore((s) => s.sources);
  const createLocalPlaylist = usePlayerStore((s) => s.createLocalPlaylist);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const isLocal = activeNav === 'local_playlists';
  const huaweiSource = sources.find((s) => s.id === 'huawei')!;
  const visiblePlaylists = playlists.filter((p) =>
    isLocal ? p.kind === 'local' : p.kind === 'imported'
  );
  const activePl =
    playlists.find((p) => p.id === selectedPlaylistId) ||
    visiblePlaylists[0] ||
    playlists[0];
  const activeTracks = tracks.filter((t) =>
    activePl ? activePl.trackIds.includes(t.id) : false
  );

  return (
    <div className="space-y-6">
      {/* Top HarmonyOS Capsule Switcher & Horizontal Playlist Selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveNav('local_playlists')}
            className={`h-9 px-5 rounded-full text-[13px] font-semibold transition-all cursor-pointer ${
              isLocal
                ? 'bg-[#24262A] !text-white shadow-xs'
                : 'bg-white/[0.06] border border-white/[0.08] text-white/70 hover:text-white'
            }`}
          >
            自建歌单 ({playlists.filter((p) => p.kind === 'local').length})
          </button>
          <button
            onClick={() => setActiveNav('imported_playlists')}
            className={`h-9 px-5 rounded-full text-[13px] font-semibold transition-all cursor-pointer ${
              !isLocal
                ? 'bg-[#24262A] !text-white shadow-xs'
                : 'bg-white/[0.06] border border-white/[0.08] text-white/70 hover:text-white'
            }`}
          >
            云端同步歌单 ({playlists.filter((p) => p.kind === 'imported').length})
          </button>
        </div>

        {isLocal ? (
          <button
            onClick={() =>
              createLocalPlaylist(
                `精选歌单 #${playlists.filter((p) => p.kind === 'local').length + 1}`,
                '跨音源无损精选集'
              )
            }
            style={{ backgroundColor: 'var(--theme-accent)' }}
            className="h-9 px-4 rounded-full text-[12.5px] font-semibold !text-white flex items-center gap-1.5 shadow-xs cursor-pointer transition-transform active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建歌单</span>
          </button>
        ) : (
          <button
            onClick={() =>
              huaweiSource.loggedIn
                ? triggerHuaweiSync()
                : setHuaweiAuthModalOpen(true)
            }
            className="h-9 px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[12.5px] font-medium text-white flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>
              {huaweiSource.loggedIn ? '刷新华为云端歌单' : '连接华为账号同步'}
            </span>
          </button>
        )}
      </div>

      {/* Horizontal Playlist Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3.5">
        {visiblePlaylists.map((pl) => {
          const isSelected = activePl?.id === pl.id;
          return (
            <div
              key={pl.id}
              onClick={() => setSelectedPlaylistId(pl.id)}
              className={`group p-2.5 rounded-[18px] flex items-center gap-3 transition-all cursor-pointer ${
                isSelected
                  ? 'surface-bento ring-2 ring-[#FA2D48]'
                  : 'surface-bento hover:bg-white/[0.07]'
              }`}
            >
              <img
                src={pl.coverUrl}
                alt={pl.name}
                className="w-12 h-12 rounded-[12px] object-cover shrink-0 shadow-xs"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-white truncate">
                  {pl.name}
                </div>
                <div className="text-[11px] text-white/50 truncate mt-0.5">
                  {pl.trackCount} 首 · {pl.updatedAt}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* HarmonyOS PC Master-Detail Playlist Detail View (左侧歌单大图信息卡 + 右侧曲目列表) */}
      {activePl && (
        <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-7 items-start pt-1">
          {/* Left Master Panel */}
          <div className="p-6 rounded-[24px] surface-bento flex flex-col items-center lg:items-start text-center lg:text-left space-y-4">
            <div className="w-48 h-48 lg:w-full lg:aspect-square rounded-[20px] overflow-hidden shadow-[0_18px_42px_rgba(0,0,0,0.22)] ring-1 ring-white/15 relative group">
              <img
                src={activePl.coverUrl}
                alt={activePl.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full bg-black/55 backdrop-blur-md !text-white text-[10px] font-semibold flex items-center gap-1">
                <Disc3 className="w-3 h-3" />
                <span>Hi-Res 精选</span>
              </div>
            </div>

            <div className="space-y-1.5 w-full">
              <h2 className="text-[20px] font-bold text-white tracking-tight">
                {activePl.name}
              </h2>
              <p className="text-[12.5px] text-white/55 leading-relaxed">
                {activePl.description ||
                  '基于 HarmonyOS 跨源音频引擎自动聚合无损 FLAC 音源。'}
              </p>
              <div className="text-[11.5px] font-mono-tabular text-white/45 pt-1">
                共 {activeTracks.length} 首曲目 · {activePl.updatedAt}
              </div>
            </div>

            {/* HarmonyOS Capsule Action Buttons */}
            <div className="w-full flex items-center gap-2.5 pt-2">
              <button
                onClick={() => {
                  if (activeTracks.length > 0) {
                    playTrack(activeTracks[0]);
                  }
                }}
                style={{ backgroundColor: 'var(--theme-accent)' }}
                className="flex-1 h-10 rounded-full text-[13px] font-semibold !text-white flex items-center justify-center gap-2 shadow-md cursor-pointer transition-transform active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>播放全部</span>
              </button>
              <button
                onClick={() => {
                  if (activeTracks.length > 0) {
                    const rand =
                      activeTracks[
                        Math.floor(Math.random() * activeTracks.length)
                      ];
                    playTrack(rand);
                  }
                }}
                className="h-10 px-4 rounded-full bg-white/[0.07] hover:bg-white/[0.14] border border-white/[0.08] text-[13px] font-medium text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="随机播放"
              >
                <Shuffle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right Detail Track Table */}
          <div className="p-5 rounded-[24px] surface-bento min-w-0">
            <TrackTable tracks={activeTracks} />
          </div>
        </div>
      )}
    </div>
  );
};
