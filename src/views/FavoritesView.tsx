import React, { useEffect, useState } from 'react';
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
import {
  HuaweiRecommendedPlaylistCard,
  musicGateway,
} from '../services/musicGateway';
import { TrackTable } from '../components/TrackTable';

const HARMONY_CATEGORY_PILLS = [
  { id: 'featured', label: '精选', icon: Star },
  { id: 'artists', label: '歌手', icon: Mic2 },
  { id: 'ai_music', label: 'AI 音乐', icon: Sparkles },
  { id: 'playlists', label: '歌单', icon: ListMusic },
  { id: 'categories', label: '分类', icon: LayoutGrid },
] as const;

const DEFAULT_HUAWEI_RECOMMENDED_PLAYLISTS: HuaweiRecommendedPlaylistCard[] = [
  {
    id: 'pl_hw_LWPp-V39aVeVP9IRL',
    sourcePlaylistId: 'LWPp-V39aVeVP9IRL',
    title: '「华语精选」那些年你单曲循环过的歌',
    description:
      '这些歌从学生时代就一直存在于播放器中，每一首都值得单曲循环的华语珍藏歌单。',
    playCount: '630.4万',
    trackCount: 57,
    coverUrl:
      'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/3/v3/fpEuFm2WQRKAlD0dbQkyzw/b47fe3a1-d2f0-45ae-9a5c-80b6129720a1.jpg/music_pgcsonglistcover_500x500.webp',
  },
  {
    id: 'pl_hw_MaD_RNL1AAJ9pR6gT',
    sourcePlaylistId: 'MaD_RNL1AAJ9pR6gT',
    title: '环球音乐·华语精选',
    description:
      '环球音乐旅行到达华语站，精选环球唱片旗下华语乐坛最流行、最经典的无损金曲。',
    playCount: '3616.8万',
    trackCount: 68,
    coverUrl:
      'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/0/v3/GFK31hk6Tq-aDFCvPAVwRQ/e0e353d0-f67a-4c02-91c3-2531438a54c3.jpg/music_pgcsonglistcover_500x500.webp',
  },
  {
    id: 'pl_hw_u.MIJnNpl_u9NsaljIn',
    sourcePlaylistId: 'u.MIJnNpl_u9NsaljIn',
    title: '【治愈华语】自己买花，自己长大',
    description:
      '一个人的时候更要好好爱自己，心怀宇宙浪漫，至少还有星月可以寄望。',
    playCount: '1938.9万',
    trackCount: 30,
    coverUrl:
      'https://music-pics-drcn.dbankcdn.cn/image/d8/5c/F97CA101DC4DD4ECE715D19FFBA6C999_middleImage.jpg',
  },
  {
    id: 'pl_hw_u.MH2uscz9HzxbaLlSI',
    sourcePlaylistId: 'u.MH2uscz9HzxbaLlSI',
    title: '华语精选 · 90后老歌仓库',
    description:
      '怀旧不是因为那个时代多么好，而是那个时候你正年轻，收录 90 后时代金曲。',
    playCount: '2836.9万',
    trackCount: 30,
    coverUrl:
      'https://music-pics-drcn.dbankcdn.cn/image/aa/a1/DD673B6698D18893DA135571B8854E38_bigIcon.jpg',
  },
  {
    id: 'pl_hw_u.NKO5y2uQsrxR35KoS',
    sourcePlaylistId: 'u.NKO5y2uQsrxR35KoS',
    title: '治愈华语：让歌声给岁月写满柔情',
    description:
      '保持积极不代表你要一直快乐，而是即使在最艰难的日子也相信会有变好的那天。',
    playCount: '2017.1万',
    trackCount: 20,
    coverUrl:
      'https://music-pics-drcn.dbankcdn.cn/image/90/42/28708724C1C97BB09398395E2F83A82A_middleImage.jpg',
  },
];

