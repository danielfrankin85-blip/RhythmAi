import { memo, useCallback, useMemo, useState, type ChangeEvent } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';
import { BeatmapOptionsPanel } from './selection/BeatmapOptionsPanel';
import { DifficultyPanel } from './selection/DifficultyPanel';
import { SongListPanel } from './selection/SongListPanel';
import { TopNavTabs } from './selection/TopNavTabs';
import type { NavigationTab, SongOption } from './selection/types';

const BUILT_IN_SONGS: SongOption[] = [
  { id: 'b1', name: 'Central Cee - Booga', source: 'builtin', path: '/music/Central_Cee_-_Booga_(Lyrics)_320k.mp3' },
  { id: 'b2', name: 'Don Toliver - FWU', source: 'builtin', path: '/music/Don_Toliver_-_FWU_(AUDIO)_320k.mp3' },
  { id: 'b3', name: 'Lil Uzi Vert - What You Saying', source: 'builtin', path: '/music/Lil_Uzi_Vert_-_What_You_Saying_(Lyrics)_320k.mp3' },
  { id: 'b4', name: 'Playboi Carti - Kelly K', source: 'builtin', path: '/music/Playboi_Carti_-_Kelly_K_(Audio)_320k.mp3' },
  { id: 'b5', name: 'PUT IT ONG', source: 'builtin', path: '/music/PUT_IT_ONG_320k.mp3' },
  { id: 'b6', name: 'The Weeknd, Playboi Carti - Timeless', source: 'builtin', path: '/music/The_Weeknd%2C_Playboi_Carti_-_Timeless_(Audio)_320k.mp3' },
];

const RHYTHM_AI_SONGS: SongOption[] = [
  { id: 'ai-1', name: 'Rhythm AI Suggestion: Neon Pulse', source: 'rhythm-ai' },
  { id: 'ai-2', name: 'Rhythm AI Suggestion: Skyline Drive', source: 'rhythm-ai' },
  { id: 'ai-3', name: 'Rhythm AI Suggestion: Night Circuit', source: 'rhythm-ai' },
];

const YOUTUBE_SONGS: SongOption[] = [
  { id: 'yt-1', name: 'YouTube Import Placeholder #1', source: 'youtube' },
  { id: 'yt-2', name: 'YouTube Import Placeholder #2', source: 'youtube' },
];

const YT_MP3_SONGS: SongOption[] = [
  { id: 'ytmp3-1', name: 'YouTube to MP3 Placeholder #1', source: 'yt-mp3' },
  { id: 'ytmp3-2', name: 'YouTube to MP3 Placeholder #2', source: 'yt-mp3' },
];

interface SongSelectProps {
  onStartGame: (file: File, difficulty: Difficulty, songId: string, songName: string) => void;
  isLoading: boolean;
  bestRecords: Record<string, { bestScore: number; bestAccuracy: number }>;
}

function fileNameToTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export const SongSelect = memo<SongSelectProps>(({ onStartGame, isLoading, bestRecords }) => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('builtin');
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [personalSongs, setPersonalSongs] = useState<SongOption[]>([]);
  const [uiMessage, setUiMessage] = useState<string>('Select a song and difficulty to unlock beatmap options.');

  const songs = useMemo(() => {
    if (activeTab === 'builtin') return BUILT_IN_SONGS;
    if (activeTab === 'personal') return personalSongs;
    if (activeTab === 'rhythm-ai') return RHYTHM_AI_SONGS;
    if (activeTab === 'youtube') return YOUTUBE_SONGS;
    return YT_MP3_SONGS;
  }, [activeTab, personalSongs]);

  const selectedSong = useMemo(() => songs.find((song) => song.id === selectedSongId) ?? null, [songs, selectedSongId]);
  const canOpenBeatmapOptions = Boolean(selectedSong && selectedDifficulty);

  const handleTabChange = useCallback((tab: NavigationTab) => {
    setActiveTab(tab);
    setSelectedSongId(null);
    setUiMessage('Select a song and difficulty to unlock beatmap options.');
  }, []);

  const handleUploadFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('audio/'));

    if (!files.length) {
      setUiMessage('No supported audio files were selected.');
      return;
    }

    const mapped = files.map((file) => ({
      id: `personal-${Date.now()}-${file.name}`,
      name: fileNameToTitle(file.name),
      source: 'personal' as const,
      file,
    }));

    setPersonalSongs((prev) => [...mapped, ...prev]);
    setActiveTab('personal');
    setSelectedSongId(mapped[0].id);
    setUiMessage(`${mapped.length} personal song(s) added.`);

    event.currentTarget.value = '';
  }, []);

  const handleCreateBeatmap = useCallback(() => {
    if (!canOpenBeatmapOptions || !selectedSong || !selectedDifficulty) return;
    setUiMessage(`Beatmap options ready for ${selectedSong.name} (${selectedDifficulty}).`);
  }, [canOpenBeatmapOptions, selectedDifficulty, selectedSong]);

  // Keep existing game flow available from this UI when audio is playable.
  const handleStartGame = useCallback(async () => {
    if (!selectedSong || !selectedDifficulty) return;

    if (selectedSong.file) {
      onStartGame(selectedSong.file, selectedDifficulty, selectedSong.id, selectedSong.name);
      return;
    }

    if (selectedSong.path) {
      const response = await fetch(selectedSong.path);
      if (!response.ok) {
        setUiMessage(`Could not load ${selectedSong.name}.`);
        return;
      }
      const blob = await response.blob();
      const file = new File([blob], selectedSong.path.split('/').pop() ?? 'song.mp3', { type: blob.type || 'audio/mpeg' });
      onStartGame(file, selectedDifficulty, selectedSong.id, selectedSong.name);
      return;
    }

    setUiMessage('This tab is UI-only for now. Pick a Built In or Personal song to continue.');
  }, [onStartGame, selectedDifficulty, selectedSong]);

  return (
    <div className="rounded-2xl border border-game-border bg-game-surface p-4 md:p-6">
      <header className="mb-4 space-y-2">
        <h1 className="text-2xl font-bold">Rhythm Game Selection</h1>
        <p className="text-sm text-game-muted">Use keyboard arrows in tabs, song list, and difficulty list for fast navigation.</p>
      </header>

      <TopNavTabs activeTab={activeTab} onTabChange={handleTabChange} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div id={`tab-panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="space-y-4">
          <div className="rounded-xl border border-dashed border-game-border bg-game-panel p-3">
            <label htmlFor="personal-upload" className="block text-sm text-game-text">
              Upload audio files (Personal tab)
            </label>
            <input
              id="personal-upload"
              type="file"
              accept="audio/*"
              multiple
              onChange={handleUploadFiles}
              className="mt-2 w-full cursor-pointer rounded-md border border-game-border bg-game-surface p-2 text-sm text-game-text file:mr-3 file:rounded file:border-0 file:bg-game-accent file:px-3 file:py-1 file:text-sm file:font-medium file:text-slate-900 hover:file:bg-game-accentStrong"
              aria-label="Upload personal songs"
            />
          </div>

          <SongListPanel
            songs={songs}
            selectedSongId={selectedSongId}
            onSongSelect={(song) => setSelectedSongId(song.id)}
            panelId={`song-panel-${activeTab}`}
            emptyMessage="No songs in this tab yet."
            bestRecords={bestRecords}
          />
        </div>

        <div className="space-y-4">
          <DifficultyPanel selectedDifficulty={selectedDifficulty} onDifficultySelect={setSelectedDifficulty} />

          <BeatmapOptionsPanel
            enabled={canOpenBeatmapOptions}
            isLoading={isLoading}
            songName={selectedSong?.name ?? ''}
            difficultyName={selectedDifficulty ?? ''}
            onCreateBeatmap={handleCreateBeatmap}
          />

          <button
            type="button"
            disabled={!canOpenBeatmapOptions || isLoading}
            onClick={handleStartGame}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Start game with selected song and difficulty"
          >
            {isLoading ? 'Analyzing...' : 'Start Game'}
          </button>
        </div>
      </div>

      <p className="mt-4 rounded-md border border-game-border bg-game-panel px-3 py-2 text-sm text-game-muted" aria-live="polite">
        {uiMessage}
      </p>
    </div>
  );
});

SongSelect.displayName = 'SongSelect';
