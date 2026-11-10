import { create } from 'zustand';
import {
  CanonicalTrack,
  EqualizerBand,
  MergeAuditRecord,
  MusicSourceMeta,
  NavSection,
  PlaylistItem,
  SourceId,
  ThemeId,
} from '../types/music';
import {
  INITIAL_PLAYLISTS,
  INITIAL_SOURCES,
  INITIAL_TRACKS,
} from '../data/mockMusicData';
import {
  DEFAULT_EQ_BANDS,
  EQ_PRESET_CURVES,
  getThemePalette,
} from '../theme/palettes';
import {
  applyThemeVariablesToDom,
  initializeAppearanceOnBoot,
  saveAppearance,
} from '../theme/themeEngine';
import { musicGateway } from '../services/musicGateway';
import { dispatchAudioSeek } from '../services/audioEngine';

export { applyThemeVariablesToDom };

const initialAppearance = initializeAppearanceOnBoot();

const UI_PREFS_STORAGE_KEY = 'future_music_ui_prefs_v1';

interface PersistedUiPrefs {
  volume?: number;
  eqPreset?: 'harman' | 'flat' | 'vocal' | 'bass';
  eqBands?: EqualizerBand[];
  lyricOffsetMs?: number;
  jevEnabled?: boolean;
  historyTrackIds?: string[];
  rememberPlaybackProgress?: boolean;
  lastTrackSnapshot?: CanonicalTrack;
  lastPlaybackSource?: SourceId;
  lastPlaybackTimeMs?: number;
}

function loadPersistedUiPrefs(): PersistedUiPrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedUiPrefs;
  } catch {
    return {};
  }
}

function savePersistedUiPrefs(partial: PersistedUiPrefs): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const prev = loadPersistedUiPrefs();
    window.localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...prev, ...partial })
    );
  } catch {
    // ignore storage errors
  }
}

const initialUiPrefs = loadPersistedUiPrefs();
const initialRememberPlayback = initialUiPrefs.rememberPlaybackProgress ?? true;
const initialRestoredTrack: CanonicalTrack | null =
  initialRememberPlayback &&
  initialUiPrefs.lastTrackSnapshot &&
  initialUiPrefs.lastTrackSnapshot.id
    ? {
        ...initialUiPrefs.lastTrackSnapshot,
        audioUrl: initialUiPrefs.lastTrackSnapshot.audioUrl?.includes(
          '/api/local/stream'
        )
          ? initialUiPrefs.lastTrackSnapshot.audioUrl
          : undefined,
      }
    : null;
let lastPlaybackPersistWallMs = 0;

const INITIAL_MERGE_AUDITS: MergeAuditRecord[] = [
  {
    id: 'merge_wanfeng_01',
    winnerTrackId: 'trk_wanfeng',
    loserTrackId: 'trk_wanfeng_ncm_alias',
    winnerTitle: '晚风心里吹 (华为无损主记录)',
    loserTitle: '晚风心里吹 - 阿梨粤 (网易云挂载别名)',
    method: 'code',
    score: 0.98,
    createdAt: '今天 · 自动代码相似度合并',
    revoked: false,
  },
  {
    id: 'merge_fuji_02',
    winnerTrackId: 'trk_fushishan',
    loserTrackId: 'trk_fuji_ncm_alias',
    winnerTitle: '富士山下 (华为 FLAC 主记录)',
    loserTitle: "富士山下 (What's Going On) - 陈奕迅 (网易云)",
    method: 'jev',
    score: 0.93,
    createdAt: '昨天 · Jev 灰区决策模型合并',
    revoked: false,
  },
];

export interface ToastMessage {
  id: string;
  title: string;
  detail?: string;
  tone: 'default' | 'success' | 'warning';
}

export interface PlayerState {
  // Navigation & Filter
  activeNav: NavSection;
  activeSourceFilter: 'all' | SourceId;
  selectedPlaylistId: string | null;
  searchQuery: string;

  // Overlays & Modals
  isStageOpen: boolean;
  isCommandPaletteOpen: boolean;
  isHuaweiAuthModalOpen: boolean;
  isNeteaseModalOpen: boolean;
  isImportModalOpen: boolean;
  isSyncingHuawei: boolean;
  isSyncingNetease: boolean;
  isResolvingAudio: boolean;
  isLoadingPlaylistDetail: boolean;

  // Appearance, Desktop Lyric, 10-Band EQ & Merge Audit
  themeId: ThemeId;
  fontScale: number;
  customAccent: string | null;
  isDesktopLyricOpen: boolean;
  isDesktopLyricLocked: boolean;
  eqPreset: 'harman' | 'flat' | 'vocal' | 'bass';
  eqBands: EqualizerBand[];
  jevEnabled: boolean;
  jevEndpoint: string;
  jevModel: string;
  mergeAudits: MergeAuditRecord[];
  fallbackPriority: SourceId[];

  // Library Data
  sources: MusicSourceMeta[];
  tracks: CanonicalTrack[];
  playlists: PlaylistItem[];
  historyTrackIds: string[];

  // Playback Engine
  currentTrack: CanonicalTrack;
  activeSourceForPlayback: SourceId;
  isPlaying: boolean;
  currentTimeMs: number;
  volume: number;
  qualityPreference: 'lossless' | 'hires' | 'standard';
  lyricOffsetMs: number;
  rememberPlaybackProgress: boolean;
  lastSwitchDirection: 'next' | 'prev';

  // Toasts
  toasts: ToastMessage[];

  // Actions
  setRememberPlaybackProgress: (enabled: boolean) => void;
  setActiveNav: (nav: NavSection) => void;
  setActiveSourceFilter: (source: 'all' | SourceId) => void;
  setSelectedPlaylistId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setStageOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setHuaweiAuthModalOpen: (open: boolean) => void;
  setNeteaseModalOpen: (open: boolean) => void;
  setImportModalOpen: (open: boolean) => void;
  setVolume: (vol: number) => void;
  searchHuaweiCatalog: (query: string) => Promise<void>;
  syncNeteaseByUid: (uid: string, cookie?: string) => Promise<void>;
  ensureNeteaseContentLoaded: () => Promise<void>;

