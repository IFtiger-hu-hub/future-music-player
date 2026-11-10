import { invoke } from '@tauri-apps/api/core';
import { CanonicalTrack, LyricLine, PlaylistItem } from '../types/music';
import { INITIAL_TRACKS } from '../data/mockMusicData';

const DEFAULT_HUAWEI_COVER =
  'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_cover_100_1/93/v3/xM5ysS7yTcGMEt_KCRzMag/59b7193a-9f7e-4950-a6c5-ff658092a18c.jpg/music_cover_300x300.webp';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function apiUrl(path: string): string {
  if (typeof window !== 'undefined' && window.location.port === '1420') {
    return path;
  }
  return `http://127.0.0.1:19420${path}`;
}

export interface HuaweiSessionStatus {
  loggedIn: boolean;
  snsUserID?: string;
  snsUserId?: string;
  expireTime?: string;
}

export interface NeteaseSessionStatus {
  loggedIn: boolean;
  uid?: string;
  nickname?: string;
  avatarUrl?: string;
  hasCookie?: boolean;
}

export interface SyncedNeteaseLibrary {
  uid: string;
  nickname: string;
  avatarUrl?: string;
  tracks: CanonicalTrack[];
  playlists: PlaylistItem[];
}

export interface ResolvedStreamResult {
  ok: boolean;
  status: number;
  error?: string;
  contentCode?: string;
  streamUrl?: string;
  quality?: 'lossless' | 'hires' | 'standard';
  formatLabel?: string;
  isPreview?: boolean;
  durationSeconds?: number;
  lyrics?: LyricLine[];
}

export interface SyncedHuaweiLibrary {
  snsUserId: string;
  tracks: CanonicalTrack[];
  playlists: PlaylistItem[];
}

export interface LocalScanResult {
  ok: boolean;
  scannedDir: string;
  tracks: CanonicalTrack[];
}

export interface HuaweiRecommendedPlaylistCard {
  id: string;
  sourcePlaylistId: string;
  title: string;
  description: string;
  coverUrl: string;
  trackCount: number;
  playCount: string;
}

export interface HuaweiPlaylistDetailResult {
  ok: boolean;
  playlistId: string;
  sourcePlaylistId: string;
  name: string;
  description: string;
  coverUrl: string;
  tracks: CanonicalTrack[];
}

function mapRawTracks(rawTracks: any[]): CanonicalTrack[] {
  return (rawTracks || []).map((t: any): CanonicalTrack => {
    const isLocal = t.source === 'local';
    const isNetease =
      t.source === 'netease' || String(t.id || '').startsWith('ncm_');
    const source = isLocal ? 'local' : isNetease ? 'netease' : 'huawei';

    return {
      id: t.id,
      title: t.title,
      artists: t.artists || ['未知艺人'],
      album:
        t.album ||
        (isLocal ? '本地无损专辑' : isNetease ? '网易云音乐' : '华为音乐'),
      durationSeconds: t.durationSeconds || 225,
      coverUrl: t.coverUrl || DEFAULT_HUAWEI_COVER,
      dominantColors: isLocal
        ? ['#065F46', '#18181B', '#09090B']
        : isNetease
          ? ['#7F1D1D', '#18181B', '#09090B']
          : ['#4C1D24', '#18181B', '#09090B'],
      isFavorite: t.isFavorite !== undefined ? Boolean(t.isFavorite) : true,
      audioUrl: t.streamUrl || undefined,
      bindings: [
        {
          source,
          sourceTrackId: t.sourceTrackId,
          access: 'full',
          quality: isLocal ? 'hires' : isNetease ? 'standard' : 'lossless',
          formatLabel: isLocal
            ? '本地 FLAC'
            : isNetease
              ? t.isVip
                ? 'VIP 自动无损点亮'
                : '网易云 320k'
              : '无损 FLAC',
          streamUrl: t.streamUrl || undefined,
        },
      ],
      lyrics: [
        {
          timeMs: 0,
          endMs: 12000,
          text: `${t.title} — ${t.artists?.join(' / ')}`,
          translation: isLocal
            ? `本地音频文件 · ${t.sourceTrackId}`
            : isNetease
              ? '正在加载网易云双语 / 逐字 YRC 歌词...'
              : '正在加载华为音乐逐字 HMRC / LRC 歌词...',
        },
      ],
    };
  });
}

