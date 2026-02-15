import { memo, useCallback, useMemo, useState, useEffect, type ChangeEvent, type DragEvent } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';

/* ── Song source tab type ─────────────────────────────────────────────── */
type SongTab = 'builtin' | 'personal' | 'youtube' | 'yt-mp3';

interface SongEntry {
  id: string;
  name: string;
  source: SongTab;
  path?: string;
  file?: File;
}

interface PersonalSongRecord {
  id: string;
  name: string;
  file: File;
}

const PERSONAL_DB_NAME = 'rhythm-game-personal-songs';
const PERSONAL_DB_VERSION = 1;
const PERSONAL_STORE_NAME = 'songs';

function openPersonalSongsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PERSONAL_DB_NAME, PERSONAL_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PERSONAL_STORE_NAME)) {
        db.createObjectStore(PERSONAL_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadPersonalSongsFromDb(): Promise<SongEntry[]> {
  const db = await openPersonalSongsDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PERSONAL_STORE_NAME, 'readonly');
    const store = transaction.objectStore(PERSONAL_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = (request.result as PersonalSongRecord[]) ?? [];
      resolve(
        records.map((record) => ({
          id: record.id,
          name: record.name,
          source: 'personal' as const,
          file: record.file,
        }))
      );
    };

    request.onerror = () => reject(request.error);
  });
}

