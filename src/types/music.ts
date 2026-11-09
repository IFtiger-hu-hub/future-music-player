import { THEME_PALETTES, getThemePalette } from '../theme/palettes';

export { THEME_PALETTES, getThemePalette };

export type SourceId = 'huawei' | 'netease' | 'qq' | 'local' | 'navidrome';

export type NavSection =
  | 'favorites'
  | 'local_playlists'
  | 'imported_playlists'
  | 'search'
  | 'history'
  | 'sources'
  | 'settings';

export type ThemeId =
  | 'apple_dark'
  | 'light'
  | 'ocean'
  | 'sage'
  | 'sand'
  | 'rose'
  | 'ice'
  | 'midnight'
  | 'forest'
  | 'graphite'
  | 'wine'
  | 'coffee'
  | 'obsidian';

export interface ThemePalette {
  id: ThemeId;
  label: string;
  base: string;
  surface: string;
  elevated: string;
  text: string;
  secondary: string;
  muted: string;
  accent: string;
  dark: boolean;
}

export type AudioAccess = 'full' | 'preview' | 'unknown';
export type AudioQuality = 'lossless' | 'hires' | 'standard';

export interface SourceBinding {
  source: SourceId;
  sourceTrackId: string;
  access: AudioAccess;
  quality: AudioQuality;
  formatLabel: string;
  streamUrl?: string;
}

export interface LyricWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface LyricLine {
  timeMs: number;
  endMs: number;
  text: string;
  romanization?: string;
  translation?: string;
  words?: LyricWord[];
}

export interface CanonicalTrack {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationSeconds: number;
  coverUrl: string;
  audioUrl?: string;
  dominantColors: [string, string, string];
  version?: string;
  isFavorite: boolean;
  bindings: SourceBinding[];
  lyrics: LyricLine[];
}

export interface MusicSourceMeta {
  id: SourceId;
  name: string;
  shortName: string;
  accent: string;
  badgeBg: string;
  loggedIn: boolean;
  accountName: string;
  syncStatus: 'updated' | 'imported' | 'never' | 'expired';
  lastSyncAt?: string;
  favoriteCount: number;
  playlistCount: number;
  protocolDesc: string;
  capabilities: string[];
}

export interface PlaylistItem {
  id: string;
  kind: 'local' | 'imported';
  source?: SourceId;
  name: string;
  description: string;
  coverUrl: string;
  trackCount: number;
  updatedAt: string;
  trackIds: string[];
  snapshotAccount?: string;
}

export interface EqualizerBand {
  freqHz: number;
  label: string;
  gainDb: number;
}

export interface MergeAuditRecord {
  id: string;
  winnerTrackId: string;
  loserTrackId: string;
  winnerTitle: string;
  loserTitle: string;
  method: 'code' | 'jev';
  score: number;
  createdAt: string;
  revoked: boolean;
}
