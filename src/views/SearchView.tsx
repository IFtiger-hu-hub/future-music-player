import React, { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

const QUICK_KEYWORDS = ['林俊杰', '周杰伦', '陈奕迅', '王菲', '加州旅馆', '渡口'];

export const SearchView: React.FC = () => {
  const tracks = usePlayerStore((s) => s.tracks);
  const activeSourceFilter = usePlayerStore((s) => s.activeSourceFilter);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);
  const searchHuaweiCatalog = usePlayerStore((s) => s.searchHuaweiCatalog);

  const [isSearchingCloud, setIsSearchingCloud] = useState(false);

  const sourceFilteredTracks =
    activeSourceFilter === 'all'
      ? tracks
      : tracks.filter((t) =>
          t.bindings.some((b) => b.source === activeSourceFilter)
        );

  const handleCloudSearch = async (
    e?: React.FormEvent,
    customKeyword?: string
  ) => {
    if (e) e.preventDefault();
    const target = (customKeyword ?? searchQuery).trim();
    if (!target) return;
    setIsSearchingCloud(true);
    try {
      await searchHuaweiCatalog(target);
    } finally {
      setIsSearchingCloud(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-[24px] surface-bento space-y-4">
        <form
          onSubmit={(e) => handleCloudSearch(e)}
          className="flex items-center gap-3 px-4 py-2 rounded-full bg-white/[0.05] border border-white/[0.08] focus-within:border-[#FA2D48] transition-colors"
        >
          <Search className="w-4 h-4 text-white/45 shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索歌曲、歌手、专辑，回车直连华为音乐无损曲库..."
            className="w-full bg-transparent text-[13.5px] text-white placeholder-white/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSearchingCloud || !searchQuery.trim()}
            style={{ backgroundColor: 'var(--theme-accent)' }}
            className="h-8 px-4 rounded-full disabled:opacity-40 text-[12px] font-semibold !text-white shrink-0 cursor-pointer transition-transform active:scale-95"
          >
            {isSearchingCloud ? '搜索中...' : '云端搜索'}
          </button>
        </form>

        {/* HarmonyOS Hot Search Capsules */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-white/50 flex items-center gap-1 mr-1 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-[#FA2D48]" />
            <span>热门搜索:</span>
          </span>
          {QUICK_KEYWORDS.map((kw) => (
            <button
              key={kw}
              onClick={() => {
                setSearchQuery(kw);
                void handleCloudSearch(undefined, kw);
              }}
              className="px-3.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.07] text-[12px] text-white/75 hover:text-white transition-colors cursor-pointer"
            >
              {kw}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 rounded-[24px] surface-bento">
        <TrackTable
          tracks={sourceFilteredTracks.filter(
            (t) =>
              !searchQuery.trim() ||
              t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              t.artists
                .join(' ')
                .toLowerCase()
                .includes(searchQuery.toLowerCase()) ||
              t.album.toLowerCase().includes(searchQuery.toLowerCase())
          )}
        />
      </div>
    </div>
  );
};
