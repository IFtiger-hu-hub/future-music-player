import { CanonicalTrack, EqualizerBand } from '../types/music';

const AUDIO_SEEK_EVENT = 'future-audio-seek';

/**
 * Dispatch a playback seek command (in milliseconds) to the active HTML5 <audio> element.
 */
export function dispatchAudioSeek(targetMs: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<number>(AUDIO_SEEK_EVENT, { detail: Math.max(0, targetMs) })
  );
}

/**
 * Subscribe to playback seek commands. Returns an unsubscribe function.
 */
export function subscribeAudioSeek(onSeekMs: (targetMs: number) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<number>;
    if (typeof custom.detail === 'number' && Number.isFinite(custom.detail)) {
      onSeekMs(custom.detail);
    }
  };
  window.addEventListener(AUDIO_SEEK_EVENT, handler);
  return () => window.removeEventListener(AUDIO_SEEK_EVENT, handler);
}

/**
 * Update system native Media Session API (Windows SMTC, macOS Now Playing, Linux MPRIS / WebKitGTK)
 */
export function updateNativeMediaSession(params: {
  track: CanonicalTrack;
  isPlaying: boolean;
  currentTimeSec?: number;
  durationSec?: number;
}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const { track, isPlaying, currentTimeSec, durationSec } = params;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.join(' / '),
      album: track.album || 'Future Music',
      artwork: [
        {
          src: track.coverUrl,
          sizes: '300x300',
          type: 'image/jpeg',
        },
        {
          src: track.coverUrl,
          sizes: '512x512',
          type: 'image/jpeg',
        },
      ],
    });

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    if (
      typeof durationSec === 'number' &&
      durationSec > 0 &&
      typeof currentTimeSec === 'number' &&
      Number.isFinite(currentTimeSec) &&
      'setPositionState' in navigator.mediaSession
    ) {
      navigator.mediaSession.setPositionState({
        duration: durationSec,
        playbackRate: isPlaying ? 1.0 : 0,
        position: Math.max(0, Math.min(durationSec, currentTimeSec)),
      });
    }
  } catch {
    // Ignore unsupported mediaSession actions on older webviews
  }
}

/**
 * Register global Media Session hardware keyboard / OS notification action handlers.
 */
export function setupMediaSessionActionHandlers(handlers: {
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekTo: (sec: number) => void;
}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('play', () => handlers.onPlay());
    navigator.mediaSession.setActionHandler('pause', () => handlers.onPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => handlers.onPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => handlers.onNext());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        handlers.onSeekTo(details.seekTime);
      }
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      handlers.onSeekTo(Math.max(0, (details.seekTime || 0) - skip));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      handlers.onSeekTo((details.seekTime || 0) + skip);
    });
  } catch {
    // Ignore on platforms where certain action types are unaccepted
  }
}

/**
 * Web Audio API 10-Band Peaking Parametric Equalizer Graph Controller with Anti-Pop Gain Fade.
 * Connects an HTMLAudioElement to a 10-band BiquadFilterNode chain and GainNode.
 */
export class ParametricEqualizerEngine {
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private gainNode: GainNode | null = null;
  private attachedElement: HTMLAudioElement | null = null;

  attach(audioElement: HTMLAudioElement, bands: EqualizerBand[]) {
    if (
      typeof window !== 'undefined' &&
      !window.location.protocol.startsWith('http')
    ) {
      // On Linux WebKitGTK (tauri://localhost), createMediaElementSource across
      // tauri:// -> http://127.0.0.1 triggers WebKit's cross-scheme taint mute.
      // Let HTML5 <audio> play directly through native GStreamer/PipeWire sink.
      return;
    }
    if (this.attachedElement === audioElement && this.ctx) {
      return;
    }
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const sourceNode = ctx.createMediaElementSource(audioElement);
      const filters = bands.map((band) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = band.freqHz;
        filter.Q.value = 1.4;
        filter.gain.value = band.gainDb;
        return filter;
      });

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(1.0, ctx.currentTime);

      let prevNode: AudioNode = sourceNode;
      for (const f of filters) {
        prevNode.connect(f);
        prevNode = f;
      }
      prevNode.connect(gainNode);
      gainNode.connect(ctx.destination);

      this.ctx = ctx;
      this.filters = filters;
      this.gainNode = gainNode;
      this.attachedElement = audioElement;
    } catch {
      // Fallback to direct HTML5 audio output if Web Audio API is unavailable
    }
  }

  updateBands(bands: EqualizerBand[]) {
    if (!this.filters.length) return;
    bands.forEach((band, idx) => {
      const filter = this.filters[idx];
      if (filter) {
        filter.gain.value = band.gainDb;
      }
    });
  }

  microFadeOut(durationMs = 60) {
    if (!this.gainNode || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0.01, now + durationMs / 1000);
    } catch {}
  }

  microFadeIn(durationMs = 80) {
    if (!this.gainNode || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0.01, now);
      this.gainNode.gain.linearRampToValueAtTime(1.0, now + durationMs / 1000);
    } catch {}
  }

  resumeIfNeeded() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
}


