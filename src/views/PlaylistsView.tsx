import React from 'react';
import {
  Plus,
  RefreshCw,
  Play,
  Shuffle,
  Disc3,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { CanonicalTrack } from '../types/music';
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
  const isLoadingPlaylistDetail = usePlayerStore(
    (s) => s.isLoadingPlaylistDetail
  );

  const isLocal = activeNav === 'local_playlists';
  const huaweiSource = sources.find((s) => s.id === 'huawei')!;
  const visiblePlaylists = playlists.filter((p) =>
    isLocal ? p.kind === 'local' : p.kind === 'imported'
  );
  const activePl =
    playlists.find((p) => p.id === selectedPlaylistId) ||
    visiblePlaylists[0] ||
    playlists[0];
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const activeTracks = activePl
    ? activePl.trackIds
        .map((id) => trackMap.get(id))
        .filter((t): t is CanonicalTrack => Boolean(t))
    : [];

  return (
    <div className="space-y-6">
      {/* Top HarmonyOS Capsule Switcher & Horizontal Playlist Selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
          <button
            onClick={() => setActiveNav('favorites')}
            className="h-9 px-3.5 rounded-full btn-harmony-secondary text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"
            title="返回推荐首页"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回推荐</span>
          </button>

          <button
            onClick={() => setActiveNav('local_playlists')}
            className={`h-9 px-5 rounded-full text-[13px] font-semibold cursor-pointer ${
              isLocal ? 'btn-harmony-active' : 'btn-harmony-secondary'
            }`}
          >
            精选与自建歌单 ({playlists.filter((p) => p.kind === 'local').length})
          </button>
          <button
            onClick={() => setActiveNav('imported_playlists')}
            className={`h-9 px-5 rounded-full text-[13px] font-semibold cursor-pointer ${
              !isLocal ? 'btn-harmony-active' : 'btn-harmony-secondary'
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
            className="h-9 px-4 rounded-full btn-harmony-primary text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"
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
            className="h-9 px-4 rounded-full btn-harmony-secondary text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>
              {huaweiSource.loggedIn ? '刷新华为云端歌单' : '连接华为账号同步'}
            </span>
          </button>
        )}
      </div>

      {/* Horizontal Playlist Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
        {visiblePlaylists.map((pl) => {
          const isSelected = activePl?.id === pl.id;
          return (
            <div
              key={pl.id}
              onClick={() => setSelectedPlaylistId(pl.id)}
              className={`group p-2.5 rounded-[18px] flex items-center gap-3 transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'surface-bento ring-2 ring-[#FA2D48] shadow-md -translate-y-0.5'
                  : 'surface-bento hover:-translate-y-0.5'
              }`}
            >
              <img
                src={pl.coverUrl}
                alt={pl.name}
                className="w-12 h-12 rounded-[12px] object-cover shrink-0 shadow-xs ring-1 ring-black/[0.06]"
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
            <div className="w-48 h-48 lg:w-full lg:aspect-square rounded-[20px] overflow-hidden shadow-[0_18px_42px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.08] relative group">
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
                className="flex-1 h-10 rounded-full btn-harmony-primary text-[13px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
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
                className="h-10 px-4 rounded-full btn-harmony-secondary text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                title="随机播放"
              >
                <Shuffle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right Detail Track Table */}
          <div className="p-5 rounded-[24px] surface-bento min-w-0 space-y-3">
            {isLoadingPlaylistDetail && (
              <div className="px-4 py-3 rounded-[16px] bg-[#FA2D48]/10 border border-[#FA2D48]/20 text-[12.5px] font-semibold text-[#FA2D48] flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>正在从华为音乐云端拉取歌单真实曲目列表...</span>
              </div>
            )}
            <TrackTable tracks={activeTracks} />
          </div>
        </div>
      )}
    </div>
  );
};
