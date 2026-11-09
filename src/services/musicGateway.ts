import { invoke } from '@tauri-apps/api/core';
import { CanonicalTrack, LyricLine, PlaylistItem } from '../types/music';
import { INITIAL_TRACKS } from '../data/mockMusicData';

const DEFAULT_HUAWEI_COVER =
  'https://contentcenter-drcn.dbankcdn.cn/img/pub_1/HW-Music_cover_100_1/93/v3/xM5ysS7yTcGMEt_KCRzMag/59b7193a-9f7e-4950-a6c5-ff658092a18c.jpg/music_cover_1000x1000.webp';

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

function mapRawTracks(rawTracks: any[]): CanonicalTrack[] {
  return (rawTracks || []).map((t: any): CanonicalTrack => ({
    id: t.id,
    title: t.title,
    artists: t.artists || ['未知艺人'],
    album: t.album || '华为音乐',
    durationSeconds: t.durationSeconds || 225,
    coverUrl: t.coverUrl || DEFAULT_HUAWEI_COVER,
    dominantColors: ['#4C1D24', '#18181B', '#09090B'],
    isFavorite: true,
    bindings: [
      {
        source: 'huawei',
        sourceTrackId: t.sourceTrackId,
        access: 'full',
        quality: 'lossless',
        formatLabel: '无损 FLAC',
      },
    ],
    lyrics: [
      {
        timeMs: 0,
        endMs: 12000,
        text: `${t.title} — ${t.artists?.join(' / ')}`,
        translation: '正在加载华为音乐逐字 HMRC / LRC 歌词...',
      },
    ],
  }));
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
};
