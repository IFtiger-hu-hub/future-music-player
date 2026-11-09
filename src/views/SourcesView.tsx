import React from 'react';
import { FolderOpen, Radio, SlidersHorizontal, Disc3 } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';

export const SourcesView: React.FC = () => {
  const sources = usePlayerStore((s) => s.sources);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const scanLocalFolder = usePlayerStore((s) => s.scanLocalFolder);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const toggleSourceLogin = usePlayerStore((s) => s.toggleSourceLogin);

  return (
    <div className="space-y-6">
      {/* HarmonyOS Top Capsule Switcher for Cafe馆 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveNav('sources')}
            className="h-9 px-5 rounded-full bg-[#24262A] !text-white text-[13px] font-semibold flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <Disc3 className="w-3.5 h-3.5 !text-white" />
            <span>音源与账号管理</span>
          </button>
          <button
            onClick={() => setActiveNav('settings')}
            className="h-9 px-5 rounded-full surface-bento hover:bg-white/[0.1] text-white/75 text-[13px] font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>音效与主题外观</span>
          </button>
        </div>

        <span className="text-[12px] text-white/50">
          支持多平台无损音源自动对齐与智能回退
        </span>
      </div>

      {/* HarmonyOS Source Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map((src) => (
          <div
            key={src.id}
            className="p-6 rounded-[24px] surface-bento flex flex-col justify-between space-y-5 transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <span
                    className="w-11 h-11 rounded-[14px] flex items-center justify-center font-bold text-sm !text-white shadow-sm"
                    style={{ backgroundColor: src.accent }}
                  >
                    {src.shortName}
                  </span>
                  <div>
                    <h3 className="text-[16px] font-bold text-white">
                      {src.name}
                    </h3>
                    <p className="text-[12px] text-white/50 mt-0.5">
                      {src.accountName}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 ${
                    src.loggedIn
                      ? 'bg-emerald-500/12 text-emerald-500'
                      : 'bg-white/[0.06] text-white/45'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span>{src.loggedIn ? '已连接' : '未连接'}</span>
                </span>
              </div>

              <p className="text-[12.5px] text-white/60 mt-4 leading-relaxed">
                {src.protocolDesc}
              </p>

              <div className="flex flex-wrap gap-1.5 mt-3.5">
                {src.capabilities.map((cap) => (
                  <span key={cap} className="badge-lossless">
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-[12px] text-white/50 font-medium">
                {src.favoriteCount} 首收藏 · {src.playlistCount} 个歌单
              </span>

              <div className="flex items-center gap-2">
                {src.id === 'local' ? (
                  <button
                    onClick={scanLocalFolder}
                    className="h-8.5 px-4 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.08] text-[12px] font-medium text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>扫描本地目录</span>
                  </button>
                ) : (
                  <>
                    {src.id === 'huawei' && src.loggedIn && (
                      <button
                        onClick={triggerHuaweiSync}
                        className="h-8.5 px-4 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.08] text-[12px] font-medium text-white cursor-pointer transition-colors"
                      >
                        同步云端资产
                      </button>
                    )}
                    <button
                      onClick={() => toggleSourceLogin(src.id)}
                      className={`h-8.5 px-4 rounded-full text-[12px] font-semibold cursor-pointer transition-colors ${
                        src.id === 'huawei' && !src.loggedIn
                          ? 'bg-[#FA2D48] hover:bg-[#FF3B56] !text-white shadow-xs'
                          : 'bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.08] text-white'
                      }`}
                    >
                      {src.id === 'huawei'
                        ? src.loggedIn
                          ? '更换华为账号'
                          : '扫码登录'
                        : src.loggedIn
                        ? '断开连接'
                        : '连接账号'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
