import { EqualizerBand } from '../types/music';

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
 * Web Audio API 10-Band Peaking Parametric Equalizer Graph Controller.
 * Connects an HTMLAudioElement to a 10-band BiquadFilterNode chain.
 */
export class ParametricEqualizerEngine {
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private attachedElement: HTMLAudioElement | null = null;

  attach(audioElement: HTMLAudioElement, bands: EqualizerBand[]) {
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

      let prevNode: AudioNode = sourceNode;
      for (const f of filters) {
        prevNode.connect(f);
        prevNode = f;
      }
      prevNode.connect(ctx.destination);

      this.ctx = ctx;
      this.filters = filters;
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

  resumeIfNeeded() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
}

