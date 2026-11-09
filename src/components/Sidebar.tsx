import React from 'react';
import { motion } from 'motion/react';
import {
  Heart,
  ListMusic,
  FolderSync,
  Search,
  Clock,
  Disc3,
  SlidersHorizontal,
  ChevronRight,
} from 'lucide-react';
import { NavSection } from '../types/music';
import { usePlayerStore } from '../store/usePlayerStore';

interface NavItemConfig {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  group: 'discover' | 'library' | 'system';
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'search',
    label: '搜索',
    icon: Search,
    group: 'discover',
  },
  {
    id: 'favorites',
    label: '喜爱歌曲',
    icon: Heart,
    group: 'library',
  },
  {
    id: 'local_playlists',
    label: '我的歌单',
    icon: ListMusic,
    group: 'library',
  },
  {
    id: 'imported_playlists',
    label: '同步歌单',
    icon: FolderSync,
    group: 'library',
  },
  {
    id: 'history',
    label: '最近播放',
    icon: Clock,
    group: 'library',
  },
  {
    id: 'sources',
    label: '音源与账号',
    icon: Disc3,
    group: 'system',
  },
  {
    id: 'settings',
    label: '外观与均衡器',
    icon: SlidersHorizontal,
    group: 'system',
  },
];

// Silky physics spring (FlClash + macOS vibrancy selection)
const APPLE_PILL_SPRING = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 33,
  mass: 0.72,
};

export const Sidebar: React.FC = () => {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const sources = usePlayerStore((s) => s.sources);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);

  const huaweiSource = sources.find((s) => s.id === 'huawei');

  const renderSection = (title: string, items: NavItemConfig[]) => (
    <div className="mb-6">
      {title && (
        <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-tight text-white/35">
          {title}
        </div>
      )}
      <nav className="space-y-0.5 relative">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full relative flex items-center gap-3 px-3 py-2 rounded-[10px] text-left transition-colors duration-150 cursor-pointer ${
                isActive ? 'text-white font-medium' : 'text-white/60 hover:text-white/90'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="apple-sidebar-pill"
                  transition={APPLE_PILL_SPRING}
                  className="absolute inset-0 rounded-[10px] bg-white/[0.11] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                />
              )}

              <Icon
                style={{ color: isActive ? 'var(--theme-accent)' : undefined }}
                className={`relative z-10 w-[17px] h-[17px] shrink-0 transition-colors ${
                  isActive ? '' : 'text-white/50'
                }`}
              />
              <span className="relative z-10 text-[13.5px] tracking-[-0.01em] truncate">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <aside className="w-[228px] shrink-0 h-full theme-sidebar backdrop-blur-2xl border-r border-white/[0.06] flex flex-col justify-between px-3.5 pt-4 pb-4 select-none z-20">
      <div>
        {/* Clean Brand Header (Window title bar is handled natively by OS) */}
        <div className="flex items-center gap-2.5 px-3 pb-5">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center text-white shadow-xs shrink-0"
            style={{ backgroundColor: 'var(--theme-accent)' }}
          >
            <Disc3 className="w-3.5 h-3.5" />
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-white/90">
            Future Music
          </span>
        </div>

        {renderSection('', NAV_ITEMS.filter((i) => i.group === 'discover'))}
        {renderSection('资料库', NAV_ITEMS.filter((i) => i.group === 'library'))}
        {renderSection('设置与音源', NAV_ITEMS.filter((i) => i.group === 'system'))}
      </div>

      {/* Minimalist Apple-style Account Pill at Bottom */}
      <div className="pt-3 border-t border-white/[0.06]">
        <button
          onClick={() => setHuaweiAuthModalOpen(true)}
          className="w-full px-3 py-2.5 rounded-xl hover:bg-white/[0.06] transition-colors flex items-center justify-between group cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-b from-[#FA2D48] to-[#C7000B] flex items-center justify-center text-[11px] font-semibold text-white shrink-0 shadow-sm">
              华
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-white/90 truncate">
                华为音乐账号
              </div>
              <div className="text-[11px] text-white/45 truncate">
                {huaweiSource?.loggedIn ? huaweiSource.accountName : '点击登录同步资产'}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-white/70 transition-colors shrink-0" />
        </button>
      </div>
    </aside>
  );
};