async function savePersonalSongsToDb(songs: SongEntry[]): Promise<void> {
  const db = await openPersonalSongsDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PERSONAL_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(PERSONAL_STORE_NAME);

    store.clear();
    songs.forEach((song) => {
      if (song.file) {
        store.put({ id: song.id, name: song.name, file: song.file } satisfies PersonalSongRecord);
      }
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ── Song data ────────────────────────────────────────────────────────── */
const BUILT_IN_SONGS: SongEntry[] = [
  { id: 'b1', name: 'Airplane Mode', source: 'builtin', path: '/music/Airplane_Mode_320k.mp3' },
  { id: 'b2', name: 'ANRI - I Can\'t Stop The Loneliness', source: 'builtin', path: '/music/ANRI_-_I_Can\'t_Stop_The_Loneliness_320k.mp3' },
  { id: 'b3', name: 'Central Cee - Booga', source: 'builtin', path: '/music/Central_Cee_-_Booga_(Lyrics)_320k.mp3' },
  { id: 'b4', name: 'Don Toliver - FWU', source: 'builtin', path: '/music/Don_Toliver_-_FWU_(AUDIO)_320k.mp3' },
  { id: 'b5', name: 'Hi Fi Set - Sky Restaurant', source: 'builtin', path: '/music/Hi_Fi_Set_-_Sky_Restaurant_320k.mp3' },
  { id: 'b6', name: 'Imogen Heap - Headlock', source: 'builtin', path: '/music/Imogen_Heap_-_Headlock_(Lyrics)_320k.mp3' },
  { id: 'b7', name: 'Like Him', source: 'builtin', path: '/music/Like_Him_320k.mp3' },
  { id: 'b8', name: 'Lil Tecca - Dark Thoughts', source: 'builtin', path: '/music/Lil_Tecca_-_Dark_Thoughts_(Official_Video)_320k.mp3' },
  { id: 'b9', name: 'Lil Uzi Vert - What You Saying', source: 'builtin', path: '/music/Lil_Uzi_Vert_-_What_You_Saying_(Lyrics)_320k.mp3' },
  { id: 'b10', name: 'NIWA FULL SHOWCASE - Teno and More', source: 'builtin', path: '/music/NIWA_FULL_SHOWCASE_-_Teno_and_More_320k.mp3' },
  { id: 'b11', name: 'Playboi Carti - Kelly K', source: 'builtin', path: '/music/Playboi_Carti_-_Kelly_K_(Audio)_320k.mp3' },
  { id: 'b12', name: 'PUT IT ONG', source: 'builtin', path: '/music/PUT_IT_ONG_320k.mp3' },
  { id: 'b13', name: 'RAYE - Where Is My Husband', source: 'builtin', path: '/music/RAYE_-_Where_Is_My_Husband_320k.mp3' },
  { id: 'b14', name: 'Spectrum [スペクトラム] - F-L-Y', source: 'builtin', path: '/music/Spectrum_[スペクトラム]_-_F-L-Y_(1980)_320k.mp3' },
  { id: 'b15', name: 'The Weeknd, Playboi Carti - Timeless', source: 'builtin', path: '/music/The_Weeknd,_Playboi_Carti_-_Timeless_(Audio)_320k.mp3' },
  { id: 'b16', name: 'Yasuha - Flyday Chinatown', source: 'builtin', path: '/music/Yasuha_-_Flyday_Chinatown_320k.mp3' },
  { id: 'b17', name: 'ミカヅキBIGWAVE - Emotional Prism', source: 'builtin', path: '/music/ミカヅキBIGWAVE_-_Emotional_Prism_感情的なプリズム_320k.mp3' },
  { id: 'b18', name: '稲葉曇『ロストアンブレラ』', source: 'builtin', path: '/music/稲葉曇『ロストアンブレラ』Vo._歌愛ユキ_320k.mp3' },
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
  { id: 'youtube', label: 'YouTube' },
  { id: 'yt-mp3', label: 'YouTube to MP3' },
];

const DIFFICULTIES: { value: Difficulty; label: string; color: string }[] = [
  { value: 'easy', label: 'Easy', color: 'bg-green-500 hover:bg-green-400' },
  { value: 'medium', label: 'Medium', color: 'bg-orange-500 hover:bg-orange-400' },
  { value: 'hard', label: 'Hard', color: 'bg-red-500 hover:bg-red-400' },
  { value: 'extreme', label: 'Extreme', color: 'bg-purple-500 hover:bg-purple-400' },
  { value: 'deadly', label: 'Deadly', color: 'bg-red-900 hover:bg-red-800' },
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
  const [isDragOver, setIsDragOver] = useState(false);

  // Load personal songs from IndexedDB on mount
  useEffect(() => {
    loadPersonalSongsFromDb()
      .then((songsFromDb) => setPersonalSongs(songsFromDb))
      .catch((error) => console.error('Failed to load personal songs from IndexedDB', error));
  }, []);

  // Save personal songs to IndexedDB whenever they change
  useEffect(() => {
    savePersonalSongsToDb(personalSongs).catch((error) =>
      console.error('Failed to save personal songs to IndexedDB', error)
    );
  }, [personalSongs]);

  /* Derived */
  const songs = useMemo(() => {
    if (activeTab === 'builtin') return BUILT_IN_SONGS;
    if (activeTab === 'personal') return personalSongs;
    if (activeTab === 'youtube') return YOUTUBE_SONGS;
    return YT_MP3_SONGS;
  }, [activeTab, personalSongs]);

  const selectedSong = useMemo(() => songs.find((s) => s.id === selectedSongId) ?? null, [songs, selectedSongId]);
  const canStart = Boolean(selectedSong && selectedDifficulty && (selectedSong.file || selectedSong.path));

  /* Handlers */
  const handleTabChange = useCallback((tab: SongTab) => {
    setActiveTab(tab);
    setSelectedSongId(null);
    setSelectedDifficulty(null);
  }, []);

  const addPersonalFiles = useCallback((files: File[]) => {
    const audioFiles = files.filter((file) => file.type.startsWith('audio/'));
    if (!audioFiles.length) return;

    const mapped: SongEntry[] = audioFiles.map((file) => ({
      id: `personal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${file.name}`,
      name: fileNameToTitle(file.name),
      source: 'personal' as const,
      file,
    }));

    setPersonalSongs((prev) => [...mapped, ...prev]);
    setActiveTab('personal');
    setSelectedSongId(mapped[0].id);
    setSelectedDifficulty(null);
  }, []);

  const handleUploadFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    addPersonalFiles(files);
    event.currentTarget.value = '';
  }, [addPersonalFiles]);

  const handleDropUpload = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    addPersonalFiles(droppedFiles);
  }, [addPersonalFiles]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleStartGame = useCallback(async () => {
    if (!selectedSong || !selectedDifficulty) return;

    // Handle personal songs with File objects
    if (selectedSong.file) {
      onStartGame(selectedSong.file, selectedDifficulty, selectedSong.id, selectedSong.name);
      return;
    }

    // Handle built-in songs with paths
    if (selectedSong.path) {
      try {
        const response = await fetch(selectedSong.path);
        if (!response.ok) {
          console.error('Failed to load song:', selectedSong.name);
          return;
        }
        const blob = await response.blob();
        const file = new File([blob], selectedSong.path.split('/').pop() ?? 'song.mp3', { type: blob.type || 'audio/mpeg' });
        onStartGame(file, selectedDifficulty, selectedSong.id, selectedSong.name);
      } catch (error) {
        console.error('Error loading song:', error);
      }
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

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropUpload}
        className={`mb-6 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition ${
          isDragOver
            ? 'border-sky-300 bg-sky-500/20 text-white'
            : 'border-gray-600 bg-game-panel/40 text-gray-300'
        }`}
      >
        Drag and drop an audio file here to upload into Personal. Then choose difficulty and Start to let AI analyze and create the beatmap.
      </div>

      {/* ── Main area: songs LEFT ↔ difficulty RIGHT ── */}
      <div className="flex flex-1 gap-10 lg:gap-20">

        {/* ── LEFT: Song list ── */}
        <section className="flex-1" style={{ overflow: 'visible' }}>
          <h2 className="mb-5 text-lg font-semibold text-white">Songs</h2>

          <div className="song-list flex flex-col gap-4 overflow-y-auto overflow-x-visible pr-8" style={{ maxHeight: '70vh' }}>
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
                    group relative rounded-xl border-2 bg-white px-5 py-5
                    text-left text-black shadow-sm
                    max-w-[320px] w-full
                    transition-all duration-300 ease-out
                    hover:shadow-lg hover:z-10
                    focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-game-bg
                    ${isSelected
                      ? 'border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                      : 'border-black/80 hover:border-black'}
                  `}
                  style={{
                    minHeight: '80px'
                  }}
                  aria-pressed={isSelected}
                >
                  <span className="block text-base font-black leading-tight" style={{ fontFamily: 'Comic Sans MS, Chalkboard SE, Comic Neue, cursive' }}>{song.name}</span>
                  {record && (
                    <span className="mt-2 block text-xs text-gray-500 font-medium">
                      Best: {record.bestScore.toLocaleString()} · {record.bestAccuracy.toFixed(2)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── RIGHT: Difficulty + Start (only show when song selected) ── */}
        {selectedSongId && (
          <aside className="w-72 shrink-0" style={{ zIndex: 1 }}>
            <h2 className="mb-5 text-lg font-semibold text-white">Difficulty</h2>

            <div className="flex flex-col gap-3">
              {DIFFICULTIES.map((d) => {
                const isActive = d.value === selectedDifficulty;
                return (
                  <button
                    key={d.value}
                    onClick={() => setSelectedDifficulty(d.value)}
                    className={`
                      rounded-xl border-2 px-5 py-4 text-left text-base font-bold uppercase tracking-wider text-white
                      transition-all duration-200 ease-out
                      hover:-translate-y-0.5 hover:shadow-md
                      ${isActive
                        ? `${d.color} border-white shadow-[0_0_12px_rgba(255,255,255,0.4)]`
                        : 'border-gray-600 bg-game-panel hover:border-white'}
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
              className="mt-8 w-full rounded-xl bg-emerald-500 px-5 py-4 text-base font-bold uppercase tracking-wide text-black transition hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Start game with selected song and difficulty"
              style={{ pointerEvents: (!canStart || isLoading) ? 'none' : 'auto' }}
            >
              {isLoading ? 'Analyzing…' : 'Start Game'}
            </button>
          </aside>
        )}
      </div>
    </div>
  );
});

SongSelect.displayName = 'SongSelect';