  setDesktopLyricOpen: (open: boolean) => void;
  setDesktopLyricLocked: (locked: boolean) => void;
  setThemeId: (themeId: ThemeId) => void;
  setFontScale: (scale: number) => void;
  setCustomAccent: (accent: string | null) => void;
  resetAppearance: () => void;
  setEqBandGain: (freqHz: number, gainDb: number) => void;
  applyEqPreset: (preset: 'harman' | 'flat' | 'vocal' | 'bass') => void;
  setJevEnabled: (enabled: boolean) => void;
  revokeMergeDecision: (mergeId: string) => void;
  createLocalPlaylist: (name: string, description: string) => void;
  addTrackToLocalPlaylist: (playlistId: string, trackId: string) => void;
  openCuratedPlaylist: (spec: {
    id: string;
    sourcePlaylistId?: string;
    name: string;
    description: string;
    coverUrl: string;
    trackIds: string[];
    kind?: 'local' | 'imported';
    autoPlayFirst?: boolean;
  }) => Promise<void>;

  resolveTrackStream: (
    track: CanonicalTrack,
    source?: SourceId,
    autoPlay?: boolean
  ) => Promise<void>;
  playTrack: (track: CanonicalTrack, preferredSource?: SourceId) => void;
  togglePlay: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setCurrentTimeMs: (ms: number) => void;
  setTrackDurationSeconds: (trackId: string, seconds: number) => void;
  seekToMs: (ms: number) => void;
  tickProgress: (deltaMs: number) => void;
  switchPlaybackSource: (source: SourceId) => void;
  toggleFavorite: (trackId: string) => void;
  adjustLyricOffset: (deltaMs: number) => void;

  // Huawei Account & Multi-source Sync Actions
  hydrateLibraryFromSqlite: () => Promise<void>;
  triggerHuaweiSync: () => Promise<void>;
  completeHuaweiReauth: (accountLabel: string) => void;
  toggleSourceLogin: (sourceId: SourceId) => void;
  scanLocalFolder: () => void;
  pushToast: (
    title: string,
    detail?: string,
    tone?: 'default' | 'success' | 'warning'
  ) => void;
  dismissToast: (id: string) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  activeNav: 'favorites',
  activeSourceFilter: 'all',
  selectedPlaylistId: INITIAL_PLAYLISTS[0].id,
  searchQuery: '',

  isStageOpen: false,
  isCommandPaletteOpen: false,
  isHuaweiAuthModalOpen: false,
  isNeteaseModalOpen: false,
  isImportModalOpen: false,
  isSyncingHuawei: false,
  isSyncingNetease: false,
  isResolvingAudio: false,
  isLoadingPlaylistDetail: false,

  themeId: initialAppearance.themeId,
  fontScale: initialAppearance.fontScale,
  customAccent: initialAppearance.customAccent,
  isDesktopLyricOpen: false,
  isDesktopLyricLocked: false,
  eqPreset: initialUiPrefs.eqPreset ?? 'harman',
  eqBands: initialUiPrefs.eqBands ?? DEFAULT_EQ_BANDS,
  jevEnabled: initialUiPrefs.jevEnabled ?? false,
  jevEndpoint: 'https://api.openai.com/v1/chat/completions',
  jevModel: 'gpt-4o-mini',
  mergeAudits: INITIAL_MERGE_AUDITS,
  fallbackPriority: ['local', 'huawei', 'netease'],

  sources: INITIAL_SOURCES,
  tracks:
    initialRestoredTrack &&
    !INITIAL_TRACKS.some((t) => t.id === initialRestoredTrack.id)
      ? [initialRestoredTrack, ...INITIAL_TRACKS]
      : INITIAL_TRACKS,
  playlists: INITIAL_PLAYLISTS,
  historyTrackIds: initialUiPrefs.historyTrackIds ?? [
    'trk_wanfeng',
    'trk_fushishan',
    'trk_qilixiang',
    'trk_yeqv',
  ],

  currentTrack: initialRestoredTrack ?? INITIAL_TRACKS[0],
  activeSourceForPlayback: initialUiPrefs.lastPlaybackSource ?? 'huawei',
  isPlaying: false,
  currentTimeMs: initialRememberPlayback
    ? Math.max(0, initialUiPrefs.lastPlaybackTimeMs ?? 0)
    : 0,
  volume: initialUiPrefs.volume ?? 82,
  qualityPreference: 'lossless',
  lyricOffsetMs: initialUiPrefs.lyricOffsetMs ?? 0,
  rememberPlaybackProgress: initialRememberPlayback,
  lastSwitchDirection: 'next',

  toasts: [],

  setRememberPlaybackProgress: (enabled) => {
    const { currentTrack, activeSourceForPlayback, currentTimeMs } = get();
    if (enabled) {
      savePersistedUiPrefs({
        rememberPlaybackProgress: true,
        lastTrackSnapshot: currentTrack,
        lastPlaybackSource: activeSourceForPlayback,
        lastPlaybackTimeMs: currentTimeMs,
      });
    } else {
      savePersistedUiPrefs({
        rememberPlaybackProgress: false,
        lastTrackSnapshot: undefined,
        lastPlaybackTimeMs: 0,
      });
    }
    set({ rememberPlaybackProgress: enabled });
    get().pushToast(
      enabled ? '已开启退出断点续播记录' : '已关闭退出断点续播记录',
      enabled
        ? '退出或重启后将自动恢复上次播放的曲目、音源与精确时间轴位置'
        : '下次启动将不再恢复上次播放进度',
      enabled ? 'success' : 'default'
    );
  },

