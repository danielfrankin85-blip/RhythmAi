import { memo, useCallback, useMemo, useState, type ChangeEvent } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';

/* ── Song source tab type ─────────────────────────────────────────────── */
type SongTab = 'builtin' | 'personal' | 'rhythm-ai' | 'youtube' | 'yt-mp3';

interface SongEntry {
  id: string;
  name: string;
  source: SongTab;
  path?: string;
  file?: File;
}

/* ── Song data ────────────────────────────────────────────────────────── */
const BUILT_IN_SONGS: SongEntry[] = [
  { id: 'b1', name: 'Central Cee - Booga', source: 'builtin', path: '/music/Central_Cee_-_Booga_(Lyrics)_320k.mp3' },
  { id: 'b2', name: 'Don Toliver - FWU', source: 'builtin', path: '/music/Don_Toliver_-_FWU_(AUDIO)_320k.mp3' },
  { id: 'b3', name: 'Lil Uzi Vert - What You Saying', source: 'builtin', path: '/music/Lil_Uzi_Vert_-_What_You_Saying_(Lyrics)_320k.mp3' },
  { id: 'b4', name: 'Playboi Carti - Kelly K', source: 'builtin', path: '/music/Playboi_Carti_-_Kelly_K_(Audio)_320k.mp3' },
  { id: 'b5', name: 'PUT IT ONG', source: 'builtin', path: '/music/PUT_IT_ONG_320k.mp3' },
  { id: 'b6', name: 'The Weeknd, Playboi Carti - Timeless', source: 'builtin', path: '/music/The_Weeknd%2C_Playboi_Carti_-_Timeless_(Audio)_320k.mp3' },
];

const RHYTHM_AI_SONGS: SongEntry[] = [
  { id: 'ai-1', name: 'Rhythm AI Suggestion: Neon Pulse', source: 'rhythm-ai' },
  { id: 'ai-2', name: 'Rhythm AI Suggestion: Skyline Drive', source: 'rhythm-ai' },
  { id: 'ai-3', name: 'Rhythm AI Suggestion: Night Circuit', source: 'rhythm-ai' },
];

const YOUTUBE_SONGS: SongEntry[] = [
  { id: 'yt-1', name: 'YouTube Import Placeholder #1', source: 'youtube' },
  { id: 'yt-2', name: 'YouTube Import Placeholder #2', source: 'youtube' },
];

const YT_MP3_SONGS: SongEntry[] = [
  { id: 'ytmp3-1', name: 'YouTube to MP3 Placeholder #1', source: 'yt-mp3' },
  { id: 'ytmp3-2', name: 'YouTube to MP3 Placeholder #2', source: 'yt-mp3' },
];

const TAB_OPTIONS: { id: SongTab; label: string }[] = [
  { id: 'builtin', label: 'Built In' },
  { id: 'personal', label: 'Personal' },
  { id: 'rhythm-ai', label: 'Rhythm AI' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'yt-mp3', label: 'YouTube to MP3' },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'extreme', label: 'Extreme' },
  { value: 'deadly', label: 'Deadly' },
];

/* ── Props ────────────────────────────────────────────────────────────── */
interface SongSelectProps {
  onStartGame: (file: File, difficulty: Difficulty, songId: string, songName: string) => void;
  isLoading: boolean;
  bestRecords: Record<string, { bestScore: number; bestAccuracy: number }>;
  onOpenSettings?: () => void;
}

function fileNameToTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

