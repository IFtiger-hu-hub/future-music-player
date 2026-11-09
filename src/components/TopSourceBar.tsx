import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  AudioLines,
  Check,
  RotateCcw,
  QrCode,
  Download,
} from 'lucide-react';
import { NavSection, SourceId } from '../types/music';
import { usePlayerStore } from '../store/usePlayerStore';
import { THEME_PALETTES, CUSTOM_ACCENT_SWATCHES } from '../theme/palettes';

const SOURCE_FILTERS: Array<{ id: SourceId | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'huawei', label: '华为无损' },
  { id: 'local', label: '本地' },
  { id: 'netease', label: '网易' },
  { id: 'qq', label: 'QQ' },
];

const NAV_TITLES: Record<NavSection, string> = {
  favorites: '推荐',
  local_playlists: '音乐厅',
  imported_playlists: '音乐厅',
  sources: 'Cafe馆',
  settings: 'Cafe馆',
  history: '我的',
  search: '搜索',
};

export const TopSourceBar: React.FC = () => {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const activeSourceFilter = usePlayerStore((s) => s.activeSourceFilter);
  const setActiveSourceFilter = usePlayerStore((s) => s.setActiveSourceFilter);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);
  const searchHuaweiCatalog = usePlayerStore((s) => s.searchHuaweiCatalog);
  const sources = usePlayerStore((s) => s.sources);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);
  const setImportModalOpen = usePlayerStore((s) => s.setImportModalOpen);

  const themeId = usePlayerStore((s) => s.themeId);
  const setThemeId = usePlayerStore((s) => s.setThemeId);
  const fontScale = usePlayerStore((s) => s.fontScale);
  const setFontScale = usePlayerStore((s) => s.setFontScale);
  const customAccent = usePlayerStore((s) => s.customAccent);
  const setCustomAccent = usePlayerStore((s) => s.setCustomAccent);
  const resetAppearance = usePlayerStore((s) => s.resetAppearance);

  const [themePopoverOpen, setThemePopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const huaweiSource = sources.find((s) => s.id === 'huawei');

  useEffect(() => {
    const activePalette =
      THEME_PALETTES.find((t) => t.id === themeId) || THEME_PALETTES[0];
    const root = document.documentElement;
    const effectiveAccent = customAccent || activePalette.accent;

    root.style.setProperty('--theme-base', activePalette.base);
    root.style.setProperty('--theme-surface', activePalette.surface);
    root.style.setProperty('--theme-elevated', activePalette.elevated);
    root.style.setProperty('--theme-text', activePalette.text);
    root.style.setProperty('--theme-secondary', activePalette.secondary);
    root.style.setProperty('--theme-muted', activePalette.muted);
    root.style.setProperty('--theme-accent', effectiveAccent);
    root.style.setProperty(
      '--theme-border',
      activePalette.dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)'
    );
    root.style.setProperty(
      '--theme-subtle',
      activePalette.dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.04)'
    );
    root.style.setProperty(
      '--theme-hover',
      activePalette.dark ? 'rgba(255, 255, 255, 0.11)' : 'rgba(15, 23, 42, 0.08)'
    );
    root.style.setProperty('--font-scale', String(fontScale));
    root.setAttribute('data-theme', activePalette.id);
    root.setAttribute('data-theme-mode', activePalette.dark ? 'dark' : 'light');
  }, [themeId, fontScale, customAccent]);

  useEffect(() => {
    if (!themePopoverOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setThemePopoverOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [themePopoverOpen]);

  const handleHeaderSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    if (activeNav !== 'search') {
      setActiveNav('search');
    }
    void searchHuaweiCatalog(searchQuery.trim());
  };

  return (
    <header className="h-16 shrink-0 px-8 xl:px-12 flex items-center justify-between z-20 select-none">
      {/* Left: HarmonyOS Bold Section Title + Subtle Multi-Source Pills */}
      <div className="flex items-center gap-6">
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-white leading-none">
          {NAV_TITLES[activeNav] || '推荐'}
        </h1>

        <div className="hidden md:flex items-center gap-1 p-1 rounded-full bg-white/[0.05] border border-white/[0.06]">
          {SOURCE_FILTERS.map((filter) => {
            const isActive = activeSourceFilter === filter.id;
            return (
              <button
                key={filter.id}
                onClick={() => setActiveSourceFilter(filter.id)}
                className={`relative px-3 py-1 rounded-full text-[12px] transition-colors cursor-pointer ${
                  isActive
                    ? 'text-white font-semibold'
                    : 'text-white/55 hover:text-white/90'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="harmony-source-segment"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-full bg-white/[0.14] shadow-xs"
                  />
                )}
                <span className="relative z-10">{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Account Pill + HarmonyOS Acoustic Wave Icon + Rounded-Full Search Bar */}
      <div className="flex items-center gap-3">
        {/* Huawei Account Quick Status */}
        <button
          onClick={() => setHuaweiAuthModalOpen(true)}
          className="hidden sm:flex items-center gap-2 h-9 px-3.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.07] text-[12px] font-medium text-white/85 transition-colors cursor-pointer"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              huaweiSource?.loggedIn ? 'bg-emerald-500' : 'bg-[#FA2D48]'
            }`}
          />
          <QrCode className="w-3.5 h-3.5 text-white/60" />
          <span className="max-w-[130px] truncate">
            {huaweiSource?.loggedIn
              ? huaweiSource.accountName.replace('华为账号 · ', '')
              : '连接华为音乐'}
          </span>
        </button>

        {/* Import Playlists Button */}
        <button
          onClick={() => setImportModalOpen(true)}
          title="导入歌单"
          className="w-9 h-9 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.07] flex items-center justify-center text-white/75 hover:text-white transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
        </button>

        {/* HarmonyOS Circular Acoustic Wave / Theme Studio Button (Exact match to screenshot) */}
        <div className="relative" ref={popoverRef}>
          <button
            onClick={() => setThemePopoverOpen((v) => !v)}
            title="主题外观与声学设定"
            className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] flex items-center justify-center text-white/85 transition-colors cursor-pointer relative"
          >
            <AudioLines className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#FA2D48]" />
          </button>

          <AnimatePresence>
            {themePopoverOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.16 }}
                className="absolute right-0 mt-2.5 w-80 p-4 rounded-2xl theme-modal backdrop-blur-3xl border border-white/[0.12] shadow-[0_24px_60px_rgba(0,0,0,0.35)] z-50 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
                    鸿蒙全场景主题 · 13 款色板
                  </span>
                  <button
                    onClick={() => {
                      resetAppearance();
                      setThemeId('light');
                    }}
                    className="text-[11px] text-white/50 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>鸿蒙默认浅色</span>
                  </button>
                </div>

                {/* Light Palettes */}
                <div className="space-y-1.5">
                  <div className="text-[10.5px] text-white/45 font-medium">
                    浅色模式 (晨光 · 晴海 · 鼠尾草 · 暖砂 · 蔷薇 · 冰川)
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {THEME_PALETTES.filter((t) => !t.dark).map((p) => {
                      const selected = themeId === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setThemeId(p.id)}
                          style={{
                            backgroundColor: p.base,
                            color: p.text,
                            borderColor: selected ? p.accent : 'rgba(0,0,0,0.12)',
                          }}
                          className="px-2.5 py-2 rounded-lg border text-left flex items-center justify-between text-[11.5px] font-medium cursor-pointer transition-transform active:scale-95"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: p.accent }}
                            />
                            <span style={{ color: p.text }}>{p.label}</span>
                          </span>
                          {selected && (
                            <Check
                              className="w-3 h-3 shrink-0"
                              style={{ color: p.accent }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Dark Palettes */}
                <div className="space-y-1.5">
                  <div className="text-[10.5px] text-white/45 font-medium">
                    深色模式 (绯红暗夜 · 午夜蓝 · 深林 · 石墨 · 夜玫瑰 · 咖啡 · 曜石)
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {THEME_PALETTES.filter((t) => t.dark).map((p) => {
                      const selected = themeId === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setThemeId(p.id)}
                          style={{
                            backgroundColor: p.base,
                            color: p.text,
                            borderColor: selected
                              ? p.accent
                              : 'rgba(255,255,255,0.12)',
                          }}
                          className="px-2.5 py-2 rounded-lg border text-left flex items-center justify-between text-[11.5px] font-medium cursor-pointer transition-transform active:scale-95"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: p.accent }}
                            />
                            <span style={{ color: p.text }}>{p.label}</span>
                          </span>
                          {selected && (
                            <Check
                              className="w-3 h-3 shrink-0"
                              style={{ color: p.accent }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Accent Swatches */}
                <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between text-[10.5px] text-white/45">
                    <span>自定义点缀色</span>
                    {customAccent && (
                      <button
                        onClick={() => setCustomAccent(null)}
                        className="text-white/60 hover:text-white cursor-pointer"
                      >
                        跟随主题
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    {CUSTOM_ACCENT_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        onClick={() => setCustomAccent(hex)}
                        style={{ backgroundColor: hex }}
                        className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                          customAccent === hex ? 'ring-2 ring-white' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Font Scale Slider */}
                <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between text-[10.5px] text-white/55">
                    <span>字号缩放</span>
                    <span className="font-mono-tabular">
                      {Math.round(fontScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.85}
                    max={1.15}
                    step={0.05}
                    value={fontScale}
                    onChange={(e) => setFontScale(parseFloat(e.target.value))}
                    className="w-full cursor-pointer"
                    style={{ accentColor: 'var(--theme-accent)' }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* HarmonyOS Rounded-Full Search Capsule (Exact match to `🔍 Search` in screenshot) */}
        <form
          onSubmit={handleHeaderSearch}
          className="w-56 sm:w-72 xl:w-80 h-9 px-4 rounded-full bg-white/[0.06] border border-white/[0.08] focus-within:border-[#FA2D48]/60 flex items-center gap-2.5 transition-colors"
        >
          <Search className="w-3.5 h-3.5 text-white/45 shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-[13px] text-white placeholder-white/40 focus:outline-none"
          />
        </form>
      </div>
    </header>
  );
};
