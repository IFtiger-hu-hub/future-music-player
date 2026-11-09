import React from 'react';
import { usePlayerStore } from '../store/usePlayerStore';
import { TrackTable } from '../components/TrackTable';

export const HistoryView: React.FC = () => {
  const tracks = usePlayerStore((s) => s.tracks);
  const historyTrackIds = usePlayerStore((s) => s.historyTrackIds);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">最近播放</h1>
        <p className="text-[13px] text-white/50 mt-1">
          您近期聆听过的跨源曲目记录
        </p>
      </div>
      <TrackTable
        tracks={historyTrackIds
          .map((id) => tracks.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t))}
      />
    </>
  );
};

