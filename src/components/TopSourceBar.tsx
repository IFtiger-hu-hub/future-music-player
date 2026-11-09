import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, RefreshCw, Plus, Palette, Check, RotateCcw } from 'lucide-react';
import { getThemePalette, SourceId, THEME_PALETTES } from '../types/music';
import { usePlayerStore } from '../store/usePlayerStore';

const APPLE_SEGMENT_SPRING = {
  type: 'spring' as const,
  stiffness: 440,
  damping: 34,
  mass: 0.7,
};

export const TopSourceBar: React.FC = () => {
  const sources = usePlayerStore((s) => s.sources);
  const activeSourceFilter = usePlayerStore((s) => s.activeSourceFilter);
  const setActiveSourceFilter = usePlayerStore((s) => s.setActiveSourceFilter);
  const setCommandPaletteOpen = usePlayerStore((s) => s.setCommandPaletteOpen);
  const setImportModalOpen = usePlayerStore((s) => s.setImportModalOpen);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const isSyncingHuawei = usePlayerStore((s) => s.isSyncingHuawei);
  const themeId = usePlayerStore((s) => s.themeId);
  const setThemeId = usePlayerStore((s) => s.setThemeId);
  const fontScale = usePlayerStore((s) => s.fontScale);
  const setFontScale = usePlayerStore((s) => s.setFontScale);
  const resetAppearance = usePlayerStore((s) => s.resetAppearance);

  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isThemeMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [isThemeMenuOpen]);

  const currentPalette = getThemePalette(themeId);

  const filterOptions: Array<{
    id: 'all' | SourceId;
    label: string;
  }> = [
    { id: 'all', label: '全部音源' },
    ...sources.map((s) => ({
      id: s.id,
      label: s.name.replace(' Subsonic', ''),
    })),
  ];

  return (
    <header className="h-[54px] shrink-0 px-8 border-b border-white/[0.05] theme-topbar backdrop-blur-2xl flex items-center justify-between gap-4 z-20 relative">
      {/* Apple macOS Segmented Control with FlClash Fluid Pill */}
      <div className="flex items-center p-0.5 rounded-[10px] bg-white/[0.06]">
        {filterOptions.map((tab) => {
          const isActive = activeSourceFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSourceFilter(tab.id)}
              className={`relative px-3 py-1 rounded-[8px] text-[12px] font-medium transition-colors cursor-pointer ${
                isActive ? 'text-white' : 'text-white/55 hover:text-white/85'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="apple-top-segmented-pill"
                  transition={APPLE_SEGMENT_SPRING}
                  className="absolute inset-0 rounded-[8px] bg-white/[0.14] shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
                />
              )}
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right Clean Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[12px] transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5" />
          <span>快速搜索</span>
          <kbd className="ml-2 text-[10px] font-mono-tabular text-white/35">⌘K</kbd>
        </button>

        {/* Quick Theme Switcher Button & Popover */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
            title="切换外观主题色板"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-white/85 text-[12px] font-medium transition-colors cursor-pointer"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--theme-accent)' }}
            />
            <Palette className="w-3.5 h-3.5 opacity-75" />
            <span>{currentPalette.label}</span>
          </button>

          <AnimatePresence>
            {isThemeMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="absolute right-0 mt-2 w-[340px] p-4 rounded-2xl theme-modal backdrop-blur-2xl border border-white/[0.1] shadow-[0_24px_60px_rgba(0,0,0,0.45)] z-50 space-y-3.5 select-none"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-white">
                    外观主题色板 (13 款)
                  </span>
                  <button
                    onClick={() => resetAppearance()}
                    className="text-[11px] text-white/50 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>重置默认</span>
                  </button>
                </div>

                {/* Light Themes */}
                <div>
                  <div className="text-[10px] font-medium text-white/45 mb-1.5">
                    浅色温润主题
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
                            borderColor: selected ? p.accent : 'rgba(0,0,0,0.1)',
                          }}
                          className={`px-2.5 py-2 rounded-xl border text-left flex items-center justify-between transition-transform active:scale-95 cursor-pointer ${
                            selected ? 'ring-2 ring-offset-0' : ''
                          }`}
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                              style={{ backgroundColor: p.accent }}
                            />
                            <span className="text-[11px] font-semibold truncate">
                              {p.label}
                            </span>
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

                {/* Dark Themes */}
                <div>
                  <div className="text-[10px] font-medium text-white/45 mb-1.5">
                    深色沉浸主题
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
                          className="px-2.5 py-2 rounded-xl border text-left flex items-center justify-between transition-transform active:scale-95 cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                              style={{ backgroundColor: p.accent }}
                            />
                            <span className="text-[11px] font-semibold truncate">
                              {p.label}
                            </span>
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

                {/* Font Scale Slider */}
                <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between gap-3">
                  <span className="text-[11px] text-white/60 shrink-0">
                    字体缩放 {Math.round(fontScale * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0.85}
                    max={1.15}
                    step={0.05}
                    value={fontScale}
                    onChange={(e) => setFontScale(parseFloat(e.target.value))}
                    className="w-full h-1 cursor-pointer"
                    style={{ accentColor: 'var(--theme-accent)' }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => void triggerHuaweiSync()}
          disabled={isSyncingHuawei}
          title="同步华为音乐收藏与歌单"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-white/85 text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingHuawei ? 'animate-spin' : ''}`} />
          <span>{isSyncingHuawei ? '同步中' : '同步资产'}</span>
        </button>

        <button
          onClick={() => setImportModalOpen(true)}
          title="管理音源与导入"
          className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-white/75 hover:text-white transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
