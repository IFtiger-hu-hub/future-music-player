import React from 'react';
import { FolderOpen } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';

export const SourcesView: React.FC = () => {
  const sources = usePlayerStore((s) => s.sources);
  const scanLocalFolder = usePlayerStore((s) => s.scanLocalFolder);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const toggleSourceLogin = usePlayerStore((s) => s.toggleSourceLogin);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            账号与音源
          </h1>
          <p className="text-[13px] text-white/50 mt-1">
            连接您的音乐平台账号或扫描本地无损曲库，同名歌曲将自动合并挂载
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map((src) => (
          <div
            key={src.id}
            className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex flex-col justify-between space-y-5"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm !text-white shadow-md"
                    style={{ backgroundColor: src.accent }}
                  >
                    {src.shortName}
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-white">
                      {src.name}
                    </h3>
                    <p className="text-[12px] text-white/50 mt-0.5">
                      {src.accountName}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                    src.loggedIn
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-white/[0.06] text-white/45'
                  }`}
                >
                  {src.loggedIn ? '已连接' : '未连接'}
                </span>
              </div>

              <p className="text-[12px] text-white/55 mt-3.5 leading-relaxed">
                {src.protocolDesc}
              </p>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {src.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/[0.05] text-white/70"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-3.5 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-[12px] text-white/45">
                {src.favoriteCount} 首歌曲 · {src.playlistCount} 个歌单
              </span>

              <div className="flex items-center gap-2">
                {src.id === 'local' ? (
                  <button
                    onClick={scanLocalFolder}
                    className="px-3.5 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>扫描本地目录</span>
                  </button>
                ) : (
                  <>
                    {src.id === 'huawei' && src.loggedIn && (
                      <button
                        onClick={triggerHuaweiSync}
                        className="px-3.5 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white cursor-pointer"
                      >
                        同步资产
                      </button>
                    )}
                    <button
                      onClick={() => toggleSourceLogin(src.id)}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                        src.id === 'huawei' && !src.loggedIn
                          ? 'bg-[#FA2D48] hover:bg-[#FF3B56] !text-white'
                          : 'bg-white/[0.08] hover:bg-white/[0.14] text-white'
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
    </>
  );
};

