import React from 'react';
import { Play, Shuffle, RefreshCw, QrCode } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

export const FavoritesView: React.FC = () => {
  const tracks = usePlayerStore((s) => s.tracks);
  const activeSourceFilter = usePlayerStore((s) => s.activeSourceFilter);
  const sources = usePlayerStore((s) => s.sources);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);

  const sourceFilteredTracks =
    activeSourceFilter === 'all'
      ? tracks
      : tracks.filter((t) =>
          t.bindings.some((b) => b.source === activeSourceFilter)
        );

  const favoriteTracks = sourceFilteredTracks.filter((t) => t.isFavorite);
  const huaweiSource = sources.find((s) => s.id === 'huawei')!;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-7 pb-2">
        {/* Large Rounded Artwork with Ambient Shadow */}
        <div className="w-44 h-44 sm:w-48 sm:h-48 rounded-[18px] overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.65)] ring-1 ring-white/10 shrink-0 relative group">
          <img
            src={
              favoriteTracks[0]?.coverUrl ||
              'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80'
            }
            alt="喜爱歌曲"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
          <div className="absolute bottom-3.5 left-4 text-[11px] font-semibold tracking-wider uppercase text-white/85">
            Favorites
          </div>
        </div>

        {/* Editorial Metadata & Primary Actions */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <div
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--theme-accent)' }}
          >
            个人音乐资料库
          </div>
          <h1 className="text-3xl sm:text-[34px] font-bold tracking-tight text-white leading-tight">
            喜爱歌曲
          </h1>
          <p className="text-[13px] text-white/55 max-w-xl leading-relaxed">
            {huaweiSource.loggedIn
              ? `${huaweiSource.accountName} · 已同步 ${favoriteTracks.length} 首无损与跨源收藏曲目`
              : `当前共 ${favoriteTracks.length} 首收藏曲目 · 连接华为音乐账号后可一键拉取云端「我喜欢」与歌单`}
          </p>

          {/* Apple Music Action Pill Buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                if (favoriteTracks.length > 0) {
                  playTrack(favoriteTracks[0]);
                }
              }}
              style={{ backgroundColor: 'var(--theme-accent)' }}
              className="px-6 py-2.5 rounded-full text-[13px] font-semibold !text-white shadow-lg flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>播放</span>
            </button>

            <button
              onClick={() => {
                if (favoriteTracks.length > 0) {
                  const randomTrack =
                    favoriteTracks[Math.floor(Math.random() * favoriteTracks.length)];
                  playTrack(randomTrack);
                }
              }}
              className="px-5 py-2.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13px] font-medium text-white flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>随机播放</span>
            </button>

            {huaweiSource.loggedIn ? (
              <button
                onClick={triggerHuaweiSync}
                className="px-4 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[12px] font-medium text-white/85 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>同步华为云端</span>
              </button>
            ) : (
              <button
                onClick={() => setHuaweiAuthModalOpen(true)}
                className="px-4 py-2.5 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-[12px] font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5 text-[#FA2D48]" />
                <span>扫码登录华为音乐</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <TrackTable tracks={favoriteTracks} />
    </>
  );
};

