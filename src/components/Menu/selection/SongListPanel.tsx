import type { SongOption } from './types';

interface SongListPanelProps {
  songs: SongOption[];
  selectedSongId: string | null;
  onSongSelect: (song: SongOption) => void;
  panelId: string;
  emptyMessage: string;
  bestRecords: Record<string, { bestScore: number; bestAccuracy: number }>;
}

export function SongListPanel({
  songs,
  selectedSongId,
  onSongSelect,
  panelId,
  emptyMessage,
  bestRecords,
}: SongListPanelProps) {
  const selectedIndex = songs.findIndex((song) => song.id === selectedSongId);

  const moveSelection = (delta: number) => {
    if (!songs.length) return;
    const startIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = (startIndex + delta + songs.length) % songs.length;
    onSongSelect(songs[nextIndex]);
  };

  return (
    <section
      id={panelId}
      aria-labelledby="song-list-heading"
      className="rounded-xl border border-game-border bg-game-surface p-4"
    >
      <h2 id="song-list-heading" className="mb-3 text-lg font-semibold text-game-text">
        Songs
      </h2>

      <div
        role="listbox"
        aria-label="Song list"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveSelection(1);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(-1);
          }
          if ((event.key === 'Enter' || event.key === ' ') && selectedIndex >= 0) {
            event.preventDefault();
            onSongSelect(songs[selectedIndex]);
          }
        }}
        className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg border border-game-border bg-game-panel p-2"
      >
        {songs.length === 0 && <div className="p-4 text-sm text-game-muted">{emptyMessage}</div>}

        {songs.map((song) => {
          const isSelected = song.id === selectedSongId;
          const record = bestRecords[song.id];

          return (
            <button
              key={song.id}
              role="option"
              aria-selected={isSelected}
              onClick={() => onSongSelect(song)}
              className={`w-full rounded-md border px-3 py-3 text-left transition ${
                isSelected
                  ? 'border-game-accent bg-sky-500/15 shadow-glow'
                  : 'border-game-border bg-game-surface hover:border-sky-300/50 hover:bg-slate-700/40'
              }`}
            >
              <div className="text-sm font-medium text-game-text">{song.name}</div>
              {record && (
                <div className="mt-1 text-xs text-game-muted">
                  Best: {record.bestScore.toLocaleString()} · {record.bestAccuracy.toFixed(2)}%
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