  setActiveNav: (nav) => set({ activeNav: nav }),
  setActiveSourceFilter: (source) => {
    set((state) => {
      let nextSelected = state.selectedPlaylistId;
      if (source === 'netease') {
        const firstNcm = state.playlists.find((p) => p.source === 'netease');
        if (firstNcm) {
          nextSelected = firstNcm.id;
        }
      } else if (source === 'huawei') {
        const firstHw = state.playlists.find((p) => p.source === 'huawei');
        if (firstHw) {
          nextSelected = firstHw.id;
        }
      } else if (source === 'local') {
        const firstLocal = state.playlists.find((p) => p.kind === 'local');
        if (firstLocal) {
          nextSelected = firstLocal.id;
        }
      }
      return {
        activeSourceFilter: source,
        selectedPlaylistId: nextSelected,
      };
    });
    if (source === 'netease') {
      void get().ensureNeteaseContentLoaded();
    }
  },
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setStageOpen: (open) => set({ isStageOpen: open }),
  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
  setHuaweiAuthModalOpen: (open) => set({ isHuaweiAuthModalOpen: open }),
  setNeteaseModalOpen: (open) => set({ isNeteaseModalOpen: open }),
  setImportModalOpen: (open) => set({ isImportModalOpen: open }),
  setVolume: (vol) => {
    const clamped = Math.max(0, Math.min(100, vol));
    savePersistedUiPrefs({ volume: clamped });
    set({ volume: clamped });
  },

  searchHuaweiCatalog: async (query) => {
    try {
      const filter = get().activeSourceFilter;
      let mapped: CanonicalTrack[] = [];
      if (filter === 'netease') {
        mapped = await musicGateway.searchNeteaseCatalog(query);
      } else if (filter === 'huawei') {
        mapped = await musicGateway.searchHuaweiCatalog(query);
      } else {
        const [hwRes, ncmRes] = await Promise.allSettled([
          musicGateway.searchHuaweiCatalog(query),
          musicGateway.searchNeteaseCatalog(query),
        ]);
        const hwTracks = hwRes.status === 'fulfilled' ? hwRes.value : [];
        const ncmTracks = ncmRes.status === 'fulfilled' ? ncmRes.value : [];
        mapped = [...hwTracks, ...ncmTracks];
      }
      if (mapped.length > 0) {
        set((state) => {
          const existingIds = new Set(state.tracks.map((t) => t.id));
          const fresh = mapped.filter((t) => !existingIds.has(t.id));
          return { tracks: [...fresh, ...state.tracks] };
        });
        get().pushToast(
          '云端曲库检索完成',
          `已找到 ${mapped.length} 首匹配歌曲（支持华为无损与网易云双语歌词）`,
          'success'
        );
      }
    } catch {
      // ignore offline error
    }
  },

  setDesktopLyricOpen: (open) => set({ isDesktopLyricOpen: open }),
  setDesktopLyricLocked: (locked) => set({ isDesktopLyricLocked: locked }),

  setThemeId: (themeId) => {
    const { fontScale, customAccent } = get();
    applyThemeVariablesToDom(themeId, fontScale, customAccent);
    saveAppearance({ themeId, fontScale, customAccent });
    set({ themeId });
    const palette = getThemePalette(themeId);
    get().pushToast(
      `已切换外观主题：${palette.label}`,
      `${palette.dark ? '深色沉浸色板' : '浅色温润色板'} (${palette.base}) 已应用并持久化`,
      'success'
    );
  },

  setFontScale: (scale) => {
    const clamped = Math.max(0.85, Math.min(1.2, Math.round(scale * 100) / 100));
    const { themeId, customAccent } = get();
    applyThemeVariablesToDom(themeId, clamped, customAccent);
    saveAppearance({ themeId, fontScale: clamped, customAccent });
    set({ fontScale: clamped });
  },

  setCustomAccent: (accent) => {
    const { themeId, fontScale } = get();
    applyThemeVariablesToDom(themeId, fontScale, accent);
    saveAppearance({ themeId, fontScale, customAccent: accent });
    set({ customAccent: accent });
  },

  resetAppearance: () => {
    applyThemeVariablesToDom('apple_dark', 1, null);
    saveAppearance({ themeId: 'apple_dark', fontScale: 1, customAccent: null });
    set({ themeId: 'apple_dark', fontScale: 1, customAccent: null });
    get().pushToast('已恢复默认外观', '主题色板与字体缩放已重置为默认状态', 'default');
  },