/**
 * Music Gateway Service
 * Uses native Tauri IPC (`invoke`) when inside the packaged desktop app,
 * and `/api/...` HTTP bridge when running in `pnpm dev` browser mode.
 */
export const musicGateway = {
  async fetchHuaweiStatus(): Promise<HuaweiSessionStatus | null> {
    if (isTauriRuntime()) {
      try {
        return await invoke<HuaweiSessionStatus>('get_huawei_status');
      } catch {
        // fallback to HTTP below
      }
    }
    try {
      const res = await fetch(apiUrl('/api/huawei/status'));
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return null;
  },

  async searchHuaweiCatalog(query: string): Promise<CanonicalTrack[]> {
    const q = query.trim();
    if (!q) return [];

    let data: any = null;
    if (isTauriRuntime()) {
      try {
        data = await invoke('search_huawei_catalog', { query: q });
      } catch {
        data = null;
      }
    }
    if (!data) {
      const res = await fetch(apiUrl('/api/huawei/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) return [];
      data = await res.json();
    }

    if (!Array.isArray(data?.tracks)) return [];
    return mapRawTracks(data.tracks).map((t) => ({ ...t, isFavorite: false }));
  },

  async fetchHuaweiRecommendations(
    query = '华语精选'
  ): Promise<HuaweiRecommendedPlaylistCard[]> {
    try {
      let data: any = null;
      if (isTauriRuntime()) {
        try {
          data = await invoke('fetch_huawei_recommendations', { query });
        } catch {
          data = null;
        }
      }
      if (!data) {
        const res = await fetch(apiUrl('/api/huawei/recommendations'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        if (res.ok) {
          data = await res.json();
        }
      }
      if (!Array.isArray(data?.playlists)) return [];
      return data.playlists.map(
        (p: any): HuaweiRecommendedPlaylistCard => ({
          id: p.id || `pl_hw_${p.sourcePlaylistId}`,
          sourcePlaylistId: p.sourcePlaylistId || p.id,
          title: p.title || p.name || '华为音乐精选歌单',
          description: p.description || '来自华为音乐官方曲库',
          coverUrl: p.coverUrl || DEFAULT_HUAWEI_COVER,
          trackCount: Number(p.trackCount) || 30,
          playCount: p.playCount || '热门',
        })
      );
    } catch {
      return [];
    }
  },

  async fetchHuaweiPlaylistDetail(
    playlistId: string
  ): Promise<HuaweiPlaylistDetailResult | null> {
    if (!playlistId) return null;
    try {
      let data: any = null;
      if (isTauriRuntime()) {
        try {
          data = await invoke('fetch_huawei_playlist_detail', { playlistId });
        } catch {
          data = null;
        }
      }
      if (!data) {
        const res = await fetch(apiUrl('/api/huawei/playlist/detail'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistId }),
        });
        if (res.ok) {
          data = await res.json();
        }
      }
      if (!data?.ok || !Array.isArray(data.tracks)) return null;
      const tracks = mapRawTracks(data.tracks).map((t) => ({
        ...t,
        isFavorite: false,
      }));
      return {
        ok: true,
        playlistId: data.playlistId || `pl_hw_${playlistId}`,
        sourcePlaylistId: data.sourcePlaylistId || playlistId,
        name: data.name || '',
        description: data.description || '',
        coverUrl: data.coverUrl || tracks[0]?.coverUrl || DEFAULT_HUAWEI_COVER,
        tracks,
      };
    } catch {
      return null;
    }
  },

  async resolveTrackStream(params: {
    contentCode: string;
    title: string;
    artist: string;
    quality: 'lossless' | 'hires' | 'standard';
  }): Promise<ResolvedStreamResult> {
    if (isTauriRuntime()) {
      try {
        const res = await invoke<any>('resolve_huawei_track', { params });
        return {
          ok: Boolean(res?.ok && res.streamUrl),
          status: 200,
          contentCode: res.contentCode,
          streamUrl: res.streamUrl,
          quality: res.quality === 'lossless' ? 'lossless' : 'standard',
          formatLabel: res.formatLabel,
          isPreview: Boolean(res.isPreview),
          durationSeconds: res.durationSeconds,
          lyrics: Array.isArray(res.lyrics) ? res.lyrics : undefined,
        };
      } catch (err) {
        const msg = String(err || '当前曲目暂无可播音源');
        return {
          ok: false,
          status: msg.includes('尚未登录') ? 401 : 404,
          error: msg,
        };
      }
    }

    const resp = await fetch(apiUrl('/api/huawei/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      return {
        ok: false,
        status: resp.status,
        error: errData.error || '当前曲目暂无可播音源',
      };
    }

    const res = await resp.json();
    return {
      ok: Boolean(res?.ok && res.streamUrl),
      status: 200,
      contentCode: res.contentCode,
      streamUrl: res.streamUrl,
      quality: res.quality === 'lossless' ? 'lossless' : 'standard',
      formatLabel: res.formatLabel,
      isPreview: Boolean(res.isPreview),
      durationSeconds: res.durationSeconds,
      lyrics: Array.isArray(res.lyrics) ? res.lyrics : undefined,
    };
  },

  async syncHuaweiLibrary(): Promise<SyncedHuaweiLibrary> {
    let data: any = null;
    if (isTauriRuntime()) {
      data = await invoke<any>('sync_huawei_library');
    } else {
      const res = await fetch(apiUrl('/api/huawei/sync'), { method: 'POST' });
      if (!res.ok) throw new Error('Bridge sync not authenticated');
      data = await res.json();
    }

    if (!data?.ok) throw new Error('Bridge sync failed');

    const tracks = mapRawTracks(data.tracks || []);
    const playlists: PlaylistItem[] = (data.playlists || []).map(
      (p: any): PlaylistItem => ({
        id: p.id,
        kind: 'imported',
        source: 'huawei',
        name: p.name,
        description: p.description || '来自华为音乐账号云端歌单',
        coverUrl: p.coverUrl || tracks[0]?.coverUrl || INITIAL_TRACKS[0].coverUrl,
        trackCount: p.trackCount || p.trackIds?.length || 0,
        updatedAt: '刚刚同步',
        trackIds:
          Array.isArray(p.trackIds) && p.trackIds.length > 0
            ? p.trackIds
            : tracks.slice(0, 30).map((t) => t.id),
      })
    );

    return {
      snsUserId: data.snsUserID || data.snsUserId || '华为用户',
      tracks,
      playlists,
    };
  },

  async setHuaweiFavorite(contentCode: string, favorite: boolean): Promise<void> {
    if (!contentCode) return;
    await fetch(apiUrl('/api/huawei/favorite'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentCode, favorite }),
    }).catch(() => {});
  },

  async scanLocalDirectory(): Promise<LocalScanResult | null> {
    try {
      const res = await fetch(apiUrl('/api/local/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.ok) return null;

      const tracks: CanonicalTrack[] = (data.tracks || []).map(
        (item: any): CanonicalTrack => ({
          id: item.id,
          title: item.title,
          artists: item.artists || ['本地音乐人'],
          album: item.album || '本地无损专辑',
          durationSeconds: item.durationSeconds || 240,
          coverUrl: INITIAL_TRACKS[0].coverUrl,
          dominantColors: ['#065F46', '#18181B', '#09090B'],
          isFavorite: true,
          audioUrl: item.streamUrl,
          bindings: [
            {
              source: 'local',
              sourceTrackId: item.sourceTrackId,
              access: 'full',
              quality: item.quality || 'hires',
              formatLabel: item.formatLabel || '本地 FLAC',
              streamUrl: item.streamUrl,
            },
          ],
          lyrics: [
            {
              timeMs: 0,
              endMs: 12000,
              text: `${item.title} — ${item.artists?.join(' / ')}`,
              translation: `本地音频文件 · ${item.sourceTrackId}`,
            },
          ],
        })
      );

      return {
        ok: true,
        scannedDir: data.scannedDir || '~/Music',
        tracks,
      };
    } catch {
      return null;
    }
  },

  async fetchLibrarySnapshot(): Promise<{
    tracks: CanonicalTrack[];
    playlists: PlaylistItem[];
  } | null> {
    try {
      let data: any = null;
      if (isTauriRuntime()) {
        try {
          data = await invoke<any>('get_library_snapshot');
        } catch {
          data = null;
        }
      }
      if (!data) {
        const res = await fetch(apiUrl('/api/library/snapshot'));
        if (res.ok) {
          data = await res.json();
        }
      }
      if (!data?.ok) return null;

      const tracks = mapRawTracks(data.tracks || []);
      const playlists: PlaylistItem[] = (data.playlists || []).map(
        (p: any): PlaylistItem => ({
          id: p.id,
          kind: p.kind === 'local' ? 'local' : 'imported',
          source:
            p.source === 'local'
              ? 'local'
              : p.source === 'netease'
                ? 'netease'
                : 'huawei',
          name: p.name,
          description: p.description || '本地持久化歌单',
          coverUrl: p.coverUrl || tracks[0]?.coverUrl || INITIAL_TRACKS[0].coverUrl,
          trackCount: p.trackCount ?? (p.trackIds?.length || 0),
          updatedAt: p.updatedAt || '本地数据库',
          trackIds: Array.isArray(p.trackIds) ? p.trackIds : [],
        })
      );
      return { tracks, playlists };
    } catch {
      return null;
    }
  },

  async fetchNeteaseStatus(): Promise<NeteaseSessionStatus | null> {
    if (isTauriRuntime()) {
      try {
        return await invoke<NeteaseSessionStatus>('get_netease_status');
      } catch {
        // fallback to HTTP below
      }
    }
    try {
      const res = await fetch(apiUrl('/api/netease/status'));
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return null;
  },

  async syncNeteaseLibrary(params: {
    uid?: string;
    cookie?: string;
  }): Promise<SyncedNeteaseLibrary> {
    let data: any = null;
    if (isTauriRuntime()) {
      data = await invoke<any>('sync_netease_library', { params });
    } else {
      const res = await fetch(apiUrl('/api/netease/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || '网易云歌单同步失败');
      }
      data = json;
    }

    if (!data?.ok) {
      throw new Error(data?.error || '网易云歌单同步失败');
    }

    const favTracks = mapRawTracks(data.tracks || []);
    const allTrackMap = new Map<string, CanonicalTrack>();
    for (const t of favTracks) {
      allTrackMap.set(t.id, t);
    }

    const playlists: PlaylistItem[] = (data.playlists || []).map(
      (p: any): PlaylistItem => {
        if (Array.isArray(p.tracks)) {
          for (const mapped of mapRawTracks(p.tracks)) {
            if (!allTrackMap.has(mapped.id)) {
              allTrackMap.set(mapped.id, { ...mapped, isFavorite: false });
            }
          }
        }
        return {
          id: p.id,
          kind: 'imported',
          source: 'netease',
          name: p.name,
          description: p.description || '来自网易云音乐账号歌单',
          coverUrl:
            p.coverUrl || favTracks[0]?.coverUrl || INITIAL_TRACKS[0].coverUrl,
          trackCount: p.trackCount || p.trackIds?.length || 0,
          updatedAt: '刚刚同步 · 网易云',
          trackIds: Array.isArray(p.trackIds) ? p.trackIds : [],
        };
      }
    );

    return {
      uid: data.uid,
      nickname: data.nickname || `UID ${data.uid}`,
      avatarUrl: data.avatarUrl,
      tracks: Array.from(allTrackMap.values()),
      playlists,
    };
  },

  async logoutNeteaseSession(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke('logout_netease_session');
        return;
      } catch {
        // fallback below
      }
    }
    await fetch(apiUrl('/api/netease/logout'), { method: 'POST' }).catch(() => {});
  },

  async searchNeteaseCatalog(query: string): Promise<CanonicalTrack[]> {
    const q = query.trim();
    if (!q) return [];
    let data: any = null;
    if (isTauriRuntime()) {
      try {
        data = await invoke('search_netease_catalog', { query: q });
      } catch {
        data = null;
      }
    }
    if (!data) {
      const res = await fetch(apiUrl('/api/netease/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) return [];
      data = await res.json();
    }
    if (!Array.isArray(data?.tracks)) return [];
    return mapRawTracks(data.tracks).map((t) => ({ ...t, isFavorite: false }));
  },

  async fetchNeteaseRecommendations(): Promise<HuaweiRecommendedPlaylistCard[]> {
    try {
      let data: any = null;
      if (isTauriRuntime()) {
        try {
          data = await invoke('fetch_netease_recommendations');
        } catch {
          data = null;
        }
      }
      if (!data) {
        const res = await fetch(apiUrl('/api/netease/recommendations'), {
          method: 'POST',
        });
        if (res.ok) {
          data = await res.json();
        }
      }
      if (!Array.isArray(data?.playlists)) return [];
      return data.playlists.map(
        (p: any): HuaweiRecommendedPlaylistCard => ({
          id: p.id || `pl_ncm_${p.sourcePlaylistId}`,
          sourcePlaylistId: p.sourcePlaylistId || p.id,
          title: p.title || p.name || '网易云音乐精选歌单',
          description: p.description || '来自网易云音乐推荐歌单',
          coverUrl: p.coverUrl || DEFAULT_HUAWEI_COVER,
          trackCount: Number(p.trackCount) || 30,
          playCount: p.playCount || '热门',
        })
      );
    } catch {
      return [];
    }
  },

  async fetchNeteasePlaylistDetail(
    playlistId: string
  ): Promise<HuaweiPlaylistDetailResult | null> {
    if (!playlistId) return null;
    try {
      let data: any = null;
      if (isTauriRuntime()) {
        try {
          data = await invoke('fetch_netease_playlist_detail', { playlistId });
        } catch {
          data = null;
        }
      }
      if (!data) {
        const res = await fetch(apiUrl('/api/netease/playlist/detail'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistId }),
        });
        if (res.ok) {
          data = await res.json();
        }
      }
      if (!data?.ok || !Array.isArray(data.tracks)) return null;
      const tracks = mapRawTracks(data.tracks).map((t) => ({
        ...t,
        isFavorite: false,
      }));
      return {
        ok: true,
        playlistId: data.playlistId || `pl_ncm_${playlistId}`,
        sourcePlaylistId: data.sourcePlaylistId || playlistId,
        name: data.name || '网易云歌单',
        description: data.description || '来自网易云音乐歌单',
        coverUrl: data.coverUrl || tracks[0]?.coverUrl || DEFAULT_HUAWEI_COVER,
        tracks,
      };
    } catch {
      return null;
    }
  },

  async resolveNeteaseTrack(params: {
    contentCode: string;
    title: string;
    artist: string;
    quality: 'lossless' | 'hires' | 'standard';
  }): Promise<ResolvedStreamResult> {
    if (isTauriRuntime()) {
      try {
        const res = await invoke<any>('resolve_netease_track', { params });
        return {
          ok: Boolean(res?.ok && res.streamUrl),
          status: 200,
          contentCode: res.contentCode,
          streamUrl: res.streamUrl,
          quality: res.quality === 'lossless' ? 'lossless' : 'standard',
          formatLabel: res.formatLabel,
          isPreview: Boolean(res.isPreview),
          durationSeconds: res.durationSeconds,
          lyrics: Array.isArray(res.lyrics) ? res.lyrics : undefined,
        };
      } catch (err) {
        return {
          ok: false,
          status: 404,
          error: String(err || '当前网易云曲目暂无可播音源'),
        };
      }
    }

    const resp = await fetch(apiUrl('/api/netease/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      return {
        ok: false,
        status: resp.status,
        error: errData.error || '当前网易云曲目暂无可播音源',
      };
    }
    const res = await resp.json();
    return {
      ok: Boolean(res?.ok && res.streamUrl),
      status: 200,
      contentCode: res.contentCode,
      streamUrl: res.streamUrl,
      quality: res.quality === 'lossless' ? 'lossless' : 'standard',
      formatLabel: res.formatLabel,
      isPreview: Boolean(res.isPreview),
      durationSeconds: res.durationSeconds,
      lyrics: Array.isArray(res.lyrics) ? res.lyrics : undefined,
    };
  },

  async createNeteaseQr(): Promise<{
    ok: boolean;
    unikey: string;
    qrSvg: string;
    qrUrl: string;
  } | null> {
    if (isTauriRuntime()) {
      try {
        return await invoke<any>('create_netease_qr');
      } catch {
        // fallback below
      }
    }
    try {
      const res = await fetch(apiUrl('/api/netease/qr/create'), {
        method: 'POST',
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return null;
  },

  async pollNeteaseQr(params: {
    unikey: string;
    nickname?: string;
  }): Promise<{
    ok: boolean;
    code: number;
    message?: string;
    uid?: string;
    nickname?: string;
    avatarUrl?: string;
    cookie?: string;
  } | null> {
    if (isTauriRuntime()) {
      try {
        return await invoke<any>('poll_netease_qr', { params });
      } catch {
        // fallback below
      }
    }
    try {
      const res = await fetch(apiUrl('/api/netease/qr/poll'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return null;
  },

  async saveLocalPlaylist(playlist: {
    id: string;
    name: string;
    description: string;
    trackIds: string[];
  }): Promise<void> {
    if ((import.meta as any).env?.MODE === 'test') return;
    try {
      if (isTauriRuntime()) {
        await invoke('save_local_playlist', { args: playlist });
        return;
      }
      await fetch(apiUrl('/api/library/playlist'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playlist),
      });
    } catch {
      // ignore offline error
    }
  },
};