const RECOMMENDATION_TOPICS = [
  '华语精选',
  '治愈华语',
  '粤语经典',
  '欧美流行',
  '热门歌单',
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
  const setNeteaseModalOpen = usePlayerStore((s) => s.setNeteaseModalOpen);
  const searchHuaweiCatalog = usePlayerStore((s) => s.searchHuaweiCatalog);
  const openCuratedPlaylist = usePlayerStore((s) => s.openCuratedPlaylist);

  const [activeCategory, setActiveCategory] = useState<string>('featured');
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [recommendedCards, setRecommendedCards] = useState<
    HuaweiRecommendedPlaylistCard[]
  >(DEFAULT_HUAWEI_RECOMMENDED_PLAYLISTS);
  const [topicIdx, setTopicIdx] = useState<number>(0);
  const [isRefreshingRecs, setIsRefreshingRecs] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const loader =
      activeSourceFilter === 'netease'
        ? musicGateway.fetchNeteaseRecommendations()
        : musicGateway.fetchHuaweiRecommendations('华语精选');
    loader.then((list) => {
      if (!cancelled && list.length >= 5) {
        setRecommendedCards(list.slice(0, 5));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeSourceFilter]);

  const refreshRecommendations = async () => {
    if (isRefreshingRecs) return;
    setIsRefreshingRecs(true);
    const nextIdx = (topicIdx + 1) % RECOMMENDATION_TOPICS.length;
    setTopicIdx(nextIdx);
    const list =
      activeSourceFilter === 'netease'
        ? await musicGateway.fetchNeteaseRecommendations()
        : await musicGateway.fetchHuaweiRecommendations(
            RECOMMENDATION_TOPICS[nextIdx]
          );
    if (list.length >= 5) {
      setRecommendedCards(list.slice(0, 5));
    }
    setIsRefreshingRecs(false);
  };

  const hasRealNcmTracks = tracks.some((t) => t.id.startsWith('ncm_'));
  const hasRealHwTracks = tracks.some((t) => t.id.startsWith('hw_'));

  const sourceFilteredTracks =
    activeSourceFilter === 'all'
      ? tracks
      : activeSourceFilter === 'netease'
        ? hasRealNcmTracks
          ? tracks.filter((t) => t.id.startsWith('ncm_'))
          : tracks.filter((t) => t.bindings.some((b) => b.source === 'netease'))
        : activeSourceFilter === 'huawei'
          ? hasRealHwTracks
            ? tracks.filter((t) => t.id.startsWith('hw_'))
            : tracks.filter((t) => t.bindings.some((b) => b.source === 'huawei'))
          : tracks.filter((t) =>
              t.bindings.some((b) => b.source === activeSourceFilter)
            );

  const favoriteTracks = sourceFilteredTracks.filter((t) => t.isFavorite);
  const displayTracks =
    favoriteTracks.length > 0 ? favoriteTracks : sourceFilteredTracks;
  const huaweiSource = sources.find((s) => s.id === 'huawei')!;
  const neteaseSource = sources.find((s) => s.id === 'netease')!;
  const isNeteaseMode = activeSourceFilter === 'netease';

  const filteredTableTracks = artistFilter
    ? displayTracks.filter(
        (t) =>
          t.artists.some((a) => a.includes(artistFilter)) ||
          t.title.includes(artistFilter)
      )
    : displayTracks;

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
            void openCuratedPlaylist({
              id: isNeteaseMode ? 'pl_ncm_3778678' : 'pl_hero_listen_now',
              sourcePlaylistId: isNeteaseMode ? '3778678' : 'N0dkEOhQ6HMFtiDAb',
              kind: isNeteaseMode ? 'imported' : 'local',
              name: isNeteaseMode
                ? '现在就听 · 网易云热歌榜'
                : '现在就听 · 华语流行神曲电台',
              description: isNeteaseMode
                ? '实时拉取网易云音乐官方《热歌榜》真实曲目，支持双语歌词与华为无损自动点亮'
                : '实时拉取华为音乐官方《华语流行神曲》歌单真实曲目，支持无损 FLAC 与逐字歌词',
              coverUrl:
                displayTracks[0]?.coverUrl ||
                'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/ec/v3/Xc6DsPobTyqPXJx__K65lg/732edf4c-b19d-49fd-814d-b7402d032543.jpg/music_pgcsonglistcover_500x500.webp',
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
              <span>{isNeteaseMode ? '网易云 FM' : 'Music FM'}</span>
            </span>
            <span className="text-[10.5px] !text-white/55 opacity-0 group-hover:opacity-100 transition-opacity">
              {isNeteaseMode ? '查看网易云热歌榜 ›' : '查看 36 首真实曲目 ›'}
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
                  'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/ec/v3/Xc6DsPobTyqPXJx__K65lg/732edf4c-b19d-49fd-814d-b7402d032543.jpg/music_pgcsonglistcover_500x500.webp'
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
                {isNeteaseMode ? '网易云热歌榜' : '现在就听'}
              </div>
              <div className="text-[11.5px] !text-white/70 truncate mt-0.5">
                {displayTracks[0]
                  ? `${displayTracks[0].title} - ${displayTracks[0].artists.join('/')}`
                  : '爱情36计 - 蔡依林'}
              </div>
            </div>
            <button
              aria-label="立即播放现在就听"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                void openCuratedPlaylist({
                  id: isNeteaseMode ? 'pl_ncm_3778678' : 'pl_hero_listen_now',
                  sourcePlaylistId: isNeteaseMode
                    ? '3778678'
                    : 'N0dkEOhQ6HMFtiDAb',
                  kind: isNeteaseMode ? 'imported' : 'local',
                  name: isNeteaseMode
                    ? '现在就听 · 网易云热歌榜'
                    : '现在就听 · 华语流行神曲电台',
                  description: isNeteaseMode
                    ? '网易云音乐官方《热歌榜》真实曲目'
                    : '华为音乐官方《华语流行神曲》歌单真实曲目',
                  coverUrl:
                    displayTracks[0]?.coverUrl ||
                    'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/ec/v3/Xc6DsPobTyqPXJx__K65lg/732edf4c-b19d-49fd-814d-b7402d032543.jpg/music_pgcsonglistcover_500x500.webp',
                  trackIds: buildTrackSlice(0, 25),
                  autoPlayFirst: true,
                });
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
            void openCuratedPlaylist({
              id: isNeteaseMode ? 'pl_ncm_19723756' : 'pl_hero_daily_30',
              sourcePlaylistId: isNeteaseMode
                ? '19723756'
                : 'u.Mese7_VQp0taJIdcK',
              kind: isNeteaseMode ? 'imported' : 'local',
              name: isNeteaseMode
                ? '每日 30 首 · 网易云飙升榜'
                : '每日 30 首 · 华语宝藏热歌每日一听',
              description: isNeteaseMode
                ? '实时同步网易云音乐官方《飙升榜》真实曲库'
                : '实时同步华为音乐官方《宝藏热歌每日一听》真实曲库，每日更新无损金曲',
              coverUrl:
                'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/3a/v3/n-3pdnO7TU6SAZM9QQfayg/30f7e79a-75e9-4dde-81e9-8a4040406cf6.jpg/music_pgcsonglistcover_500x500.webp',
              trackIds: [],
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
              查看实时歌单 ›
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
                {isNeteaseMode ? '网易云飙升榜' : '每日30首'}
              </div>
              <div className="text-[11.5px] !text-white/75 truncate mt-0.5">
                {displayTracks[1]
                  ? `${displayTracks[1].title} - ${displayTracks[1].artists.join('/')}`
                  : '华语流行｜宝藏热歌每日一听'}
              </div>
            </div>
            <button
              aria-label="立即播放每日30首"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                void openCuratedPlaylist({
                  id: isNeteaseMode ? 'pl_ncm_19723756' : 'pl_hero_daily_30',
                  sourcePlaylistId: isNeteaseMode
                    ? '19723756'
                    : 'u.Mese7_VQp0taJIdcK',
                  kind: isNeteaseMode ? 'imported' : 'local',
                  name: isNeteaseMode
                    ? '每日 30 首 · 网易云飙升榜'
                    : '每日 30 首 · 华语宝藏热歌每日一听',
                  description: isNeteaseMode
                    ? '网易云音乐官方《飙升榜》真实曲库'
                    : '华为音乐官方《宝藏热歌每日一听》真实曲库',
                  coverUrl:
                    'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/3a/v3/n-3pdnO7TU6SAZM9QQfayg/30f7e79a-75e9-4dde-81e9-8a4040406cf6.jpg/music_pgcsonglistcover_500x500.webp',
                  trackIds: [],
                  autoPlayFirst: true,
                });
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
            void openCuratedPlaylist({
              id: isNeteaseMode ? 'pl_ncm_3779629' : 'pl_hero_new_releases',
              sourcePlaylistId: isNeteaseMode ? '3779629' : 'O4PIWQ-1wQD9T9k-F',
              kind: isNeteaseMode ? 'imported' : 'local',
              name: isNeteaseMode
                ? '新歌推荐 · 网易云新歌榜'
                : '新歌推荐 · 华语流行新声',
              description: isNeteaseMode
                ? '实时拉取网易云音乐官方《新歌榜》首发真实曲目'
                : '实时拉取华为音乐官方《华语流行新声》首发歌单 37 首真实曲目',
              coverUrl:
                'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/fe/v3/UxWSW8twQ9iswdT47gEwmg/b8bc9588-31fc-4324-a61a-3eff11c70c12.jpg/music_pgcsonglistcover_500x500.webp',
              trackIds: [],
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
              {isNeteaseMode ? '查看网易云新歌榜 ›' : '查看 37 首新歌 ›'}
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
                    'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/fe/v3/UxWSW8twQ9iswdT47gEwmg/b8bc9588-31fc-4324-a61a-3eff11c70c12.jpg/music_pgcsonglistcover_500x500.webp'
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
                {isNeteaseMode ? '网易云新歌榜' : '新歌推荐'}
              </div>
              <div className="text-[11.5px] !text-white/75 truncate mt-0.5">
                {displayTracks[2]
                  ? `${displayTracks[2].title} - ${displayTracks[2].artists.join('/')}`
                  : '华语流行新声 · 官方首发'}
              </div>
            </div>
            <button
              aria-label="立即播放新歌推荐"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                void openCuratedPlaylist({
                  id: isNeteaseMode
                    ? 'pl_ncm_3779629'
                    : 'pl_hero_new_releases',
                  sourcePlaylistId: isNeteaseMode
                    ? '3779629'
                    : 'O4PIWQ-1wQD9T9k-F',
                  kind: isNeteaseMode ? 'imported' : 'local',
                  name: isNeteaseMode
                    ? '新歌推荐 · 网易云新歌榜'
                    : '新歌推荐 · 华语流行新声',
                  description: isNeteaseMode
                    ? '网易云音乐官方《新歌榜》首发真实曲目'
                    : '华为音乐官方《华语流行新声》首发歌单真实曲目',
                  coverUrl:
                    'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_pgcsonglistcover_100_1/fe/v3/UxWSW8twQ9iswdT47gEwmg/b8bc9588-31fc-4324-a61a-3eff11c70c12.jpg/music_pgcsonglistcover_500x500.webp',
                  trackIds: [],
                  autoPlayFirst: true,
                });
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
            void openCuratedPlaylist({
              id: isNeteaseMode
                ? 'pl_ncm_2884035'
                : 'pl_hero_heartbeat_radar',
              sourcePlaylistId: isNeteaseMode
                ? '2884035'
                : 'u.M_uZkeuvWMKgF2oyJ',
              kind: isNeteaseMode ? 'imported' : 'local',
              name: isNeteaseMode
                ? '心动模式 · 网易云原创榜'
                : '心动模式 · 治愈华语心动雷达',
              description: isNeteaseMode
                ? '实时拉取网易云音乐官方《原创榜》真实高共鸣金曲'
                : '实时拉取华为音乐《治愈华语 | 时光清浅，感恩遇见》40 首真实高共鸣金曲',
              coverUrl:
                'https://music-pics-drcn.dbankcdn.cn/image/11/3f/D953BC2059A798D535B2952CE704AC58_middleImage.jpg',
              trackIds: [],
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
              <span>{isNeteaseMode ? '网易云原创雷达' : 'Hi-Res 心动雷达'}</span>
            </span>
            <span className="text-[10.5px] !text-white/65 opacity-0 group-hover:opacity-100 transition-opacity">
              {isNeteaseMode ? '查看网易云原创榜 ›' : '查看 40 首真实曲目 ›'}
            </span>
          </div>

          <div className="relative z-10" />

          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-bold !text-white leading-tight">
                {isNeteaseMode ? '网易云原创榜' : '心动模式'}
              </div>
              <div className="text-[11.5px] !text-white/75 truncate mt-0.5">
                {displayTracks[3]
                  ? `${displayTracks[3].title} - ${displayTracks[3].artists.join('/')}`
                  : '陪你度过漫长岁月 - 陈奕迅'}
              </div>
            </div>
            <button
              aria-label="立即播放心动模式"
              title="立即播放"
              onClick={(e) => {
                e.stopPropagation();
                void openCuratedPlaylist({
                  id: isNeteaseMode
                    ? 'pl_ncm_2884035'
                    : 'pl_hero_heartbeat_radar',
                  sourcePlaylistId: isNeteaseMode
                    ? '2884035'
                    : 'u.M_uZkeuvWMKgF2oyJ',
                  kind: isNeteaseMode ? 'imported' : 'local',
                  name: isNeteaseMode
                    ? '心动模式 · 网易云原创榜'
                    : '心动模式 · 治愈华语心动雷达',
                  description: isNeteaseMode
                    ? '网易云音乐官方《原创榜》真实曲库'
                    : '华为音乐《治愈华语 | 时光清浅，感恩遇见》真实曲库',
                  coverUrl:
                    'https://music-pics-drcn.dbankcdn.cn/image/11/3f/D953BC2059A798D535B2952CE704AC58_middleImage.jpg',
                  trackIds: [],
                  autoPlayFirst: true,
                });
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

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void refreshRecommendations()}
              disabled={isRefreshingRecs}
              className="h-8.5 px-3.5 rounded-full btn-harmony-secondary text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
              title={
                isNeteaseMode
                  ? '从网易云音乐换一批真实推荐歌单'
                  : '从华为音乐云端换一批真实推荐歌单'
              }
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-white/65 ${
                  isRefreshingRecs ? 'animate-spin' : ''
                }`}
              />
              <span>
                {isNeteaseMode
                  ? '换一批网易云推荐'
                  : `换一批推荐 (${RECOMMENDATION_TOPICS[topicIdx]})`}
              </span>
            </button>

            {isNeteaseMode ? (
              <button
                onClick={() => setNeteaseModalOpen(true)}
                className="h-8.5 px-4 rounded-full btn-harmony-primary text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5 !text-white" />
                <span>
                  {neteaseSource.accountName.startsWith('网易云 ·')
                    ? `已连 ${neteaseSource.accountName.replace('网易云 · ', '')}`
                    : '扫码 / 昵称同步网易云'}
                </span>
              </button>
            ) : huaweiSource.loggedIn ? (
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
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {recommendedCards.map((card) => (
            <div
              key={card.id}
              onClick={() =>
                void openCuratedPlaylist({
                  id: card.id,
                  sourcePlaylistId: card.sourcePlaylistId,
                  kind: card.id.startsWith('pl_ncm_') ? 'imported' : 'local',
                  name: card.title,
                  description: `${card.description} · ${
                    card.id.startsWith('pl_ncm_') ? '网易云音乐' : '华为音乐'
                  }播放 ${card.playCount}`,
                  coverUrl: card.coverUrl,
                  trackIds: [],
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

                {/* Bottom-Right Quick Play FAB */}
                <button
                  type="button"
                  title="直接播放此真实歌单"
                  aria-label={`播放 ${card.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openCuratedPlaylist({
                      id: card.id,
                      sourcePlaylistId: card.sourcePlaylistId,
                      kind: card.id.startsWith('pl_ncm_') ? 'imported' : 'local',
                      name: card.title,
                      description: `${card.description} · ${
                        card.id.startsWith('pl_ncm_') ? '网易云音乐' : '华为音乐'
                      }播放 ${card.playCount}`,
                      coverUrl: card.coverUrl,
                      trackIds: [],
                      autoPlayFirst: true,
                    });
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

      {/* Row 4: 新歌精选 · 我喜欢的跨源无损曲库 */}
      <div className="p-5 rounded-[24px] surface-bento space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[18px] font-bold text-white tracking-tight">
              {artistFilter
                ? `${artistFilter} · 精选曲目`
                : isNeteaseMode
                  ? '网易云音乐 · 热歌与红心曲库'
                  : '新歌精选 · 我喜欢'}
            </h2>
            <span className="text-[12px] text-white/45">
              共 {filteredTableTracks.length} 首曲目
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