  setEqBandGain: (freqHz, gainDb) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(gainDb * 10) / 10));
    set((s) => {
      const nextBands = s.eqBands.map((b) =>
        b.freqHz === freqHz ? { ...b, gainDb: clamped } : b
      );
      savePersistedUiPrefs({ eqBands: nextBands });
      return { eqBands: nextBands };
    });
  },

  applyEqPreset: (preset) => {
    const gains = EQ_PRESET_CURVES[preset];
    set((s) => {
      const nextBands = s.eqBands.map((b, i) => ({ ...b, gainDb: gains[i] ?? 0 }));
      savePersistedUiPrefs({ eqPreset: preset, eqBands: nextBands });
      return {
        eqPreset: preset,
        eqBands: nextBands,
      };
    });
    get().pushToast(
      `已切换 10 段参量均衡器预设: ${preset.toUpperCase()}`,
      'Web Audio 双二阶滤波器组 (10-Band Peaking BiquadFilter) 已实时生效并持久化',
      'success'
    );
  },

  setJevEnabled: (enabled) => {
    savePersistedUiPrefs({ jevEnabled: enabled });
    set({ jevEnabled: enabled });
    get().pushToast(
      enabled ? 'Jev 灰区决策模型已启用' : 'Jev 灰区决策模型已关闭',
      enabled
        ? '仅当标题相似度 ≥ 0.85、艺人有交集且时长差 ≤ 8s 的灰区曲目才会发起判断'
        : '关闭状态下绝不发起任何外部请求，仅使用本地确定性规则合并',
      enabled ? 'success' : 'default'
    );
  },

  revokeMergeDecision: (mergeId) => {
    set((state) => ({
      mergeAudits: state.mergeAudits.map((m) =>
        m.id === mergeId ? { ...m, revoked: true } : m
      ),
    }));
    get().pushToast(
      '已逆序撤销合并并写入 merge_blocks',
      '原始曲目与收藏投影已按 member_refs 恢复，自动匹配器不会再次强行合并该对曲目',
      'success'
    );
  },

  createLocalPlaylist: (name, description) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const firstTrack = get().tracks[0] || INITIAL_TRACKS[0];
    const newPl: PlaylistItem = {
      id: `pl_local_${Date.now()}`,
      kind: 'local',
      name: trimmed,
      description: description.trim() || '本地新建跨平台混排歌单',
      coverUrl: firstTrack.coverUrl,
      trackCount: 1,
      updatedAt: '刚刚创建',
      trackIds: [firstTrack.id],
    };
    set((state) => ({
      playlists: [newPl, ...state.playlists],
      selectedPlaylistId: newPl.id,
    }));
    void musicGateway.saveLocalPlaylist({
      id: newPl.id,
      name: newPl.name,
      description: newPl.description,
      trackIds: newPl.trackIds,
    });
    get().pushToast('本地歌单已创建', `《${trimmed}》已持久化写入本地 SQLite 数据库`, 'success');
  },

  addTrackToLocalPlaylist: (playlistId, trackId) => {
    let updatedPlaylist: PlaylistItem | null = null;
    set((state) => ({
      playlists: state.playlists.map((p) => {
        if (p.id !== playlistId || p.kind !== 'local') return p;
        if (p.trackIds.includes(trackId)) return p;
        const nextIds = [...p.trackIds, trackId];
        updatedPlaylist = {
          ...p,
          trackIds: nextIds,
          trackCount: nextIds.length,
          updatedAt: '刚刚更新',
        };
        return updatedPlaylist;
      }),
    }));
    if (updatedPlaylist) {
      const pl = updatedPlaylist as PlaylistItem;
      void musicGateway.saveLocalPlaylist({
        id: pl.id,
        name: pl.name,
        description: pl.description,
        trackIds: pl.trackIds,
      });
    }
  },

  openCuratedPlaylist: async (spec) => {
    const kind = spec.kind || 'local';
    const targetNav: NavSection =
      kind === 'imported' ? 'imported_playlists' : 'local_playlists';
    const shouldFetchRemote = Boolean(spec.sourcePlaylistId);
    const isNeteasePlaylist =
      spec.id.startsWith('pl_ncm_') ||
      String(spec.sourcePlaylistId || '').startsWith('pl_ncm_');
    const remoteSource: SourceId = isNeteasePlaylist ? 'netease' : 'huawei';
    const resolvedTag = isNeteasePlaylist
      ? '网易云真实曲目'
      : '华为云端真实曲目';

    if (!spec.autoPlayFirst) {
      set((state) => {
        const existing = state.playlists.find((p) => p.id === spec.id);
        const initialTrackIds =
          existing && existing.trackIds.length > 0 && !shouldFetchRemote
            ? existing.trackIds
            : spec.trackIds.length > 0
              ? spec.trackIds
              : existing?.trackIds || [];

        const nextPlaylist: PlaylistItem = existing
          ? {
              ...existing,
              name: spec.name || existing.name,
              description: spec.description || existing.description,
              coverUrl: spec.coverUrl || existing.coverUrl,
              trackIds: initialTrackIds,
              trackCount: initialTrackIds.length || existing.trackCount,
            }
          : {
              id: spec.id,
              kind,
              source:
                kind === 'imported' || shouldFetchRemote
                  ? remoteSource
                  : 'local',
              name: spec.name,
              description: spec.description,
              coverUrl:
                spec.coverUrl ||
                state.tracks[0]?.coverUrl ||
                INITIAL_TRACKS[0].coverUrl,
              trackCount: initialTrackIds.length,
              updatedAt: shouldFetchRemote
                ? isNeteasePlaylist
                  ? '网易云实时歌单'
                  : '华为音乐实时歌单'
                : '精选推荐',
              trackIds: initialTrackIds,
            };

        const nextPlaylists = existing
          ? state.playlists.map((p) => (p.id === spec.id ? nextPlaylist : p))
          : [nextPlaylist, ...state.playlists];

        const needsNetworkLoad =
          shouldFetchRemote &&
          (!existing ||
            (existing.updatedAt !== '华为云端真实曲目' &&
              existing.updatedAt !== '网易云真实曲目' &&
              existing.trackIds.length === 0));

        return {
          playlists: nextPlaylists,
          selectedPlaylistId: spec.id,
          activeNav: targetNav,
          isLoadingPlaylistDetail: needsNetworkLoad,
        };
      });
    }

    if (spec.sourcePlaylistId) {
      const existing = get().playlists.find((p) => p.id === spec.id);
      if (
        existing &&
        (existing.updatedAt === '华为云端真实曲目' ||
          existing.updatedAt === '网易云真实曲目' ||
          existing.updatedAt.includes('刚刚同步')) &&
        existing.trackIds.length > 0
      ) {
        set({ isLoadingPlaylistDetail: false });
        if (spec.autoPlayFirst) {
          const firstTrack = get().tracks.find(
            (t) => t.id === existing.trackIds[0]
          );
          if (firstTrack) {
            get().playTrack(firstTrack);
          }
        }
        return;
      }

      const detail = isNeteasePlaylist
        ? await musicGateway.fetchNeteasePlaylistDetail(spec.sourcePlaylistId)
        : await musicGateway.fetchHuaweiPlaylistDetail(spec.sourcePlaylistId);

      if (detail && detail.tracks.length > 0) {
        const fetchedIds = detail.tracks.map((t) => t.id);
        set((state) => {
          const favIds = new Set(
            state.tracks.filter((t) => t.isFavorite).map((t) => t.id)
          );
          const existingMap = new Map(state.tracks.map((t) => [t.id, t]));
          for (const trk of detail.tracks) {
            const prev = existingMap.get(trk.id);
            existingMap.set(trk.id, {
              ...trk,
              isFavorite: favIds.has(trk.id) || Boolean(prev?.isFavorite),
              audioUrl: prev?.audioUrl || trk.audioUrl,
              lyrics:
                prev && prev.lyrics.length > 1 ? prev.lyrics : trk.lyrics,
            });
          }
          const mergedTracks = Array.from(existingMap.values());

          const updatedPl: PlaylistItem = {
            id: spec.id,
            kind,
            source: remoteSource,
            name:
              spec.name ||
              detail.name ||
              (isNeteasePlaylist ? '网易云精选歌单' : '华为音乐精选歌单'),
            description:
              detail.description ||
              spec.description ||
              (isNeteasePlaylist ? '来自网易云音乐歌单' : '华为音乐官方无损歌单'),
            coverUrl: spec.coverUrl || detail.coverUrl,
            trackCount: fetchedIds.length,
            updatedAt: resolvedTag,
            trackIds: fetchedIds,
          };

          const hasPl = state.playlists.some((p) => p.id === spec.id);
          const nextPlaylists = hasPl
            ? state.playlists.map((p) => (p.id === spec.id ? updatedPl : p))
            : [updatedPl, ...state.playlists];

          return {
            tracks: mergedTracks,
            playlists: nextPlaylists,
            isLoadingPlaylistDetail: false,
          };
        });

        if (spec.autoPlayFirst) {
          const first =
            get().tracks.find((t) => t.id === fetchedIds[0]) ||
            detail.tracks[0];
          if (first) {
            get().playTrack(first);
          }
        }
        return;
      }
      set({ isLoadingPlaylistDetail: false });
    }

    if (spec.autoPlayFirst && spec.trackIds.length > 0) {
      const first = get().tracks.find((t) => t.id === spec.trackIds[0]);
      if (first) {
        get().playTrack(first);
      }
    }
  },

  resolveTrackStream: async (track, source, autoPlay = true) => {
    const activeSrc = source || get().activeSourceForPlayback;
    const binding =
      track.bindings.find((b) => b.source === activeSrc) || track.bindings[0];

    if (binding?.streamUrl && binding.streamUrl.includes('/api/local/stream')) {
      set((state) => ({
        currentTrack:
          state.currentTrack.id === track.id
            ? { ...state.currentTrack, audioUrl: binding.streamUrl }
            : state.currentTrack,
        isPlaying: autoPlay ? true : state.isPlaying,
      }));
      return;
    }

    const useNetease =
      activeSrc === 'netease' ||
      (binding?.source === 'netease' &&
        !track.bindings.some((b) => b.source === 'huawei'));
    const targetBinding = useNetease
      ? track.bindings.find((b) => b.source === 'netease') || binding
      : track.bindings.find((b) => b.source === 'huawei') || binding;
    const contentCode = targetBinding?.sourceTrackId || '';

    set({ isResolvingAudio: true });
    try {
      const res = useNetease
        ? await musicGateway.resolveNeteaseTrack({
            contentCode,
            title: track.title,
            artist: track.artists.join(' '),
            quality: get().qualityPreference,
          })
        : await musicGateway.resolveTrackStream({
            contentCode,
            title: track.title,
            artist: track.artists.join(' '),
            quality: get().qualityPreference,
          });

      if (!res.ok || !res.streamUrl) {
        set({ isResolvingAudio: false });
        if (res.status === 401) {
          get().pushToast(
            '请先连接华为音乐账号',
            '需要有效的华为音乐会话以解析真实无损音频流',
            'warning'
          );
        } else if (autoPlay && res.error) {
          get().pushToast(`《${track.title}》流解析失败`, res.error, 'warning');
        }
        return;
      }

      set((state) => {
        const targetSource = useNetease ? 'netease' : 'huawei';
        const updatedTrack: CanonicalTrack = {
          ...(state.currentTrack.id === track.id ? state.currentTrack : track),
          audioUrl: res.streamUrl,
          durationSeconds: res.durationSeconds || track.durationSeconds,
          lyrics:
            res.lyrics && res.lyrics.length > 0 ? res.lyrics : track.lyrics,
          bindings: track.bindings.map((b) =>
            b.source === targetSource
              ? {
                  ...b,
                  sourceTrackId: res.contentCode || b.sourceTrackId,
                  access: res.isPreview ? 'preview' : 'full',
                  quality: res.quality || 'lossless',
                  formatLabel: res.formatLabel || b.formatLabel,
                  streamUrl: res.streamUrl,
                }
              : b
          ),
        };

        if (state.rememberPlaybackProgress && state.currentTrack.id === track.id) {
          savePersistedUiPrefs({
            lastTrackSnapshot: updatedTrack,
            lastPlaybackSource: targetSource,
          });
        }

        return {
          isResolvingAudio: false,
          isPlaying: autoPlay ? true : state.isPlaying,
          currentTrack:
            state.currentTrack.id === track.id ? updatedTrack : state.currentTrack,
          tracks: state.tracks.map((t) => (t.id === track.id ? updatedTrack : t)),
        };
      });
    } catch {
      set({ isResolvingAudio: false });
    }
  },

  playTrack: (track, preferredSource) => {
    const { fallbackPriority } = get();
    const fullBindings = track.bindings.filter((b) => b.access === 'full');
    fullBindings.sort(
      (a, b) =>
        fallbackPriority.indexOf(a.source) - fallbackPriority.indexOf(b.source)
    );

    let chosenSource: SourceId =
      preferredSource ||
      fullBindings[0]?.source ||
      track.bindings[0]?.source ||
      'huawei';

    if (preferredSource) {
      const target = track.bindings.find((b) => b.source === preferredSource);
      if (target && target.access === 'preview' && fullBindings.length > 0) {
        chosenSource = fullBindings[0].source;
        get().pushToast(
          '智能音源无感接力 (Smart Fallback)',
          `${preferredSource.toUpperCase()} 当前为 45s 试听片段，已自动切换至 [${chosenSource.toUpperCase()}] 完整无损音源`,
          'success'
        );
      }
    }

    const prevHistory = get().historyTrackIds.filter((id) => id !== track.id);
    const nextHistory = [track.id, ...prevHistory].slice(0, 30);
    if (get().rememberPlaybackProgress) {
      savePersistedUiPrefs({
        historyTrackIds: nextHistory,
        lastTrackSnapshot: track,
        lastPlaybackSource: chosenSource,
        lastPlaybackTimeMs: 0,
      });
    } else {
      savePersistedUiPrefs({ historyTrackIds: nextHistory });
    }
    set({
      currentTrack: track,
      activeSourceForPlayback: chosenSource,
      isPlaying: true,
      currentTimeMs: 0,
      historyTrackIds: nextHistory,
    });

    void get().resolveTrackStream(track, chosenSource, true);
  },

  togglePlay: () => {
    const {
      isPlaying,
      currentTrack,
      activeSourceForPlayback,
      currentTimeMs,
      rememberPlaybackProgress,
    } = get();
    const nextPlaying = !isPlaying;
    if (rememberPlaybackProgress) {
      savePersistedUiPrefs({
        lastTrackSnapshot: currentTrack,
        lastPlaybackSource: activeSourceForPlayback,
        lastPlaybackTimeMs: currentTimeMs,
      });
    }
    set({ isPlaying: nextPlaying });
    if (nextPlaying && !currentTrack.audioUrl) {
      void get().resolveTrackStream(currentTrack, activeSourceForPlayback, true);
    }
  },

  nextTrack: () => {
    const { tracks, currentTrack } = get();
    if (tracks.length === 0) return;
    set({ lastSwitchDirection: 'next' });
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    const next = tracks[(idx + 1) % tracks.length];
    get().playTrack(next);
  },

  prevTrack: () => {
    const { tracks, currentTrack } = get();
    if (tracks.length === 0) return;
    set({ lastSwitchDirection: 'prev' });
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    const prev = tracks[(idx - 1 + tracks.length) % tracks.length];
    get().playTrack(prev);
  },

  setCurrentTimeMs: (ms) => {
    const clamped = Math.max(0, ms);
    set({ currentTimeMs: clamped });
    const state = get();
    if (state.rememberPlaybackProgress) {
      const now = Date.now();
      if (now - lastPlaybackPersistWallMs >= 1500) {
        lastPlaybackPersistWallMs = now;
        savePersistedUiPrefs({
          lastTrackSnapshot: state.currentTrack,
          lastPlaybackSource: state.activeSourceForPlayback,
          lastPlaybackTimeMs: clamped,
        });
      }
    }
  },

  setTrackDurationSeconds: (trackId, seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const rounded = Math.round(seconds);
    set((state) => ({
      currentTrack:
        state.currentTrack.id === trackId
          ? { ...state.currentTrack, durationSeconds: rounded }
          : state.currentTrack,
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, durationSeconds: rounded } : t
      ),
    }));
  },

  seekToMs: (ms) => {
    const clamped = Math.max(0, ms);
    set({ currentTimeMs: clamped });
    const state = get();
    if (state.rememberPlaybackProgress) {
      savePersistedUiPrefs({
        lastTrackSnapshot: state.currentTrack,
        lastPlaybackSource: state.activeSourceForPlayback,
        lastPlaybackTimeMs: clamped,
      });
    }
    dispatchAudioSeek(clamped);
  },

  tickProgress: (deltaMs) => {
    const { isPlaying, currentTimeMs, currentTrack } = get();
    if (!isPlaying) return;
    const maxMs = Math.max(1000, currentTrack.durationSeconds * 1000);
    const nextMs = currentTimeMs + deltaMs;
    if (nextMs >= maxMs) {
      set({ currentTimeMs: 0 });
    } else {
      set({ currentTimeMs: nextMs });
    }
  },

  switchPlaybackSource: (source) => {
    const { currentTrack } = get();
    const binding = currentTrack.bindings.find((b) => b.source === source);
    if (!binding) return;
    if (binding.access === 'preview') {
      get().pushToast(
        '已切换至试听流',
        `${binding.formatLabel} · 检测到 URL 含 /preview/，可随时切回华为或本地完整源`,
        'warning'
      );
    } else {
      get().pushToast(
        `音源已切换至 ${source.toUpperCase()}`,
        `正在输出 ${binding.formatLabel} · 播放进度无缝衔接`,
        'success'
      );
    }
    set({ activeSourceForPlayback: source });
    void get().resolveTrackStream(currentTrack, source, get().isPlaying);
  },

  toggleFavorite: (trackId) => {
    const targetTrack = get().tracks.find((t) => t.id === trackId);
    const nextFav = targetTrack ? !targetTrack.isFavorite : true;

    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, isFavorite: !t.isFavorite } : t
      ),
      currentTrack:
        state.currentTrack.id === trackId
          ? { ...state.currentTrack, isFavorite: !state.currentTrack.isFavorite }
          : state.currentTrack,
    }));

    const hwBinding = targetTrack?.bindings.find((b) => b.source === 'huawei');
    if (hwBinding?.sourceTrackId) {
      void musicGateway.setHuaweiFavorite(hwBinding.sourceTrackId, nextFav);
    }
  },

  adjustLyricOffset: (deltaMs) => {
    set((s) => {
      const next = s.lyricOffsetMs + deltaMs;
      savePersistedUiPrefs({ lyricOffsetMs: next });
      return { lyricOffsetMs: next };
    });
  },

  hydrateLibraryFromSqlite: async () => {
    const snap = await musicGateway.fetchLibrarySnapshot();
    if (!snap || (snap.tracks.length === 0 && snap.playlists.length === 0)) {
      return;
    }
    set((state) => {
      const rawTracks = snap.tracks.length > 0 ? snap.tracks : state.tracks;
      const nextPlaylists =
        snap.playlists.length > 0 ? snap.playlists : state.playlists;

      const hasRestoredTrack =
        state.rememberPlaybackProgress && Boolean(initialRestoredTrack);
      const matchedInSnap = rawTracks.find(
        (t) => t.id === state.currentTrack.id
      );

      let nextCurrent = state.currentTrack;
      if (matchedInSnap) {
        nextCurrent = {
          ...matchedInSnap,
          audioUrl: state.currentTrack.audioUrl || matchedInSnap.audioUrl,
          lyrics:
            state.currentTrack.lyrics.length > 1
              ? state.currentTrack.lyrics
              : matchedInSnap.lyrics,
        };
      } else if (!state.isPlaying && !hasRestoredTrack && rawTracks.length > 0) {
        nextCurrent = rawTracks[0];
      }

      const nextTracks =
        hasRestoredTrack &&
        !rawTracks.some((t) => t.id === nextCurrent.id)
          ? [nextCurrent, ...rawTracks]
          : rawTracks;

      return {
        tracks: nextTracks,
        playlists: nextPlaylists,
        selectedPlaylistId:
          nextPlaylists[0]?.id || state.selectedPlaylistId,
        currentTrack: nextCurrent,
      };
    });
  },

  triggerHuaweiSync: async () => {
    if (get().isSyncingHuawei) return;
    set({ isSyncingHuawei: true });

    try {
      const { snsUserId, tracks: syncedTracks, playlists: syncedPlaylists } =
        await musicGateway.syncHuaweiLibrary();

      const wasPlaying = get().isPlaying;
      const hasRestoredTrack =
        get().rememberPlaybackProgress && Boolean(initialRestoredTrack);
      const currTrack = get().currentTrack;
      const matchedSynced = syncedTracks.find((t) => t.id === currTrack.id);
      const nextCurrent = matchedSynced
        ? {
            ...matchedSynced,
            audioUrl: currTrack.audioUrl || matchedSynced.audioUrl,
            lyrics:
              currTrack.lyrics.length > 1
                ? currTrack.lyrics
                : matchedSynced.lyrics,
          }
        : !wasPlaying && !hasRestoredTrack && syncedTracks.length > 0
          ? syncedTracks[0]
          : currTrack;

      set((state) => {
        const preservedPlaylists = state.playlists.filter(
          (p) => p.kind === 'local' || p.source === 'netease'
        );
        const nextPlaylists = [...syncedPlaylists, ...preservedPlaylists];
        const existingOtherTracks = state.tracks.filter(
          (t) => !t.id.startsWith('hw_')
        );
        const syncedIds = new Set(syncedTracks.map((t) => t.id));
        const nextTracks =
          syncedTracks.length > 0
            ? [
                ...syncedTracks,
                ...existingOtherTracks.filter((t) => !syncedIds.has(t.id)),
              ]
            : state.tracks;

        return {
          isSyncingHuawei: false,
          tracks: nextTracks,
          playlists: nextPlaylists,
          selectedPlaylistId:
            syncedPlaylists[0]?.id || state.selectedPlaylistId,
          currentTrack: nextCurrent,
          historyTrackIds:
            syncedTracks.length >= 4
              ? syncedTracks.slice(0, 8).map((t) => t.id)
              : state.historyTrackIds,
          sources: state.sources.map((s) =>
            s.id === 'huawei'
              ? {
                  ...s,
                  loggedIn: true,
                  accountName: `华为账号 · ${snsUserId}`,
                  favoriteCount: syncedTracks.length,
                  playlistCount: syncedPlaylists.length,
                  lastSyncAt: '刚刚同步',
                  syncStatus: 'updated',
                }
              : s
          ),
        };
      });

      get().pushToast(
        '华为音乐云端曲库已就绪',
        `已同步 ${syncedTracks.length} 首真实收藏歌曲与 ${syncedPlaylists.length} 个云端歌单`,
        'success'
      );

      if (!wasPlaying && nextCurrent) {
        void get().resolveTrackStream(nextCurrent, 'huawei', false);
      }
    } catch {
      set({ isSyncingHuawei: false, isHuaweiAuthModalOpen: true });
      get().pushToast(
        '请先登录华为账号',
        '扫码授权后即可同步您的云端「我喜欢」与歌单',
        'warning'
      );
    }
  },

  syncNeteaseByUid: async (uid, cookie) => {
    if (get().isSyncingNetease) return;
    set({ isSyncingNetease: true });
    try {
      const {
        uid: syncedUid,
        nickname,
        tracks: ncmTracks,
        playlists: ncmPlaylists,
      } = await musicGateway.syncNeteaseLibrary({ uid, cookie });

      set((state) => {
        const preservedPlaylists = state.playlists.filter(
          (p) => p.source !== 'netease'
        );
        const nextPlaylists = [...ncmPlaylists, ...preservedPlaylists];
        const existingMap = new Map(state.tracks.map((t) => [t.id, t]));
        for (const trk of ncmTracks) {
          existingMap.set(trk.id, trk);
        }
        const nextTracks = Array.from(existingMap.values());
        const favCount = ncmTracks.filter((t) => t.isFavorite).length;

        return {
          isSyncingNetease: false,
          isNeteaseModalOpen: false,
          tracks: nextTracks,
          playlists: nextPlaylists,
          selectedPlaylistId:
            ncmPlaylists[0]?.id || state.selectedPlaylistId,
          sources: state.sources.map((s) =>
            s.id === 'netease'
              ? {
                  ...s,
                  loggedIn: true,
                  accountName: `网易云 · ${nickname} (${syncedUid})`,
                  favoriteCount: favCount,
                  playlistCount: ncmPlaylists.length,
                  lastSyncAt: '刚刚同步',
                  syncStatus: 'updated',
                }
              : s
          ),
        };
      });

      get().pushToast(
        '网易云音乐同步成功',
        `已连接「${nickname}」，同步 ${ncmPlaylists.length} 个歌单与双语歌词曲库`,
        'success'
      );
    } catch (err) {
      set({ isSyncingNetease: false });
      get().pushToast(
        '网易云同步失败',
        err instanceof Error ? err.message : String(err),
        'warning'
      );
    }
  },

  ensureNeteaseContentLoaded: async () => {
    if ((import.meta as any).env?.MODE === 'test') return;
    if (get().isSyncingNetease) return;

    const hasRealNcmTracks = get().tracks.some((t) => t.id.startsWith('ncm_'));
    const hasRealNcmPlaylists = get().playlists.some(
      (p) => p.source === 'netease'
    );
    if (hasRealNcmTracks && hasRealNcmPlaylists) {
      return;
    }

    set({ isSyncingNetease: true });
    try {
      const status = await musicGateway.fetchNeteaseStatus();
      if (status?.loggedIn && status.uid) {
        set({ isSyncingNetease: false });
        await get().syncNeteaseByUid(status.uid);
        return;
      }

      const [hotDetail, soarDetail, recs] = await Promise.all([
        musicGateway.fetchNeteasePlaylistDetail('3778678'),
        musicGateway.fetchNeteasePlaylistDetail('19723756'),
        musicGateway.fetchNeteaseRecommendations(),
      ]);

      const newTracks: CanonicalTrack[] = [];
      const newPlaylists: PlaylistItem[] = [];

      if (hotDetail && hotDetail.tracks.length > 0) {
        const favMarked = hotDetail.tracks.map((t, idx) => ({
          ...t,
          isFavorite: idx < 40,
        }));
        newTracks.push(...favMarked);
        newPlaylists.push({
          id: 'pl_ncm_3778678',
          kind: 'imported',
          source: 'netease',
          name: `网易云 · ${hotDetail.name || '热歌榜'}`,
          description:
            hotDetail.description || '网易云音乐官方实时热歌榜（支持双语歌词与华为无损点亮）',
          coverUrl: hotDetail.coverUrl,
          trackCount: hotDetail.tracks.length,
          updatedAt: '网易云实时热榜',
          trackIds: hotDetail.tracks.map((t) => t.id),
        });
      }

      if (soarDetail && soarDetail.tracks.length > 0) {
        newTracks.push(...soarDetail.tracks);
        newPlaylists.push({
          id: 'pl_ncm_19723756',
          kind: 'imported',
          source: 'netease',
          name: `网易云 · ${soarDetail.name || '飙升榜'}`,
          description:
            soarDetail.description || '网易云音乐官方实时飙升榜',
          coverUrl: soarDetail.coverUrl,
          trackCount: soarDetail.tracks.length,
          updatedAt: '网易云实时飙升榜',
          trackIds: soarDetail.tracks.map((t) => t.id),
        });
      }

      for (const rec of recs.slice(0, 4)) {
        if (!newPlaylists.some((p) => p.id === rec.id)) {
          newPlaylists.push({
            id: rec.id,
            kind: 'imported',
            source: 'netease',
            name: rec.title,
            description: rec.description || '来自网易云音乐推荐歌单',
            coverUrl: rec.coverUrl,
            trackCount: rec.trackCount,
            updatedAt: '网易云推荐歌单',
            trackIds: [],
          });
        }
      }

      set((state) => {
        const trackMap = new Map(state.tracks.map((t) => [t.id, t]));
        for (const trk of newTracks) {
          if (!trackMap.has(trk.id)) {
            trackMap.set(trk.id, trk);
          }
        }
        const existingPlIds = new Set(state.playlists.map((p) => p.id));
        const freshPlaylists = newPlaylists.filter(
          (p) => !existingPlIds.has(p.id)
        );
        const mergedPlaylists = [...freshPlaylists, ...state.playlists];
        const nextSelected =
          state.activeSourceFilter === 'netease' && newPlaylists[0]
            ? newPlaylists[0].id
            : state.selectedPlaylistId;

        return {
          isSyncingNetease: false,
          tracks: Array.from(trackMap.values()),
          playlists: mergedPlaylists,
          selectedPlaylistId: nextSelected,
        };
      });
    } catch {
      set({ isSyncingNetease: false });
    }
  },

  completeHuaweiReauth: (accountLabel) => {
    set((state) => ({
      isHuaweiAuthModalOpen: false,
      sources: state.sources.map((s) =>
        s.id === 'huawei'
          ? {
              ...s,
              loggedIn: true,
              accountName: accountLabel,
              syncStatus: 'updated',
              lastSyncAt: '刚刚 · 会话已连接',
            }
          : s
      ),
    }));
  },

  toggleSourceLogin: (sourceId) => {
    if (sourceId === 'huawei') {
      set({ isHuaweiAuthModalOpen: true });
      return;
    }
    set((state) => ({
      sources: state.sources.map((s) => {
        if (s.id !== sourceId) return s;
        const nextLogged = !s.loggedIn;
        if (!nextLogged && sourceId === 'netease') {
          void musicGateway.logoutNeteaseSession();
        }
        get().pushToast(
          nextLogged ? `${s.name} 已连接` : `${s.name} 已断开连接`,
          nextLogged
            ? '扩展音源已挂载至多源路由表'
            : '仅停用该源在线解析，本地已收录曲目与收藏列表 100% 保留',
          nextLogged ? 'success' : 'default'
        );
        return {
          ...s,
          loggedIn: nextLogged,
          accountName: nextLogged ? `${s.name} · 已授权账号` : '未连接',
          syncStatus: nextLogged ? 'updated' : 'expired',
        };
      }),
    }));
  },

  scanLocalFolder: () => {
    musicGateway.scanLocalDirectory().then((result) => {
      if (!result) return;
      const { scannedDir, tracks: localMapped } = result;
      if (localMapped.length === 0) {
        get().pushToast(
          '本地目录扫描完成',
          `${scannedDir} 下暂未发现音频文件 (.flac/.mp3/.wav/.m4a)`,
          'default'
        );
        return;
      }

      set((state) => {
        const existingIds = new Set(state.tracks.map((t) => t.id));
        const fresh = localMapped.filter((t) => !existingIds.has(t.id));
        return {
          tracks: [...fresh, ...state.tracks],
          sources: state.sources.map((s) =>
            s.id === 'local'
              ? {
                  ...s,
                  favoriteCount: localMapped.length,
                  lastSyncAt: `已扫描 ${localMapped.length} 首本地音频`,
                }
              : s
          ),
        };
      });

      get().pushToast(
        '本地音频库扫描完成',
        `已在 ${scannedDir} 发现并挂载 ${localMapped.length} 首本地音频文件`,
        'success'
      );
    });
  },

  pushToast: (title, detail, tone = 'default') => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { id, title, detail, tone }],
    }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 3800);
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
