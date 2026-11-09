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
    label: '全曲库检索',
    icon: Search,
    group: 'discover',
  },
  {
    id: 'favorites',
    label: '喜爱珍藏',
    icon: Heart,
    group: 'library',
  },
  {
    id: 'local_playlists',
    label: '自建精选集',
    icon: ListMusic,
    group: 'library',
  },
  {
    id: 'imported_playlists',
    label: '云端同步歌单',
    icon: FolderSync,
    group: 'library',
  },
  {
    id: 'history',
    label: '近期聆听',
    icon: Clock,
    group: 'library',
  },
  {
    id: 'sources',
    label: '音源与协议栈',
    icon: Disc3,
    group: 'system',
  },
  {
    id: 'settings',
    label: '外观与参量均衡',
    icon: SlidersHorizontal,
    group: 'system',
  },
];

const APPLE_PILL_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
  mass: 0.72,
};

export const Sidebar: React.FC = () => {
  const activeNav = usePlayerStore((s) => s.activeNav);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const tracks = usePlayerStore((s) => s.tracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const sources = usePlayerStore((s) => s.sources);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);

  const huaweiSource = sources.find((s) => s.id === 'huawei');
  const favoriteCount = tracks.filter((t) => t.isFavorite).length;
  const localPlaylistCount = playlists.filter((p) => p.kind === 'local').length;
  const importedPlaylistCount = playlists.filter((p) => p.kind === 'imported').length;

  const getBadgeCount = (id: NavSection): number | null => {
    if (id === 'favorites') return favoriteCount;
    if (id === 'local_playlists') return localPlaylistCount;
    if (id === 'imported_playlists') return importedPlaylistCount;
    return null;
  };

  const renderSection = (title: string, items: NavItemConfig[]) => (
    <div className="mb-6">
      {title && (
        <div className="px-3 mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/35">
            {title}
          </span>
        </div>
      )}
      <nav className="space-y-0.5 relative">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          const count = getBadgeCount(item.id);
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full relative flex items-center justify-between px-3 py-2 rounded-[10px] text-left transition-colors duration-150 cursor-pointer group ${
                isActive ? 'text-white font-medium' : 'text-white/60 hover:text-white/90'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="apple-sidebar-pill"
                  transition={APPLE_PILL_SPRING}
                  className="absolute inset-0 rounded-[10px] bg-white/[0.09] border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                >
                  <div
                    className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full"
                    style={{ backgroundColor: 'var(--theme-accent)' }}
                  />
                </motion.div>
              )}

              <div className="relative z-10 flex items-center gap-3 min-w-0">
                <Icon
                  style={{ color: isActive ? 'var(--theme-accent)' : undefined }}
                  className={`w-[16px] h-[16px] shrink-0 transition-colors ${
                    isActive ? '' : 'text-white/45 group-hover:text-white/75'
                  }`}
                />
                <span className="text-[13px] tracking-[-0.01em] truncate">
                  {item.label}
                </span>
              </div>

              {count !== null && count > 0 && (
                <span
                  className={`relative z-10 text-[10.5px] font-mono-tabular px-1.5 py-0.5 rounded-md transition-colors ${
                    isActive
                      ? 'text-white/85 bg-white/[0.08]'
                      : 'text-white/35 group-hover:text-white/55'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <aside className="w-[238px] shrink-0 h-full theme-sidebar backdrop-blur-2xl border-r border-white/[0.06] flex flex-col justify-between px-4 pt-5 pb-4 select-none z-20">
      <div>
        {/* Editorial Studio Brand Header */}
        <div className="flex items-center gap-3 px-2.5 pb-6">
          <div
            className="w-7 h-7 rounded-[9px] flex items-center justify-center !text-white shadow-[0_4px_14px_rgba(250,45,72,0.3)] ring-1 ring-white/20 shrink-0"
            style={{ backgroundColor: 'var(--theme-accent)' }}
          >
            <Disc3 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold tracking-[-0.02em] text-white leading-none">
              Future Music
            </div>
            <div className="text-[9.5px] font-mono-tabular tracking-[0.12em] uppercase text-white/40 mt-1">
              Studio · Hi-Res
            </div>
          </div>
        </div>

        {renderSection('EXPLORE · 探索', NAV_ITEMS.filter((i) => i.group === 'discover'))}
        {renderSection('ARCHIVE · 典藏库', NAV_ITEMS.filter((i) => i.group === 'library'))}
        {renderSection('CONSOLE · 控制台', NAV_ITEMS.filter((i) => i.group === 'system'))}
      </div>

      {/* Studio Account Status Module */}
      <div className="pt-3 border-t border-white/[0.06]">
        <button
          onClick={() => setHuaweiAuthModalOpen(true)}
          className="w-full p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition-all flex items-center justify-between group cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-[#FA2D48] to-[#B8001F] flex items-center justify-center text-[11px] font-bold !text-white shadow-xs ring-1 ring-white/15">
                华
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#161618] ${
                  huaweiSource?.loggedIn ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-medium text-white/90 truncate">
                  华为音乐云端
                </span>
              </div>
              <div className="text-[10.5px] font-mono-tabular text-white/45 truncate mt-0.5">
                {huaweiSource?.loggedIn
                  ? huaweiSource.accountName.replace('华为账号 · ', '')
                  : '点击扫码挂载无损源'}
              </div>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-white/30 group-hover:text-white/75 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>
      </div>
    </aside>
  );
};
