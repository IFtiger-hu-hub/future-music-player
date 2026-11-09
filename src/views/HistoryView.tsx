import React, { useState } from 'react';
import {
  Heart,
  Clock,
  FolderOpen,
  QrCode,
  RefreshCw,
  Disc3,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

export const HistoryView: React.FC = () => {
  const tracks = usePlayerStore((s) => s.tracks);
  const historyTrackIds = usePlayerStore((s) => s.historyTrackIds);
  const playlists = usePlayerStore((s) => s.playlists);
  const sources = usePlayerStore((s) => s.sources);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);
  const scanLocalFolder = usePlayerStore((s) => s.scanLocalFolder);

  const [activeTab, setActiveTab] = useState<'favorites' | 'recent'>('favorites');

  const huaweiSource = sources.find((s) => s.id === 'huawei')!;
  const favoriteTracks = tracks.filter((t) => t.isFavorite);
  const recentTracks = historyTrackIds
    .map((id) => tracks.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <div className="space-y-6">
      {/* HarmonyOS NEXT Personal Profile Header Card */}
      <div className="p-6 rounded-[24px] surface-bento flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#FA2D48] to-[#C20018] flex items-center justify-center text-lg font-bold !text-white shadow-md ring-2 ring-white/20 shrink-0">
            华
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[19px] font-bold text-white">
                {huaweiSource.loggedIn
                  ? huaweiSource.accountName
                  : '华为音乐账号 · 未连接'}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-[#FA2D48]/15 text-[#FA2D48] text-[10.5px] font-semibold">
                {huaweiSource.loggedIn ? 'Hi-Res 会员曲库已挂载' : '支持扫码直连'}
              </span>
            </div>
            <p className="text-[12.5px] text-white/55 mt-1">
              已收录 {favoriteTracks.length} 首我喜欢 · {playlists.length} 个歌单 ·{' '}
              {recentTracks.length} 首最近播放
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={scanLocalFolder}
            className="h-9 px-4 rounded-full btn-harmony-secondary text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>扫描本地无损目录</span>
          </button>

          {huaweiSource.loggedIn ? (
            <button
              onClick={triggerHuaweiSync}
              className="h-9 px-4 rounded-full btn-harmony-secondary text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>同步云端资产</span>
            </button>
          ) : (
            <button
              onClick={() => setHuaweiAuthModalOpen(true)}
              className="h-9 px-4 rounded-full btn-harmony-primary text-[12.5px] font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>扫码登录华为音乐</span>
            </button>
          )}
        </div>
      </div>

      {/* 3 HarmonyOS Quick Stat Capsules */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => setActiveTab('favorites')}
          className={`p-4 rounded-[20px] surface-bento flex items-center justify-between text-left cursor-pointer transition-all ${
            activeTab === 'favorites' ? 'ring-2 ring-[#FA2D48]' : ''
          }`}
        >
          <div>
            <div className="text-[12px] text-white/55 font-medium">我喜欢</div>
            <div className="text-2xl font-bold font-mono-tabular text-white mt-0.5">
              {favoriteTracks.length} <span className="text-xs font-normal">首</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-[#FA2D48]/15 flex items-center justify-center text-[#FA2D48]">
            <Heart className="w-5 h-5 fill-current" />
          </div>
        </button>

        <button
          onClick={() => setActiveTab('recent')}
          className={`p-4 rounded-[20px] surface-bento flex items-center justify-between text-left cursor-pointer transition-all ${
            activeTab === 'recent' ? 'ring-2 ring-[#FA2D48]' : ''
          }`}
        >
          <div>
            <div className="text-[12px] text-white/55 font-medium">最近播放</div>
            <div className="text-2xl font-bold font-mono-tabular text-white mt-0.5">
              {recentTracks.length} <span className="text-xs font-normal">首</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-white/[0.08] flex items-center justify-center text-white/80">
            <Clock className="w-5 h-5" />
          </div>
        </button>

        <div className="p-4 rounded-[20px] surface-bento flex items-center justify-between">
          <div>
            <div className="text-[12px] text-white/55 font-medium">
              Audio Vivid 空间音频
            </div>
            <div className="text-[15px] font-bold text-white mt-1">
              FLAC 24bit / 96kHz
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-white/[0.08] flex items-center justify-center text-white/80">
            <Disc3 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Track List Container */}
      <div className="p-5 rounded-[24px] surface-bento">
        <TrackTable
          tracks={activeTab === 'favorites' ? favoriteTracks : recentTracks}
        />
      </div>
    </div>
  );
};
