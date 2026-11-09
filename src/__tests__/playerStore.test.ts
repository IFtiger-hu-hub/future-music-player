import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from '../store/usePlayerStore';
import { INITIAL_TRACKS } from '../data/mockMusicData';
import {
  buildLyricRenderSegments,
  computeGlyphKaraokeState,
  findActiveLyricIndex,
} from '../utils/lyricUtils';

describe('Future Music Player Multi-Source Store & Huawei Sync Engine', () => {
  beforeEach(() => {
    // Reset core store fields before each test
    usePlayerStore.setState({
      activeNav: 'favorites',
      activeSourceFilter: 'all',
      currentTrack: INITIAL_TRACKS[0],
      activeSourceForPlayback: 'huawei',
      isPlaying: true,
      currentTimeMs: 0,
      lyricOffsetMs: 0,
      isDesktopLyricOpen: false,
      isDesktopLyricLocked: false,
      jevEnabled: false,
    });
  });

  it('switches navigation and top source filter pills smoothly', () => {
    const store = usePlayerStore.getState();
    store.setActiveNav('sources');
    store.setActiveSourceFilter('huawei');

    const updated = usePlayerStore.getState();
    expect(updated.activeNav).toBe('sources');
    expect(updated.activeSourceFilter).toBe('huawei');
  });

  it('executes Smart Fallback when a preferred source only has a 45s preview stream', () => {
    // Track 1 (富士山下) has huawei=full, qq=preview, navidrome=full
    const fushishan = INITIAL_TRACKS.find((t) => t.id === 'trk_fushishan')!;
    usePlayerStore.getState().playTrack(fushishan, 'qq');

    const updated = usePlayerStore.getState();
    expect(updated.currentTrack.id).toBe('trk_fushishan');
    // Should automatically fall back from 'qq' (preview) to 'huawei' or 'navidrome' (full)
    expect(updated.activeSourceForPlayback).not.toBe('qq');
    expect(['huawei', 'navidrome']).toContain(updated.activeSourceForPlayback);
  });

  it('preserves local favorites when signing out of a third-party source', () => {
    const beforeFavCount = usePlayerStore
      .getState()
      .tracks.filter((t) => t.isFavorite).length;

    // Disconnect NetEase source
    usePlayerStore.getState().toggleSourceLogin('netease');

    const afterState = usePlayerStore.getState();
    const neteaseMeta = afterState.sources.find((s) => s.id === 'netease')!;
    expect(neteaseMeta.loggedIn).toBe(false);

    // Local favorites must remain 100% intact
    const afterFavCount = afterState.tracks.filter((t) => t.isFavorite).length;
    expect(afterFavCount).toBe(beforeFavCount);
  });

  it('completes Huawei OAuth PKCE + loginex session re-authentication', () => {
    usePlayerStore
      .getState()
      .completeHuaweiReauth('HUAWEI ID · 186****9021 (SVIP Verified)');

    const hw = usePlayerStore.getState().sources.find((s) => s.id === 'huawei')!;
    expect(hw.loggedIn).toBe(true);
    expect(hw.accountName).toContain('SVIP Verified');
    expect(hw.syncStatus).toBe('updated');
  });

  it('supports 10-band parametric EQ presets, lyric offset calibration, and merge undo', () => {
    const store = usePlayerStore.getState();
    store.applyEqPreset('vocal');
    store.adjustLyricOffset(400);

    const targetMergeId = store.mergeAudits[0].id;
    store.revokeMergeDecision(targetMergeId);

    const updated = usePlayerStore.getState();
    expect(updated.eqPreset).toBe('vocal');
    expect(updated.lyricOffsetMs).toBe(400);
    expect(
      updated.mergeAudits.find((m) => m.id === targetMergeId)?.revoked
    ).toBe(true);
  });

  it('creates a new local multi-source playlist and appends tracks', () => {
    const prevCount = usePlayerStore.getState().playlists.length;
    usePlayerStore
      .getState()
      .createLocalPlaylist('测试跨源歌单', '混装华为与本地无损');

    const stateAfterCreate = usePlayerStore.getState();
    expect(stateAfterCreate.playlists.length).toBe(prevCount + 1);

    const newPlaylist = stateAfterCreate.playlists[0];
    expect(newPlaylist.kind).toBe('local');
    expect(newPlaylist.name).toBe('测试跨源歌单');

    stateAfterCreate.addTrackToLocalPlaylist(newPlaylist.id, 'trk_fushishan');
    const updatedPl = usePlayerStore
      .getState()
      .playlists.find((p) => p.id === newPlaylist.id)!;
    expect(updatedPl.trackIds).toContain('trk_fushishan');
  });

  it('switches across the 13 light/dark themes, updates DOM CSS variables, and resets cleanly', () => {
    const store = usePlayerStore.getState();

    // Switch to a Light theme ('ocean' / 晴海)
    store.setThemeId('ocean');
    store.setFontScale(1.1);
    store.setCustomAccent('#1A6FA3');

    const afterLight = usePlayerStore.getState();
    expect(afterLight.themeId).toBe('ocean');
    expect(afterLight.fontScale).toBe(1.1);
    expect(afterLight.customAccent).toBe('#1A6FA3');
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('light');

    // Reset appearance back to default ('apple_dark')
    afterLight.resetAppearance();
    const afterReset = usePlayerStore.getState();
    expect(afterReset.themeId).toBe('apple_dark');
    expect(afterReset.fontScale).toBe(1);
    expect(afterReset.customAccent).toBeNull();
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('dark');
  });

  it('keeps active lyric line during inter-sentence pauses without jumping back to line 0', () => {
    const sampleLyrics = [
      { timeMs: 0, endMs: 1200, text: 'Beauty And A Beat - Justin Bieber' },
      { timeMs: 2500, endMs: 3700, text: 'Written by : Nicki Minaj/Max Martin' },
      { timeMs: 7490, endMs: 8060, text: 'Yeah, Young Money' },
    ];

    expect(findActiveLyricIndex(sampleLyrics, 500)).toBe(0);
    // In the pause between line 0 (ends 1200ms) and line 1 (starts 2500ms), stay on line 0
    expect(findActiveLyricIndex(sampleLyrics, 1800)).toBe(0);
    // In the pause between line 1 (ends 3700ms) and line 2 (starts 7490ms), stay on line 1 (do NOT jump back to 0!)
    expect(findActiveLyricIndex(sampleLyrics, 5200)).toBe(1);
    expect(findActiveLyricIndex(sampleLyrics, 7600)).toBe(2);
  });

  it('groups character-by-character HMRC credits into unbreakable words while preserving exact inter-word spaces', () => {
    // Reproduces the exact Huawei HMRC character-level line from Beauty And A Beat:
    // "Written by :Max Martin"
    const rawChars = 'Written by :Max Martin';
    const words = Array.from(rawChars).map((ch, idx) => ({
      text: ch,
      startMs: 1000 + idx * 22,
      endMs: 1000 + idx * 22 + 50, // overlapping 50ms duration from legacy parser
    }));

    const segments = buildLyricRenderSegments({
      timeMs: 1000,
      endMs: 2000,
      text: rawChars,
      words,
    });

    // Reconstructed text across all segments must match rawChars 100% (no extra intra-word spaces!)
    const fullText = segments
      .map((s) =>
        s.kind === 'space' ? s.text : s.glyphs.map((g) => g.text).join('')
      )
      .join('');
    expect(fullText).toBe('Written by :Max Martin');

    // "Written" and "Martin" must be grouped as nowrap segments so CSS never splits "Mar" / "tin"
    const nowrapTexts = segments
      .filter((s): s is Extract<typeof s, { kind: 'word' }> => s.kind === 'word' && s.nowrap)
      .map((s) => s.glyphs.map((g) => g.text).join(''));
    expect(nowrapTexts).toContain('Written');
    expect(nowrapTexts).toContain('Martin');

    // Overlapping glyph endMs must be clamped so at any timestamp at most 1 glyph is 'active'
    const allGlyphs = segments.flatMap((s) => (s.kind === 'word' ? s.glyphs : []));
    const activeAt1030 = allGlyphs.filter(
      (g) => computeGlyphKaraokeState(g.startMs, g.endMs, 1030).state === 'active'
    );
    expect(activeAt1030.length).toBe(1);
  });
});


