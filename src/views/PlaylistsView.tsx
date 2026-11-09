import React from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

export const PlaylistsView: React.FC = () => {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const playlists = usePlayerStore((s) => s.playlists);
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId);
  const tracks = usePlayerStore((s) => s.tracks);
  const sources = usePlayerStore((s) => s.sources);
  const createLocalPlaylist = usePlayerStore((s) => s.createLocalPlaylist);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);

  const isLocal = activeNav === 'local_playlists';
  const huaweiSource = sources.find((s) => s.id === 'huawei')!;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {isLocal ? '我的歌单' : '同步歌单'}
          </h1>
          <p className="text-[13px] text-white/50 mt-1">
            {isLocal
              ? '跨音源自由混排歌单，自动选择最佳无损音源播放'
              : '从华为音乐与扩展音源同步的云端歌单'}
          </p>
        </div>
        {isLocal ? (
          <button
            onClick={() =>
              createLocalPlaylist(
                `精选歌单 #${playlists.filter((p) => p.kind === 'local').length + 1}`,
                '跨音源精选辑'
              )
            }
            style={{ backgroundColor: 'var(--theme-accent)' }}
            className="px-4 py-2 rounded-full text-[12px] font-semibold !text-white flex items-center gap-1.5 cursor-pointer"
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
            className="px-4 py-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[12px] font-medium text-white flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>
              {huaweiSource.loggedIn ? '刷新云端歌单' : '登录华为账号同步'}
            </span>
          </button>
        )}
      </div>

      {/* Apple Music Artwork Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
        {playlists
          .filter((p) => (isLocal ? p.kind === 'local' : p.kind === 'imported'))
          .map((pl) => {
            const isSelected = selectedPlaylistId === pl.id;
            return (
              <div
                key={pl.id}
                onClick={() => setSelectedPlaylistId(pl.id)}
                className="group cursor-pointer space-y-2.5"
              >
                <div
                  className={`aspect-square rounded-[16px] overflow-hidden relative transition-all duration-300 ${
                    isSelected
                      ? 'ring-2 ring-[#FA2D48] shadow-[0_18px_40px_rgba(0,0,0,0.6)]'
                      : 'ring-1 ring-white/10 opacity-85 group-hover:opacity-100'
                  }`}
                >
                  <img
                    src={pl.coverUrl}
                    alt={pl.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-white truncate">
                    {pl.name}
                  </div>
                  <div className="text-[11px] text-white/45 truncate mt-0.5">
                    {pl.trackCount} 首歌曲 · {pl.updatedAt}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="pt-2">
        <TrackTable
          tracks={tracks.filter((t) => {
            const activePl =
              playlists.find((p) => p.id === selectedPlaylistId) || playlists[0];
            return activePl ? activePl.trackIds.includes(t.id) : false;
          })}
        />
      </div>
    </>
  );
};

