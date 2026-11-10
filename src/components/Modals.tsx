import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  ShieldCheck,
  HardDrive,
  Search,
  Play,
  RefreshCw,
  QrCode,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { usePlayerStore } from '../store/usePlayerStore';
import { musicGateway } from '../services/musicGateway';

interface HuaweiAuthSuccessDto {
  sns_user_id: string;
  account_key: string;
  expire_time: string;
}

export const HuaweiAuthModal: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isHuaweiAuthModalOpen);
  const setOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);
  const completeHuaweiReauth = usePlayerStore((s) => s.completeHuaweiReauth);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const pushToast = usePlayerStore((s) => s.pushToast);

  const [callbackInput, setCallbackInput] = useState('');
  const [statusText, setStatusText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [baselineExpireTime, setBaselineExpireTime] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStatusText('');
    setIsLoading(false);
  }, [isOpen]);

  useEffect(() => {
    let unlistenSuccess: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    listen<HuaweiAuthSuccessDto>('huawei-auth-success', (event) => {
      setIsLoading(false);
      setStatusText('');
      const { sns_user_id } = event.payload;
      completeHuaweiReauth(`华为账号 · ${sns_user_id}`);
      pushToast('华为账号登录成功', '正在为您同步云端喜爱歌曲与歌单...', 'success');
      void triggerHuaweiSync();
    })
      .then((fn) => {
        unlistenSuccess = fn;
      })
      .catch(() => {});

    listen<string>('huawei-auth-error', (event) => {
      setIsLoading(false);
      setStatusText(`登录未完成：${event.payload}`);
    })
      .then((fn) => {
        unlistenError = fn;
      })
      .catch(() => {});

    return () => {
      if (unlistenSuccess) unlistenSuccess();
      if (unlistenError) unlistenError();
    };
  }, [completeHuaweiReauth, pushToast, triggerHuaweiSync]);

  useEffect(() => {
    if (!isOpen || !isLoading) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const st = await musicGateway.fetchHuaweiStatus();
      if (cancelled || !st?.loggedIn) return;
      const uid = st.snsUserID || st.snsUserId;
      if (!uid) return;
      if (!baselineExpireTime || (st.expireTime && st.expireTime !== baselineExpireTime)) {
        cancelled = true;
        setIsLoading(false);
        setStatusText('');
        completeHuaweiReauth(`华为账号 · ${uid}`);
        pushToast('华为账号登录成功', '正在为您同步云端喜爱歌曲与歌单...', 'success');
        void triggerHuaweiSync();
      }
    }, 800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen, isLoading, baselineExpireTime, completeHuaweiReauth, pushToast, triggerHuaweiSync]);

  const handleLaunchHuaweiPopup = async () => {
    const before = await musicGateway.fetchHuaweiStatus();
    setBaselineExpireTime(before?.expireTime || null);
    setIsLoading(true);
    setStatusText('正在唤起华为官方扫码窗口，请在弹出的窗口中扫码或输入账号登录...');

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        await invoke<string>('start_huawei_webview_login');
        setStatusText('华为登录窗口已打开，扫码完成后将自动关闭并同步资产');
        return;
      } catch (err) {
        setIsLoading(false);
        setStatusText(`无法打开登录窗口: ${String(err)}`);
        return;
      }
    }

    try {
      const resp = await fetch('/api/huawei/login-popup', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || '未能完成扫码登录');
      }
      setIsLoading(false);
      setStatusText('');
      completeHuaweiReauth(`华为账号 · ${data.snsUserID || data.snsUserId}`);
      pushToast('华为账号登录成功', '正在为您同步云端喜爱歌曲与歌单...', 'success');
      await triggerHuaweiSync();
    } catch (bridgeErr) {
      setIsLoading(false);
      setStatusText(
        bridgeErr instanceof Error ? bridgeErr.message : '登录窗口已关闭或超时，请重试'
      );
    }
  };

  const handleExchangeManualCallback = async () => {
    const trimmed = callbackInput.trim();
    if (!trimmed.startsWith('hms://redirect_uri')) {
      setStatusText('请粘贴以 hms://redirect_uri?code=... 开头的完整地址');
      return;
    }
    setIsLoading(true);
    setStatusText('正在验证授权码并连接华为音乐云端...');
    try {
      const res = await invoke<HuaweiAuthSuccessDto>('submit_huawei_callback_url', {
        callbackUrl: trimmed,
      });
      setIsLoading(false);
      completeHuaweiReauth(`华为账号 · ${res.sns_user_id}`);
      triggerHuaweiSync();
    } catch (e) {
      setIsLoading(false);
      setStatusText(`验证失败: ${String(e)}`);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !isLoading && setOpen(false)}
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-md flex items-center justify-center p-4 select-none"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[430px] rounded-[28px] theme-modal backdrop-blur-2xl border overflow-hidden"
          >
            <div className="flex justify-end px-5 pt-4">
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-8 pb-7 pt-1 text-center">
              <div className="w-16 h-16 rounded-[20px] bg-gradient-to-br from-[#FA2D48] to-[#C7000B] mx-auto flex items-center justify-center shadow-[0_12px_30px_rgba(250,45,72,0.3)]">
                <QrCode className="w-8 h-8 !text-white" />
              </div>

              <h3 className="text-[20px] font-bold text-white mt-5 tracking-tight">
                华为账号扫码登录
              </h3>
              <p className="text-[13px] text-white/60 mt-2 leading-relaxed">
                使用华为手机或华为音乐 App 扫码授权，自动同步您的「我喜欢」收藏、自建歌单与 SQ/Hi-Res 无损曲库。
              </p>

              <button
                onClick={handleLaunchHuaweiPopup}
                disabled={isLoading}
                className="w-full mt-6 py-3 px-5 rounded-full bg-[#FA2D48] hover:bg-[#FF3B56] disabled:opacity-60 text-[14px] font-semibold !text-white shadow-[0_8px_24px_rgba(250,45,72,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin !text-white" />
                    <span className="!text-white">等待扫码授权完成...</span>
                  </>
                ) : (
                  <span className="!text-white">打开华为官方扫码窗口</span>
                )}
              </button>

              {statusText && (
                <div className="mt-4 p-3 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-[12px] text-white/80 leading-relaxed text-left">
                  {statusText}
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-white/[0.07]">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[12px] text-white/50 hover:text-white/80 flex items-center justify-center gap-1 mx-auto cursor-pointer"
                >
                  <span>手动粘贴回调地址</span>
                  {showAdvanced ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showAdvanced && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={callbackInput}
                      onChange={(e) => setCallbackInput(e.target.value)}
                      placeholder="hms://redirect_uri?code=..."
                      className="flex-1 px-3.5 py-2 rounded-full bg-white/[0.06] border border-white/[0.1] text-[12px] text-white placeholder-white/35 focus:outline-none focus:border-[#FA2D48]"
                    />
                    <button
                      onClick={handleExchangeManualCallback}
                      disabled={isLoading || !callbackInput.trim()}
                      className="px-4 py-2 rounded-full bg-[#FA2D48] disabled:opacity-40 text-[12px] font-medium !text-white shrink-0 cursor-pointer"
                    >
                      验证
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/45">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>凭据仅加密保存在本机，退出账号不会删除本地收藏</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const NeteaseConnectModal: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isNeteaseModalOpen);
  const setOpen = usePlayerStore((s) => s.setNeteaseModalOpen);
  const isSyncing = usePlayerStore((s) => s.isSyncingNetease);
  const syncNeteaseByUid = usePlayerStore((s) => s.syncNeteaseByUid);

  const [uidInput, setUidInput] = useState('');
  const [cookieInput, setCookieInput] = useState('');
  const [showCookie, setShowCookie] = useState(false);

  const [qrSvg, setQrSvg] = useState<string>('');
  const [unikey, setUnikey] = useState<string>('');
  const [qrStatus, setQrStatus] = useState<string>('正在生成网易云扫码二维码...');
  const [qrExpired, setQrExpired] = useState<boolean>(false);

  const loadQrCode = async () => {
    setQrExpired(false);
    setQrStatus('请使用网易云音乐 App 扫码登录');
    const res = await musicGateway.createNeteaseQr();
    if (res?.ok && res.unikey && res.qrSvg) {
      setUnikey(res.unikey);
      setQrSvg(res.qrSvg);
    } else {
      setQrStatus('二维码生成失败，可直接输入下方昵称或 UID 同步');
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setUnikey('');
      setQrSvg('');
      return;
    }
    musicGateway.fetchNeteaseStatus().then((st) => {
      if (st?.nickname) {
        setUidInput(st.nickname);
      } else if (st?.uid) {
        setUidInput(st.uid);
      }
    });
    void loadQrCode();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !unikey || qrExpired || isSyncing) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled) return;
      const poll = await musicGateway.pollNeteaseQr({ unikey });
      if (!poll || cancelled) return;
      if (poll.code === 800) {
        setQrExpired(true);
        setQrStatus('二维码已过期，点击刷新重试');
      } else if (poll.code === 801) {
        setQrStatus('等待网易云音乐 App 扫码...');
      } else if (poll.code === 802) {
        const nick = poll.nickname || '';
        const resolvedUid = poll.uid || nick;
        if (nick) {
          setUidInput(nick);
        }
        setQrStatus(
          nick
            ? `已识别账号「${nick}」，请在手机确认或直接点击下方同步`
            : '扫码成功，请在手机上点击确认授权...'
        );
        if (resolvedUid && !isSyncing) {
          cancelled = true;
          await syncNeteaseByUid(resolvedUid, poll.cookie || undefined);
        }
      } else if (poll.code === 803) {
        cancelled = true;
        setQrStatus('授权成功，正在同步歌单...');
        const target = poll.uid || poll.nickname || uidInput.trim();
        if (target) {
          await syncNeteaseByUid(target, poll.cookie || undefined);
        }
      }
    }, 1800);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOpen, unikey, qrExpired, isSyncing, syncNeteaseByUid, uidInput]);

  const handleSync = async () => {
    const trimmed = uidInput.trim();
    if (!trimmed) return;
    await syncNeteaseByUid(trimmed, cookieInput.trim() || undefined);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !isSyncing && setOpen(false)}
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-md flex items-center justify-center p-4 select-none"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[460px] rounded-[28px] theme-modal backdrop-blur-2xl border overflow-hidden"
          >
            <div className="flex justify-end px-5 pt-4">
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-7 pb-6 pt-0.5 text-center">
              <div className="flex items-center justify-center gap-2.5">
                <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-[#E60026] to-[#990019] flex items-center justify-center shadow-[0_8px_20px_rgba(230,0,38,0.3)] font-bold text-lg !text-white">
                  网
                </div>
                <div className="text-left">
                  <h3 className="text-[18px] font-bold text-white tracking-tight leading-tight">
                    连接网易云音乐账号
                  </h3>
                  <p className="text-[11.5px] text-white/55">
                    支持 App 扫码识别或直接输入昵称 / UID 同步歌单
                  </p>
                </div>
              </div>

              {/* QR Code Scan Area */}
              <div className="mt-4 p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center gap-4 text-left">
                <div
                  onClick={() => qrExpired && void loadQrCode()}
                  className="w-28 h-28 rounded-xl bg-white p-1.5 shrink-0 flex items-center justify-center relative overflow-hidden cursor-pointer shadow-sm"
                >
                  {qrSvg ? (
                    <div
                      className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                  ) : (
                    <RefreshCw className="w-5 h-5 text-neutral-400 animate-spin" />
                  )}
                  {qrExpired && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-[11px] font-semibold !text-white gap-1">
                      <RefreshCw className="w-4 h-4 !text-white" />
                      <span>点击刷新</span>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="text-[13px] font-bold text-white">
                    方式一：网易云 App 扫码
                  </div>
                  <p className="text-[11.5px] text-white/60 leading-relaxed">
                    打开手机「网易云音乐」扫一扫左侧二维码，识别昵称后自动拉取「我喜欢的音乐」与全部自建/收藏歌单。
                  </p>
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-[11px] font-medium text-[#FA2D48] truncate">
                      {qrStatus}
                    </span>
                    <button
                      onClick={() => void loadQrCode()}
                      className="text-[11px] text-white/50 hover:text-white flex items-center gap-1 shrink-0 cursor-pointer ml-2"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>刷新</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-left space-y-2.5">
                <div>
                  <div className="flex items-center justify-between pl-1">
                    <label className="text-[12px] font-semibold text-white/85">
                      方式二：直接输入网易云昵称或 UID（免扫码秒同步）
                    </label>
                    <button
                      type="button"
                      onClick={() => setUidInput('IFTiger')}
                      className="text-[11px] text-[#FA2D48] hover:underline cursor-pointer"
                    >
                      填入 IFTiger
                    </button>
                  </div>
                  <input
                    value={uidInput}
                    onChange={(e) => setUidInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && uidInput.trim() && !isSyncing) {
                        void handleSync();
                      }
                    }}
                    placeholder="直接输入昵称（如 IFTiger）或数字 UID..."
                    className="w-full mt-1.5 px-4 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-[13px] text-white placeholder-white/35 focus:outline-none focus:border-[#E60026]"
                  />
                </div>

                <div>
                  <button
                    onClick={() => setShowCookie(!showCookie)}
                    className="text-[11.5px] text-white/50 hover:text-white/80 flex items-center gap-1 cursor-pointer pl-1"
                  >
                    <span>可选：填入 MUSIC_U Cookie 解锁黑胶直连</span>
                    {showCookie ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {showCookie && (
                    <input
                      value={cookieInput}
                      onChange={(e) => setCookieInput(e.target.value)}
                      placeholder="MUSIC_U=xxxx; (可留空，VIP 锁曲自动由华为无损替补点亮)"
                      className="w-full mt-1.5 px-4 py-2 rounded-full bg-white/[0.06] border border-white/[0.1] text-[12px] text-white placeholder-white/35 focus:outline-none focus:border-[#E60026]"
                    />
                  )}
                </div>
              </div>

              <button
                onClick={handleSync}
                disabled={isSyncing || !uidInput.trim()}
                className="w-full mt-5 py-3 px-5 rounded-full bg-[#E60026] hover:bg-[#FF1A40] disabled:opacity-50 text-[14px] font-semibold !text-white shadow-[0_8px_24px_rgba(230,0,38,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin !text-white" />
                    <span className="!text-white">正在同步网易云歌单与曲目...</span>
                  </>
                ) : (
                  <span className="!text-white">立即同步网易云歌单</span>
                )}
              </button>

              <div className="mt-3.5 flex items-center justify-center gap-1.5 text-[11px] text-white/45">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>支持原词 + 中文翻译 + 罗马音对齐，VIP 曲目自动切换华为无损播放</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const ImportAssetsModal: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isImportModalOpen);
  const setOpen = usePlayerStore((s) => s.setImportModalOpen);
  const sources = usePlayerStore((s) => s.sources);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setNeteaseModalOpen = usePlayerStore((s) => s.setNeteaseModalOpen);
  const scanLocalFolder = usePlayerStore((s) => s.scanLocalFolder);
  const toggleSourceLogin = usePlayerStore((s) => s.toggleSourceLogin);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-md flex items-center justify-center p-4 select-none"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] rounded-[28px] theme-modal backdrop-blur-2xl border overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-white">同步与导入音乐资料库</h3>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-3">
              {sources.map((src) => (
                <div
                  key={src.id}
                  className="p-3.5 rounded-[18px] bg-white/[0.04] border border-white/[0.06] flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-9 h-9 rounded-[12px] flex items-center justify-center font-bold text-xs !text-white shrink-0"
                      style={{ backgroundColor: src.accent }}
                    >
                      {src.shortName}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-white">{src.name}</div>
                      <div className="text-[11px] text-white/50 truncate mt-0.5">
                        {src.accountName}
                      </div>
                    </div>
                  </div>

                  {src.id === 'local' ? (
                    <button
                      onClick={() => {
                        scanLocalFolder();
                        setOpen(false);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium shrink-0 cursor-pointer flex items-center gap-1.5"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>扫描目录</span>
                    </button>
                  ) : src.id === 'netease' ? (
                    <button
                      onClick={() => {
                        setOpen(false);
                        setNeteaseModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-[#E60026] hover:bg-[#FF1A40] !text-white text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      同步 UID 歌单
                    </button>
                  ) : src.loggedIn ? (
                    <button
                      onClick={() => {
                        triggerHuaweiSync();
                        setOpen(false);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium shrink-0 cursor-pointer"
                    >
                      立即同步
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setOpen(false);
                        toggleSourceLogin(src.id);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-[#FA2D48] hover:bg-[#FF3B56] !text-white text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      连接账号
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const CommandPaletteModal: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isCommandPaletteOpen);
  const setOpen = usePlayerStore((s) => s.setCommandPaletteOpen);
  const tracks = usePlayerStore((s) => s.tracks);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const [q, setQ] = useState('');

  const filtered = tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(q.toLowerCase()) ||
      t.artists.join(' ').toLowerCase().includes(q.toLowerCase()) ||
      t.album.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-24 p-4"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-[26px] theme-modal backdrop-blur-2xl border overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center gap-3">
              <Search className="w-4 h-4 text-white/45" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索歌曲、歌手或专辑..."
                className="w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
              />
              <kbd className="text-[10px] font-mono-tabular px-2 py-0.5 rounded-full bg-white/[0.07] text-white/50">
                ESC
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto p-2.5">
              {filtered.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    playTrack(t);
                    setOpen(false);
                  }}
                  className="px-3.5 py-2.5 rounded-2xl hover:bg-white/[0.07] flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={t.coverUrl}
                      alt={t.title}
                      className="w-9 h-9 rounded-[10px] object-cover"
                    />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-white truncate">
                        {t.title}
                      </div>
                      <div className="text-[11.5px] text-white/50 truncate">
                        {t.artists.join(' / ')} — {t.album}
                      </div>
                    </div>
                  </div>
                  <Play className="w-4 h-4 text-white/40 group-hover:text-[#FA2D48] ml-2 fill-current" />
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
