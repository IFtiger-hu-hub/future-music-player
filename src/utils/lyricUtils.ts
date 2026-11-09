import { LyricLine, LyricWord } from '../types/music';

export interface RenderGlyph {
  text: string;
  startMs: number;
  endMs: number;
}

export type RenderSegment =
  | {
      kind: 'space';
      text: string;
    }
  | {
      kind: 'word';
      nowrap: boolean;
      glyphs: RenderGlyph[];
    };

const CJK_CHAR_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/**
 * Finds the active lyric line index for the given playback timestamp.
 * Keeps the current line active during instrumental breaths/gaps between lines
 * instead of jumping back to line 0 when `effectiveTimeMs >= line.endMs`.
 */
export function findActiveLyricIndex(
  lyrics: LyricLine[],
  effectiveTimeMs: number
): number {
  if (!lyrics || lyrics.length === 0) return -1;
  let activeIdx = 0;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].timeMs <= effectiveTimeMs) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return activeIdx;
}

/**
 * Computes smooth karaoke sweep state & progress (0..1) for a single glyph/word token.
 * Uses a smootherstep curve so intra-word sweeps feel fluid at 60fps.
 */
export function computeGlyphKaraokeState(
  startMs: number,
  endMs: number,
  effectiveTimeMs: number
): {
  state: 'passed' | 'active' | 'upcoming';
  progress: number;
} {
  if (effectiveTimeMs >= endMs) {
    return { state: 'passed', progress: 1 };
  }
  if (effectiveTimeMs <= startMs) {
    return { state: 'upcoming', progress: 0 };
  }
  const duration = Math.max(1, endMs - startMs);
  const t = Math.max(0, Math.min(1, (effectiveTimeMs - startMs) / duration));
  const smooth = t * t * t * (t * (t * 6 - 15) + 10);
  return { state: 'active', progress: smooth };
}

/**
 * Normalizes and groups a line's word/syllable/character tokens into render segments:
 * 1. Preserves exact spaces from HMRC (`" "` tokens or leading/trailing spaces).
 * 2. Reconstructs spaces from `line.text` ONLY if all tokens lack whitespace (e.g. trimmed TTML).
 * 3. Clamps overlapping `endMs` on fast sub-word tokens so multiple letters don't highlight at once.
 * 4. Groups contiguous Latin/non-CJK sub-word tokens (e.g. "M"+"a"+"r"+"t"+"i"+"n") into
 *    unbreakable `nowrap` word units so the browser never breaks a word in half (`MaxMar\ntin`),
 *    while allowing clean line breaks at spaces, CJK boundaries, and after `/`.
 */
export function buildLyricRenderSegments(line: LyricLine): RenderSegment[] {
  const rawWords = line.words;
  if (!rawWords || rawWords.length === 0) {
    return [];
  }

  // Step 1: If no token contains whitespace but `line.text` has spaces, restore spaces by aligning with `line.text`
  const hasAnyWhitespace = rawWords.some((w) => /\s/.test(w.text));
  const alignedWords: LyricWord[] = [];

  if (!hasAnyWhitespace && /\s/.test(line.text)) {
    let cursor = 0;
    for (const w of rawWords) {
      if (!w.text) continue;
      const foundIdx = line.text.indexOf(w.text, cursor);
      let prefixSpace = '';
      if (foundIdx > cursor && /\s/.test(line.text.slice(cursor, foundIdx))) {
        prefixSpace = ' ';
      }
      alignedWords.push({
        text: prefixSpace + w.text,
        startMs: w.startMs,
        endMs: w.endMs,
      });
      if (foundIdx >= 0) {
        cursor = foundIdx + w.text.length;
      }
    }
  } else {
    for (const w of rawWords) {
      if (!w.text) continue;
      alignedWords.push({ ...w });
    }
  }

  // Step 2: Clamp sequential `endMs` so fast character tokens never overlap
  const normalizedWords: LyricWord[] = alignedWords.map((w, i) => {
    const next = alignedWords[i + 1];
    const startMs = w.startMs;
    let endMs = Math.max(startMs + 10, w.endMs);
    if (next && endMs > next.startMs) {
      endMs = Math.max(startMs + 10, next.startMs);
    }
    return {
      text: w.text,
      startMs,
      endMs,
    };
  });

  // Step 3: Split tokens into atomic pieces (whitespace vs glyphs) and group contiguous Latin sub-words
  const segments: RenderSegment[] = [];
  let currentWordGlyphs: RenderGlyph[] = [];

  const flushWordGroup = () => {
    if (currentWordGlyphs.length > 0) {
      segments.push({
        kind: 'word',
        nowrap: true,
        glyphs: currentWordGlyphs,
      });
      currentWordGlyphs = [];
    }
  };

  const pushSpace = () => {
    flushWordGroup();
    const last = segments[segments.length - 1];
    if (!last || last.kind !== 'space') {
      segments.push({ kind: 'space', text: ' ' });
    }
  };

  for (const token of normalizedWords) {
    const raw = token.text;
    if (/^\s+$/.test(raw)) {
      pushSpace();
      continue;
    }

    const leadingSpace = /^\s/.test(raw);
    const trailingSpace = /\s$/.test(raw);
    const core = raw.trim();

    if (leadingSpace) {
      pushSpace();
    }

    if (core) {
      // If token contains CJK characters, flush any pending Latin word and emit CJK token
      if (CJK_CHAR_RE.test(core)) {
        flushWordGroup();
        segments.push({
          kind: 'word',
          nowrap: false,
          glyphs: [
            {
              text: core,
              startMs: token.startMs,
              endMs: token.endMs,
            },
          ],
        });
      } else if (core.includes('/') && core.length > 1) {
        // Split around '/' so slashes allow line wrapping after '/'
        const parts = core.split('/');
        parts.forEach((part, idx) => {
          const isLast = idx === parts.length - 1;
          const pieceText = isLast ? part : `${part}/`;
          if (!pieceText) return;
          currentWordGlyphs.push({
            text: pieceText,
            startMs: token.startMs,
            endMs: token.endMs,
          });
          if (!isLast) {
            flushWordGroup();
          }
        });
      } else {
        currentWordGlyphs.push({
          text: core,
          startMs: token.startMs,
          endMs: token.endMs,
        });
        // Allow line break after a slash token '/'
        if (core.endsWith('/')) {
          flushWordGroup();
        }
      }
    }

    if (trailingSpace) {
      pushSpace();
    }
  }

  flushWordGroup();

  // Trim leading/trailing space segments
  while (segments.length > 0 && segments[0].kind === 'space') {
    segments.shift();
  }
  while (segments.length > 0 && segments[segments.length - 1].kind === 'space') {
    segments.pop();
  }

  return segments;
}

