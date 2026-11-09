import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

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

  const handleCloudSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearchingCloud(true);
    try {
      await searchHuaweiCatalog(searchQuery.trim());
    } finally {
      setIsSearchingCloud(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">搜索</h1>
        <form
          onSubmit={handleCloudSearch}
          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] focus-within:border-[#FA2D48]/70 transition-colors"
        >
          <Search className="w-4 h-4 text-white/45 shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索华为音乐云端曲库、歌手、专辑或本地歌曲 (回车直连华为音乐检索)..."
            className="w-full bg-transparent text-[14px] text-white placeholder-white/35 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSearchingCloud || !searchQuery.trim()}
            style={{ backgroundColor: 'var(--theme-accent)' }}
            className="px-3.5 py-1.5 rounded-lg disabled:opacity-40 text-[12px] font-semibold !text-white shrink-0 cursor-pointer"
          >
            {isSearchingCloud ? '检索中...' : '云端搜索'}
          </button>
        </form>
      </div>

      <TrackTable
        tracks={sourceFilteredTracks.filter(
          (t) =>
            !searchQuery.trim() ||
            t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.artists.join(' ').toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.album.toLowerCase().includes(searchQuery.toLowerCase())
        )}
      />
    </>
  );
};

