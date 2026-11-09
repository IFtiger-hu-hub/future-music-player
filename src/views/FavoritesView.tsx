import React, { useState } from 'react';
import {
  Play,
  Radio,
  Disc3,
  Star,
  Mic2,
  Sparkles,
  ListMusic,
  LayoutGrid,
  ChevronRight,
  RefreshCw,
  QrCode,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

const HARMONY_CATEGORY_PILLS = [
  { id: 'featured', label: '精选', icon: Star },
  { id: 'artists', label: '歌手', icon: Mic2 },
  { id: 'ai_music', label: 'AI 音乐', icon: Sparkles },
  { id: 'playlists', label: '歌单', icon: ListMusic },
  { id: 'categories', label: '分类', icon: LayoutGrid },
] as const;

const HI_RAVEN_CARDS = [
  {
    id: 'raven_1',
    title: '天生不庸俗，人间烟火里的浪漫情怀',
    playCount: '327.9万',
    coverUrl:
      'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=500&auto=format&fit=crop&q=80',
  },
  {
    id: 'raven_2',
    title: '用千万次的回眸换得今生擦肩',
    playCount: '184.2万',
    coverUrl:
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=80',
  },
  {
    id: 'raven_3',
    title: '午间温柔 | 把耳机里的浪漫留给人间',
    playCount: '256.0万',
    coverUrl:
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&auto=format&fit=crop&q=80',
  },
  {
    id: 'raven_4',
    title: '趁微风不噪，去见想见的人',
    playCount: '142.8万',
    coverUrl:
      'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500&auto=format&fit=crop&q=80',
  },
  {
    id: 'raven_5',
    title: '温柔的晚风吹散白日里的疲惫',
    playCount: '98.6万',
    coverUrl:
      'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80',
  },
];

const FEATURED_ARTISTS = [
  {
    name: '林俊杰',
    tag: 'Hi-Res 空间音频认证',
    avatar:
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80',
  },
  {
    name: '周杰伦',
    tag: '华语流行殿堂',
    avatar:
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&auto=format&fit=crop&q=80',
  },
  {
    name: '陈奕迅',
    tag: '粤语金曲臻品',
    avatar:
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80',
  },
  {
    name: '王力宏',
    tag: 'SQ 无损典藏',
    avatar:
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80',
  },
  {
    name: '薛之谦',
    tag: '深情流行热榜',
    avatar:
      'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=300&auto=format&fit=crop&q=80',
  },
];

const GENRE_TAGS = [
  '华语流行',
  '粤语金曲',
  'Audio Vivid 菁彩声',
  'Hi-Res 24bit 母带',
  '欧美流行',
  '咖啡馆轻音乐',
  '深夜治愈',
  '车载超重低音',
];

export const FavoritesView: React.FC = () => {
  const tracks = usePlayerStore((s) => s.tracks);
  const activeSourceFilter = usePlayerStore((s) => s.activeSourceFilter);
  const sources = usePlayerStore((s) => s.sources);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const triggerHuaweiSync = usePlayerStore((s) => s.triggerHuaweiSync);
  const setHuaweiAuthModalOpen = usePlayerStore((s) => s.setHuaweiAuthModalOpen);
  const searchHuaweiCatalog = usePlayerStore((s) => s.searchHuaweiCatalog);
  const openCuratedPlaylist = usePlayerStore((s) => s.openCuratedPlaylist);

  const [activeCategory, setActiveCategory] = useState<string>('featured');
  const [artistFilter, setArtistFilter] = useState<string | null>(null);

  const sourceFilteredTracks =
    activeSourceFilter === 'all'
      ? tracks
      : tracks.filter((t) =>
          t.bindings.some((b) => b.source === activeSourceFilter)
        );

  const favoriteTracks = sourceFilteredTracks.filter((t) => t.isFavorite);
  const displayTracks =
    favoriteTracks.length > 0 ? favoriteTracks : sourceFilteredTracks;
  const huaweiSource = sources.find((s) => s.id === 'huawei')!;

  const filteredTableTracks = artistFilter
    ? displayTracks.filter(
        (t) =>
          t.artists.some((a) => a.includes(artistFilter)) ||
          t.title.includes(artistFilter)
      )
    : favoriteTracks;

  const playRandomOrIndex = (idx: number) => {
    if (displayTracks.length === 0) return;
    const target = displayTracks[idx % displayTracks.length];
    playTrack(target);
  };

  const buildTrackSlice = (offset: number, count: number): string[] => {
    if (displayTracks.length === 0) return [];
    const rotated = [
      ...displayTracks.slice(offset % displayTracks.length),
      ...displayTracks.slice(0, offset % displayTracks.length),
    ];
    return rotated.slice(0, Math.min(count, rotated.length)).map((t) => t.id);
  };

  return (
    <div className="space-y-6">
      {/* Row 1: 4 Signature HarmonyOS NEXT Vertical Feature Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: 现在就听 (Music FM Deep Twilight Navy Card) */}
        <div
          onClick={() =>
            openCuratedPlaylist({
              id: 'pl_hero_listen_now',
              name: '现在就听 · Music FM 私人电台',
              description: '根据您的华为音乐无损听歌品味实时编排的私人无损电台列表',
              coverUrl:
                displayTracks[0]?.coverUrl ||
                'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop&q=80',
              trackIds: buildTrackSlice(0, 25),
            })
          }
          style={{
            background:
              'linear-gradient(180deg, #1E2C4F 0%, #172340 62%, #111A30 100%)',
          }}
          className="relative h-[264px] xl:h-[280px] rounded-[22px] p-5 flex flex-col justify-between overflow-hidden shadow-[0_14px_34px_rgba(17,26,48,0.2)] ring-1 ring-white/10 group cursor-pointer select-none transition-transform duration-300 hover:-translate-y-0.5"
        >
          <div className="relative z-10 flex items-center justify-between !text-white/90 text-[11.5px] font-semibold">
            <span className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 !text-white/90" />
              <span>Music FM</span>
            </span>
            <span className="text-[10.5px] !text-white/55 opacity-0 group-hover:opacity-100 transition-opacity">
              查看列表 ›
            </span>
          </div>

          <div className="relative z-10 flex items-center justify-center my-auto py-2">
            <div className="w-20 h-20 xl:w-24 xl:h-24 rounded-xl bg-white/10 border border-white/10 -mr-10 scale-90 opacity-55 overflow-hidden shadow-md">
              <img
                src={
                  displayTracks[1]?.coverUrl ||
                  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80'
                }
                alt=""
                className="w-full h-full object-cover opacity-70"
              />
            </div>

            <div className="relative z-10 w-28 h-28 xl:w-32 xl:h-32 rounded-[14px] overflow-hidden shadow-[0_16px_36px_rgba(0,0,0,0.55)] ring-1 ring-white/25 group-hover:scale-105 transition-transform duration-300">
              <img
                src={
                  displayTracks[0]?.coverUrl ||
                  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop&q=80'
                }
                alt="现在就听"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="w-20 h-20 xl:w-24 xl:h-24 rounded-xl bg-white/10 border border-white/10 -ml-10 scale-90 opacity-55 overflow-hidden shadow-md">
              <img
                src={
                  displayTracks[2]?.coverUrl ||
                  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80'
                }
                alt=""
                className="w-full h-full object-cover opacity-70"
              />
            </div>
          </div>

          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-bold !text-white leading-tight">
                现在就听
              </div>
              <div className="text-[11.5px] !text-white/70 truncate mt-0.5">
                {displayTracks[0]
                  ? `${displayTracks[0].title} - ${displayTracks[0].artists.join('/')}`
                  : 'Flowers - Miley Cyrus'}
              </div>
            </div>
            <button
              aria-label="立即播放现在就听"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                playRandomOrIndex(0);
              }}
              className="w-9 h-9 rounded-full btn-play-fab text-[#172340] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </button>
          </div>
        </div>

        {/* Card 2: 每日30首 (Dual-Split Atmospheric Calendar Card) */}
        <div
          onClick={() =>
            openCuratedPlaylist({
              id: 'pl_hero_daily_30',
              name: '每日 30 首 · 专属定制歌单',
              description: '每日清晨为您更新 30 首跨音源无损精选单曲',
              coverUrl:
                displayTracks[1]?.coverUrl ||
                'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=500&auto=format&fit=crop&q=80',
              trackIds: buildTrackSlice(1, 30),
            })
          }
          className="relative h-[264px] xl:h-[280px] rounded-[22px] p-5 flex flex-col justify-between overflow-hidden shadow-[0_14px_34px_rgba(74,107,136,0.2)] ring-1 ring-white/15 group cursor-pointer select-none transition-transform duration-300 hover:-translate-y-0.5"
        >
          <div className="absolute inset-0 grid grid-cols-2 pointer-events-none">
            <div
              style={{
                background:
                  'linear-gradient(180deg, #556C82 0%, #44596D 100%)',
              }}
              className="relative overflow-hidden"
            >
              <img
                src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=500&auto=format&fit=crop&q=80"
                alt=""
                className="w-full h-full object-cover opacity-40 mix-blend-luminosity"
              />
            </div>
            <div
              style={{
                background:
                  'linear-gradient(180deg, #6CA3CC 0%, #5889B5 60%, #6D7FA8 100%)',
              }}
              className="relative overflow-hidden border-l border-white/15"
            >
              <img
                src="https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=80"
                alt=""
                className="w-full h-full object-cover opacity-35"
              />
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-end">
            <span className="text-[10.5px] font-semibold !text-white/65 opacity-0 group-hover:opacity-100 transition-opacity">
              查看 30 首 ›
            </span>
          </div>

          <div className="relative z-10 flex flex-col items-center justify-center my-auto">
            <span className="text-[15px] font-medium !text-white/90 tracking-wide">
              November
            </span>
            <span className="text-[68px] xl:text-[74px] font-light !text-white leading-none tracking-tighter mt-0.5">
              30
            </span>
          </div>

          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-bold !text-white leading-tight">
                每日30首
              </div>
              <div className="text-[11.5px] !text-white/75 truncate mt-0.5">
                {displayTracks[1]
                  ? `${displayTracks[1].title} - ${displayTracks[1].artists.join('/')}`
                  : 'Spy (No Intro) - Kyle/Lil Yachty'}
              </div>
            </div>
            <button
              aria-label="立即播放每日30首"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                playRandomOrIndex(1);
              }}
              className="w-9 h-9 rounded-full btn-play-fab text-[#44596D] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </button>
          </div>
        </div>

        {/* Card 3: 新歌推荐 (Plum Burgundy + Transparent CD Jewel Case) */}
        <div
          onClick={() =>
            openCuratedPlaylist({
              id: 'pl_hero_new_releases',
              name: '新歌推荐 · Hi-Res 首发臻选',
              description: '华语与全球最新上架 SQ / Hi-Res 无损新歌合集',
              coverUrl:
                displayTracks[2]?.coverUrl ||
                'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=500&auto=format&fit=crop&q=80',
              trackIds: buildTrackSlice(2, 24),
            })
          }
          style={{
            background:
              'linear-gradient(180deg, #723B5D 0%, #5A2B48 65%, #461F37 100%)',
          }}
          className="relative h-[264px] xl:h-[280px] rounded-[22px] p-5 flex flex-col justify-between overflow-hidden shadow-[0_14px_34px_rgba(90,43,72,0.2)] ring-1 ring-white/10 group cursor-pointer select-none transition-transform duration-300 hover:-translate-y-0.5"
        >
          <div className="relative z-10 flex items-center justify-between !text-white/90 text-[11.5px] font-bold tracking-wider">
            <span className="flex items-center gap-1.5">
              <Disc3 className="w-3.5 h-3.5 !text-white/90" />
              <span>NEW</span>
            </span>
            <span className="text-[10.5px] font-semibold !text-white/60 opacity-0 group-hover:opacity-100 transition-opacity">
              查看列表 ›
            </span>
          </div>

          <div className="relative z-10 flex items-center justify-center my-auto py-1">
            <div className="w-32 h-28 xl:w-36 xl:h-32 rounded-[8px] border border-white/30 bg-white/10 shadow-[0_16px_36px_rgba(0,0,0,0.45)] flex overflow-hidden group-hover:scale-105 transition-transform duration-300">
              <div className="w-3.5 h-full bg-white/15 border-r border-white/25 flex flex-col justify-between py-2 items-center shrink-0">
                <span className="w-1 h-3 rounded-full bg-white/30" />
                <span className="w-1 h-3 rounded-full bg-white/30" />
              </div>
              <div className="flex-1 h-full overflow-hidden relative">
                <img
                  src={
                    displayTracks[2]?.coverUrl ||
                    'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=500&auto=format&fit=crop&q=80'
                  }
                  alt="新歌推荐"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-bold !text-white leading-tight">
                新歌推荐
              </div>
              <div className="text-[11.5px] !text-white/75 truncate mt-0.5">
                {displayTracks[2]
                  ? `${displayTracks[2].title} - ${displayTracks[2].artists.join('/')}`
                  : '崇拜 (新版) - 薛之谦'}
              </div>
            </div>
            <button
              aria-label="立即播放新歌推荐"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                playRandomOrIndex(2);
              }}
              className="w-9 h-9 rounded-full btn-play-fab text-[#5A2B48] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </button>
          </div>
        </div>

        {/* Card 4: 心动模式 (Warm Canyon Amber & Crimson Silk Waves) */}
        <div
          onClick={() =>
            openCuratedPlaylist({
              id: 'pl_hero_heartbeat_radar',
              name: '心动模式 · Hi-Res 心动雷达',
              description: '从您红心收藏的旋律基因出发，发现熟悉的惊喜与共鸣',
              coverUrl:
                displayTracks[3]?.coverUrl ||
                'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
              trackIds: buildTrackSlice(3, 25),
            })
          }
          style={{
            background:
              'linear-gradient(155deg, #E0532C 0%, #B32325 52%, #6B1017 100%)',
          }}
          className="relative h-[264px] xl:h-[280px] rounded-[22px] p-5 flex flex-col justify-between overflow-hidden shadow-[0_14px_34px_rgba(179,35,37,0.2)] ring-1 ring-white/10 group cursor-pointer select-none transition-transform duration-300 hover:-translate-y-0.5"
        >
          <img
            src="https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-55 mix-blend-overlay group-hover:scale-105 transition-transform duration-500 pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10 flex items-center justify-between !text-white/90 text-[11.5px] font-semibold">
            <span className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 !text-white/90" />
              <span>Hi-Res 心动雷达</span>
            </span>
            <span className="text-[10.5px] !text-white/65 opacity-0 group-hover:opacity-100 transition-opacity">
              查看列表 ›
            </span>
          </div>

          <div className="relative z-10" />

          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-bold !text-white leading-tight">
                心动模式
              </div>
              <div className="text-[11.5px] !text-white/75 truncate mt-0.5">
                {displayTracks[3]
                  ? `${displayTracks[3].title} - ${displayTracks[3].artists.join('/')}`
                  : 'Makeba (Ian Asher Remix) - Jain'}
              </div>
            </div>
            <button
              aria-label="立即播放心动模式"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                playRandomOrIndex(3);
              }}
              className="w-9 h-9 rounded-full btn-play-fab text-[#8E1B20] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: 5 Centered HarmonyOS Category Filter Pills (精选 / 歌手 / AI 音乐 / 歌单 / 分类) */}
      <div className="flex items-center justify-center gap-2.5 sm:gap-3.5 flex-wrap py-1 select-none">
        {HARMONY_CATEGORY_PILLS.map((pill) => {
          const Icon = pill.icon;
          const isSelected = activeCategory === pill.id;
          return (
            <button
              key={pill.id}
              onClick={() => {
                setActiveCategory(pill.id);
                setArtistFilter(null);
                if (pill.id === 'playlists') {
                  setActiveNav('local_playlists');
                }
              }}
              className={`h-9 px-5 sm:px-6 rounded-full text-[13px] font-semibold flex items-center gap-2 cursor-pointer ${
                isSelected ? 'btn-harmony-active' : 'btn-harmony-secondary'
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 ${
                  isSelected ? '!text-white fill-current' : 'text-white/60'
                }`}
              />
              <span>{pill.label}</span>
            </button>
          );
        })}
      </div>

      {/* Dynamic Category Showcase when 歌手 / AI 音乐 / 分类 is selected */}
      {activeCategory === 'artists' && (
        <div className="p-5 rounded-[24px] surface-bento space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-white">华语与全球殿堂歌手</h3>
            {artistFilter && (
              <button
                onClick={() => setArtistFilter(null)}
                className="text-xs text-[#FA2D48] font-medium cursor-pointer"
              >
                清除歌手筛选 ({artistFilter})
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {FEATURED_ARTISTS.map((art) => (
              <div
                key={art.name}
                onClick={() => {
                  setArtistFilter(art.name);
                  void searchHuaweiCatalog(art.name);
                }}
                className={`p-3.5 rounded-[18px] bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] flex flex-col items-center text-center cursor-pointer transition-all ${
                  artistFilter === art.name ? 'ring-2 ring-[#FA2D48]' : ''
                }`}
              >
                <img
                  src={art.avatar}
                  alt={art.name}
                  className="w-16 h-16 rounded-full object-cover shadow-md mb-2.5"
                />
                <div className="text-[14px] font-bold text-white">{art.name}</div>
                <div className="text-[11px] text-white/50 mt-0.5">{art.tag}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeCategory === 'ai_music' && (
        <div className="p-5 rounded-[24px] surface-bento flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="badge-lossless">HarmonyOS AI 空间声学</span>
              <h3 className="text-[16px] font-bold text-white">
                Audio Vivid 菁彩声三维声场与 AI 智能推荐
              </h3>
            </div>
            <p className="text-[12.5px] text-white/55">
              已结合您的华为音乐听歌偏好自动开启全曲库 24-bit 无损与空间音频对象渲染。
            </p>
          </div>
          <button
            onClick={() => playRandomOrIndex(0)}
            className="h-9 px-5 rounded-full btn-harmony-primary text-[12.5px] font-semibold shrink-0 cursor-pointer"
          >
            开启 AI 空间漫游
          </button>
        </div>
      )}

      {activeCategory === 'categories' && (
        <div className="p-5 rounded-[24px] surface-bento space-y-3">
          <h3 className="text-[16px] font-bold text-white">全曲库专区分类</h3>
          <div className="flex flex-wrap gap-2.5">
            {GENRE_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  void searchHuaweiCatalog(tag);
                  setActiveNav('search');
                }}
                className="px-4 py-2 rounded-full btn-harmony-secondary text-[12.5px] font-medium cursor-pointer"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Row 3: Hi Raven, 为你推荐 (5-Column Square Artwork Grid -> Click Cover to Open Playlist Detail) */}
      <div className="space-y-3.5 select-none">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActiveNav('local_playlists')}
            className="flex items-center gap-1 text-[18px] font-bold text-white tracking-tight cursor-pointer group"
          >
            <span>Hi Raven, 为你推荐</span>
            <ChevronRight className="w-4 h-4 text-white/45 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {huaweiSource.loggedIn ? (
            <button
              onClick={triggerHuaweiSync}
              className="h-8.5 px-4 rounded-full btn-harmony-secondary text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-white/65" />
              <span>同步华为云端资产</span>
            </button>
          ) : (
            <button
              onClick={() => setHuaweiAuthModalOpen(true)}
              className="h-8.5 px-4 rounded-full btn-harmony-secondary text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5 text-[#FA2D48]" />
              <span>扫码同步华为「我喜欢」</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {HI_RAVEN_CARDS.map((card, idx) => (
            <div
              key={card.id}
              onClick={() =>
                openCuratedPlaylist({
                  id: `pl_${card.id}`,
                  name: card.title,
                  description: `Hi Raven 专属氛围推荐歌单 · 累计播放 ${card.playCount}`,
                  coverUrl: card.coverUrl,
                  trackIds: buildTrackSlice(idx * 3, 18),
                })
              }
              className="group cursor-pointer space-y-2.5"
            >
              <div className="aspect-square rounded-[20px] overflow-hidden relative bg-white/5 ring-1 ring-black/[0.06] shadow-[0_8px_22px_-4px_rgba(15,23,42,0.08)] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_16px_32px_-6px_rgba(15,23,42,0.16)]">
                <img
                  src={card.coverUrl}
                  alt={card.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity pointer-events-none" />

                {/* Bottom-Left Frosted Play Count Pill */}
                <div className="absolute bottom-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-white/88 backdrop-blur-md text-[#18181A] text-[10.5px] font-semibold flex items-center gap-1 shadow-sm">
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>{card.playCount}</span>
                </div>

                {/* Bottom-Right Quick Play FAB (Stops propagation so clicking play starts music immediately, while clicking cover opens playlist) */}
                <button
                  type="button"
                  title="直接播放此歌单"
                  aria-label={`播放 ${card.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    playRandomOrIndex(idx * 3);
                  }}
                  className="absolute bottom-2.5 right-2.5 w-8.5 h-8.5 rounded-full btn-play-fab text-[#18181A] flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </button>
              </div>
              <p className="text-[12.5px] text-white/85 group-hover:text-[#FA2D48] transition-colors font-semibold leading-snug line-clamp-2 px-0.5">
                {card.title}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Row 4: 新歌精选 · 我喜欢的跨源无损曲库 (Wrapped in HarmonyOS White Elevated Card) */}
      <div className="p-5 rounded-[24px] surface-bento space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[18px] font-bold text-white tracking-tight">
              {artistFilter ? `${artistFilter} · 精选曲目` : '新歌精选 · 我喜欢'}
            </h2>
            <span className="text-[12px] text-white/45">
              共 {filteredTableTracks.length} 首无损与跨源收藏曲目
            </span>
          </div>
          <button
            onClick={() => playRandomOrIndex(0)}
            className="h-8.5 px-4 rounded-full btn-harmony-primary text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>播放全部</span>
          </button>
        </div>

        <TrackTable tracks={filteredTableTracks} />
      </div>
    </div>
  );
};
