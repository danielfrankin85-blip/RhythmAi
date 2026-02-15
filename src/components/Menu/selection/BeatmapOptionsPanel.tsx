interface BeatmapOptionsPanelProps {
  enabled: boolean;
  isLoading: boolean;
  songName: string;
  difficultyName: string;
  onCreateBeatmap: () => void;
}

export function BeatmapOptionsPanel({
  enabled,
  isLoading,
  songName,
  difficultyName,
  onCreateBeatmap,
}: BeatmapOptionsPanelProps) {
  if (!enabled) {
    return null;
  }

  return (
    <section
      aria-label="Beatmap options"
      className="rounded-xl border border-game-border bg-game-surface p-4"
    >
      <h3 className="text-lg font-semibold text-game-text">Beatmap Options</h3>
      <p className="mt-2 text-sm text-game-muted">
        Ready to create beatmap for <span className="font-medium text-game-text">{songName}</span> on{' '}
        <span className="font-medium uppercase text-game-text">{difficultyName}</span>.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-game-text" htmlFor="note-density">
          Note Density
          <select
            id="note-density"
            className="rounded-md border border-game-border bg-game-panel px-3 py-2 text-sm text-game-text"
            defaultValue="balanced"
          >
            <option value="sparse">Sparse</option>
            <option value="balanced">Balanced</option>
            <option value="dense">Dense</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-game-text" htmlFor="scroll-speed">
          Scroll Speed
          <select
            id="scroll-speed"
            className="rounded-md border border-game-border bg-game-panel px-3 py-2 text-sm text-game-text"
            defaultValue="normal"
          >
            <option value="slow">Slow</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={onCreateBeatmap}
        disabled={isLoading}
        className="mt-4 w-full rounded-md bg-game-accent px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-game-accentStrong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? 'Generating Beatmap…' : 'Create Beatmap (Placeholder)'}
      </button>
    </section>
  );
}