/* ── Component ────────────────────────────────────────────────────────── */
export const SongSelect = memo<SongSelectProps>(({ onStartGame, isLoading, bestRecords, onOpenSettings }) => {
  const [activeTab, setActiveTab] = useState<SongTab>('builtin');
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [personalSongs, setPersonalSongs] = useState<SongEntry[]>([]);

  /* Derived */
  const songs = useMemo(() => {
    if (activeTab === 'builtin') return BUILT_IN_SONGS;
    if (activeTab === 'personal') return personalSongs;
    if (activeTab === 'rhythm-ai') return RHYTHM_AI_SONGS;
    if (activeTab === 'youtube') return YOUTUBE_SONGS;
    return YT_MP3_SONGS;
  }, [activeTab, personalSongs]);

  const selectedSong = useMemo(() => songs.find((s) => s.id === selectedSongId) ?? null, [songs, selectedSongId]);
  const canStart = Boolean(selectedSong && selectedDifficulty);

  /* Handlers */
  const handleTabChange = useCallback((tab: SongTab) => {
    setActiveTab(tab);
    setSelectedSongId(null);
  }, []);

  const handleUploadFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((f) => f.type.startsWith('audio/'));
    if (!files.length) return;

    const mapped: SongEntry[] = files.map((f) => ({
      id: `personal-${Date.now()}-${f.name}`,
      name: fileNameToTitle(f.name),
      source: 'personal' as const,
      file: f,
    }));

    setPersonalSongs((prev) => [...mapped, ...prev]);
    setActiveTab('personal');
    setSelectedSongId(mapped[0].id);
    event.currentTarget.value = '';
  }, []);

  const handleStartGame = useCallback(async () => {
    if (!selectedSong || !selectedDifficulty) return;

    if (selectedSong.file) {
      onStartGame(selectedSong.file, selectedDifficulty, selectedSong.id, selectedSong.name);
      return;
    }

    if (selectedSong.path) {
      const response = await fetch(selectedSong.path);
      if (!response.ok) return;
      const blob = await response.blob();
      const file = new File([blob], selectedSong.path.split('/').pop() ?? 'song.mp3', { type: blob.type || 'audio/mpeg' });
      onStartGame(file, selectedDifficulty, selectedSong.id, selectedSong.name);
    }
  }, [onStartGame, selectedDifficulty, selectedSong]);

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="flex min-h-screen w-full flex-col bg-game-bg px-6 py-6 md:px-10 lg:px-16">

      {/* ── Top bar: site name + tabs + settings ── */}
      <nav className="mb-10 flex flex-wrap items-center gap-4">
        <h1 className="mr-6 text-xl font-bold tracking-tight text-white">Rhythm&nbsp;Game</h1>

        {TAB_OPTIONS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-3">
          {/* Upload (always visible) */}
          <label
            htmlFor="personal-upload"
            className="cursor-pointer rounded-md border border-gray-600 px-3 py-1.5 text-sm text-gray-300 transition hover:border-white hover:text-white"
          >
            ＋ Upload
            <input
              id="personal-upload"
              type="file"
              accept="audio/*"
              multiple
              onChange={handleUploadFiles}
              className="hidden"
              aria-label="Upload personal songs"
            />
          </label>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="rounded-md border border-gray-600 px-3 py-1.5 text-sm text-gray-300 transition hover:border-white hover:text-white"
            >
              ⚙️ Settings
            </button>
          )}
        </div>
      </nav>

      {/* ── Main area: songs LEFT ↔ difficulty RIGHT ── */}
      <div className="flex flex-1 gap-10 lg:gap-20">

        {/* ── LEFT: Song list ── */}
        <section className="flex-1">
          <h2 className="mb-5 text-lg font-semibold text-white">Songs</h2>

          <div className="flex flex-wrap gap-4">
            {songs.length === 0 && (
              <p className="text-sm text-gray-500">No songs in this tab yet.</p>
            )}

            {songs.map((song) => {
              const isSelected = song.id === selectedSongId;
              const record = bestRecords[song.id];

              return (
                <button
                  key={song.id}
                  onClick={() => setSelectedSongId(song.id)}
                  className={`
                    song-card
                    group relative rounded-xl border-2 bg-white px-5 py-4
                    text-left text-black shadow-sm
                    transition-all duration-200 ease-out
                    hover:-translate-y-1 hover:shadow-md
                    focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-game-bg
                    ${isSelected
                      ? 'border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                      : 'border-black/80 hover:border-black'}
                  `}
                  aria-pressed={isSelected}
                >
                  <span className="block text-sm font-semibold leading-snug">{song.name}</span>
                  {record && (
                    <span className="mt-1 block text-xs text-gray-500">
                      Best: {record.bestScore.toLocaleString()} · {record.bestAccuracy.toFixed(2)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── RIGHT: Difficulty + Start ── */}
        <aside className="w-52 shrink-0">
          <h2 className="mb-5 text-lg font-semibold text-white">Difficulty</h2>

          <div className="flex flex-col gap-3">
            {DIFFICULTIES.map((d) => {
              const isActive = d.value === selectedDifficulty;
              return (
                <button
                  key={d.value}
                  onClick={() => setSelectedDifficulty(d.value)}
                  className={`
                    rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider
                    transition-all duration-200 ease-out
                    hover:-translate-y-0.5 hover:shadow-md
                    ${isActive
                      ? 'border-sky-400 bg-white text-black shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                      : 'border-gray-600 bg-game-panel text-gray-300 hover:border-white hover:text-white'}
                  `}
                  aria-pressed={isActive}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!canStart || isLoading}
            onClick={handleStartGame}
            className="mt-8 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold uppercase tracking-wide text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Start game with selected song and difficulty"
          >
            {isLoading ? 'Analyzing…' : 'Start Game'}
          </button>
        </aside>
      </div>
    </div>
  );
});

SongSelect.displayName = 'SongSelect';
