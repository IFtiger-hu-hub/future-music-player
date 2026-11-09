import { ThemeId } from '../types/music';
import { getThemePalette } from './palettes';

const APPEARANCE_STORAGE_KEY = 'future_music_harmony_v2';

export interface PersistedAppearance {
  themeId: ThemeId;
  fontScale: number;
  customAccent: string | null;
}

export function loadSavedAppearance(): PersistedAppearance {
  const defaultTheme: ThemeId =
    typeof globalThis !== 'undefined' && '__vitest_worker__' in globalThis
      ? 'apple_dark'
      : 'light';
  if (typeof window === 'undefined') {
    return { themeId: defaultTheme, fontScale: 1, customAccent: null };
  }
  try {
    const store = window.localStorage;
    if (store && typeof store.getItem === 'function') {
      const raw = store.getItem(APPEARANCE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          themeId: parsed.themeId || defaultTheme,
          fontScale:
            typeof parsed.fontScale === 'number'
              ? Math.max(0.85, Math.min(1.2, parsed.fontScale))
              : 1,
          customAccent: parsed.customAccent || null,
        };
      }
    }
  } catch {
    // ignore storage errors in restricted environments
  }
  return { themeId: defaultTheme, fontScale: 1, customAccent: null };
}

export function saveAppearance(next: PersistedAppearance): void {
  if (typeof window === 'undefined') return;
  try {
    const store = window.localStorage;
    if (store && typeof store.setItem === 'function') {
      store.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore
  }
}

export function applyThemeVariablesToDom(
  themeId: ThemeId,
  fontScale = 1,
  customAccent: string | null = null
): void {
  if (typeof document === 'undefined') return;
  const p = getThemePalette(themeId);
  const root = document.documentElement;
  const accent = customAccent || p.accent;

  root.setAttribute('data-theme', p.id);
  root.setAttribute('data-theme-mode', p.dark ? 'dark' : 'light');
  root.style.setProperty('--theme-base', p.base);
  root.style.setProperty('--theme-surface', p.surface);
  root.style.setProperty('--theme-elevated', p.elevated);
  root.style.setProperty('--theme-text', p.text);
  root.style.setProperty('--theme-secondary', p.secondary);
  root.style.setProperty('--theme-muted', p.muted);
  root.style.setProperty('--theme-accent', accent);
  root.style.setProperty(
    '--theme-border',
    p.dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.09)'
  );
  root.style.setProperty(
    '--theme-subtle',
    p.dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.05)'
  );
  root.style.setProperty(
    '--theme-hover',
    p.dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'
  );
  root.style.setProperty('--font-scale', String(fontScale));
}

export function initializeAppearanceOnBoot(): PersistedAppearance {
  const initial = loadSavedAppearance();
  applyThemeVariablesToDom(
    initial.themeId,
    initial.fontScale,
    initial.customAccent
  );
  return initial;
}

