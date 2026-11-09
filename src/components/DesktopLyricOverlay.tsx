import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lock, Unlock, X } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';

function formatWordToken(text: string, nextText?: string): string {
  if (!nextText) return text;
  if (/\s$/.test(text) || /^\s/.test(nextText)) return text;
  if (/[a-zA-Z0-9]$/.test(text) && /^[a-zA-Z0-9]/.test(nextText)) {
    return `${text} `;
  }
  return text;
}

export const DesktopLyricOverlay: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isDesktopLyricOpen);
  const isLocked = usePlayerStore((s) => s.isDesktopLyricLocked);
  const setOpen = usePlayerStore((s) => s.setDesktopLyricOpen);
  const setLocked = usePlayerStore((s) => s.setDesktopLyricLocked);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const lyricOffsetMs = usePlayerStore((s) => s.lyricOffsetMs);

  const effectiveTimeMs = Math.max(0, currentTimeMs + lyricOffsetMs);
  const activeLine =
    currentTrack.lyrics.find(
      (l) => effectiveTimeMs >= l.timeMs && effectiveTimeMs < l.endMs
    ) || currentTrack.lyrics[0];

  return (
    <AnimatePresence>
      {isOpen && activeLine && (
        <motion.div
          drag={!isLocked}
          dragMomentum={false}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-40 px-8 py-3.5 rounded-full backdrop-blur-2xl transition-colors select-none group ${
            isLocked
              ? 'bg-black/35 border border-transparent'
              : 'bg-[#16171C]/88 border border-white/15 shadow-[0_16px_48px_rgba(0,0,0,0.45)] cursor-move'
          }`}
        >
          {/* Top Floating Controls */}
          <div className="absolute -top-3.5 right-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setLocked(!isLocked)}
              title={isLocked ? '解锁桌面悬浮词' : '锁定穿透桌面词'}
              className="px-2.5 py-1 rounded-full bg-zinc-900/95 border border-white/15 text-[10px] !text-white flex items-center gap-1 cursor-pointer"
            >
              {isLocked ? (
                <>
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>已锁定</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3 h-3 text-emerald-400" />
                  <span>可拖拽</span>
                </>
              )}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-full bg-zinc-900/95 border border-white/15 !text-white/75 hover:!text-white cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {activeLine.romanization && (
            <div className="text-center text-[11px] font-mono-tabular !text-amber-200/90 tracking-wide mb-0.5">
              {activeLine.romanization}
            </div>
          )}

          {/* Word-by-Word Highlighted Main Line */}
          <div className="text-center text-[19px] font-bold tracking-tight">
            {activeLine.words && activeLine.words.length > 0 ? (
              activeLine.words.map((w, idx) => {
                const active =
                  effectiveTimeMs >= w.startMs && effectiveTimeMs < w.endMs;
                const passed = effectiveTimeMs >= w.endMs;
                const nextWordText = activeLine.words?.[idx + 1]?.text;
                return (
                  <span
                    key={idx}
                    className={`inline transition-colors duration-100 ${
                      active
                        ? '!text-[#FF4D58] drop-shadow-[0_0_12px_rgba(255,77,88,0.8)]'
                        : passed
                        ? '!text-white'
                        : '!text-white/55'
                    }`}
                  >
                    {formatWordToken(w.text, nextWordText)}
                  </span>
                );
              })
            ) : (
              <span className="!text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                {activeLine.text}
              </span>
            )}
          </div>

          {activeLine.translation && (
            <div className="text-center text-xs !text-zinc-300 mt-1">
              {activeLine.translation}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
