import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';
import { DifficultySelect } from './DifficultySelect';

// ── IndexedDB helpers for persisting uploaded songs ──────────────────────────

const DB_NAME = 'RhythmGameSongs';
const DB_VERSION = 1;
const STORE_NAME = 'songs';

interface StoredSong {
  id: string;
  name: string;
  blob: Blob;
  addedAt: number;
  size: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllStoredSongs(): Promise<StoredSong[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function storeSong(song: StoredSong): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(song);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteSong(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Built-in songs (shipped with the game) ──────────────────────────────────

const BUILTIN_SONGS = [
  { id: 'b1',  name: 'Central Cee - Booga', path: '/music/Central_Cee_-_Booga_(Lyrics)_320k.mp3' },
  { id: 'b2',  name: 'Don Toliver - FWU', path: '/music/Don_Toliver_-_FWU_(AUDIO)_320k.mp3' },
  { id: 'b3',  name: 'Lil Uzi Vert - What You Saying', path: '/music/Lil_Uzi_Vert_-_What_You_Saying_(Lyrics)_320k.mp3' },
  { id: 'b4',  name: 'Playboi Carti - Kelly K', path: '/music/Playboi_Carti_-_Kelly_K_(Audio)_320k.mp3' },
  { id: 'b5',  name: 'PUT IT ONG', path: '/music/PUT_IT_ONG_320k.mp3' },
  { id: 'b6',  name: 'The Weeknd, Playboi Carti - Timeless', path: '/music/The_Weeknd%2C_Playboi_Carti_-_Timeless_(Audio)_320k.mp3' },
  { id: 'b7',  name: 'Lost Umbrella (ロストアンブレラ)', path: '/music/%E7%A8%B2%E8%91%89%E6%9B%87%E3%80%8E%E3%83%AD%E3%82%B9%E3%83%88%E3%82%A2%E3%83%B3%E3%83%96%E3%83%AC%E3%83%A9%E3%80%8FVo._%E6%AD%8C%E6%84%9B%E3%83%A6%E3%82%AD_320k.mp3' },
  { id: 'b8',  name: 'Like Him', path: '/music/Like_Him_320k.mp3' },
  { id: 'b9',  name: 'F-L-Y - Spectrum', path: '/music/Spectrum_%5B%E3%82%B9%E3%83%9A%E3%82%AF%E3%83%88%E3%83%A9%E3%83%A0%5D_-_F-L-Y_(1980)_320k.mp3' },
  { id: 'b10', name: 'NIWA - Teno and More', path: '/music/NIWA_FULL_SHOWCASE_-_Teno_and_More_320k.mp3' },
  { id: 'b11', name: 'Slava Song', path: '/music/Omer_Adam_feat._Arisa_-_Tel_Aviv_320k.mp3' },
  { id: 'b13', name: 'Lil Tecca - Dark Thoughts', path: '/music/Lil_Tecca_-_Dark_Thoughts_(Official_Video)_320k.mp3' },
  { id: 'b15', name: 'Airplane Mode', path: '/music/Airplane_Mode_320k.mp3' },
  { id: 'b16', name: "ANRI - I Can't Stop The Loneliness", path: '/music/ANRI_-_I_Can%27t_Stop_The_Loneliness_320k.mp3' },
  { id: 'b17', name: 'Hi-Fi Set - Sky Restaurant', path: '/music/Hi_Fi_Set_-_Sky_Restaurant_320k.mp3' },
  { id: 'b18', name: 'Imogen Heap - Headlock', path: '/music/Imogen_Heap_-_Headlock_(Lyrics)_320k.mp3' },
  { id: 'b19', name: 'RAYE - Where Is My Husband', path: '/music/RAYE_-_Where_Is_My_Husband_320k.mp3' },
  { id: 'b20', name: 'Emotional Prism', path: '/music/%E3%83%9F%E3%82%AB%E3%83%85%E3%82%ADBIGWAVE_-_Emotional_Prism_%E6%84%9F%E6%83%85%E7%9A%84%E3%81%AA%E3%83%97%E3%83%AA%E3%82%BA%E3%83%A0_320k.mp3' },
  { id: 'b21', name: 'Yasuha - Flyday Chinatown', path: '/music/Yasuha_-_Flyday_Chinatown_320k.mp3' },
];

// ── Types ────────────────────────────────────────────────────────────────────

type SongEntry =
  | { type: 'builtin'; id: string; name: string; path: string }
  | { type: 'custom';  id: string; name: string; blob: Blob; size: number };

const ACCEPTED_AUDIO_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
  'audio/flac', 'audio/aac', 'audio/webm', 'audio/mp4',
  'audio/x-m4a', 'audio/m4a',
];

const ACCEPTED_EXTENSIONS = [
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.webm', '.m4a', '.mp4',
];

function isAudioFile(file: File): boolean {
  if (ACCEPTED_AUDIO_TYPES.includes(file.type)) return true;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function prettySongName(filename: string): string {
  // Strip common suffixes and extensions, replace underscores/dashes with spaces
  return filename
    .replace(/\.[^.]+$/, '')            // strip extension
    .replace(/_320k$/i, '')             // strip bitrate tag
    .replace(/[_]+/g, ' ')             // underscores → spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Color palette for song cards (no light blue)
const SONG_COLORS = [
  '#FF6B6B', // coral
  '#FFA94D', // orange
  '#FFD93D', // gold
  '#69DB7C', // green
  '#DA77F2', // violet
  '#F783AC', // pink
  '#38D9A9', // teal
  '#A9E34B', // lime
  '#FFB347', // tangerine
  '#845EF7', // purple
  '#FF8787', // light red
  '#E599F7', // lavender
  '#63E6BE', // mint
  '#FFC078', // peach
  '#C0EB75', // yellow-green
  '#FF922B', // dark orange
  '#B197FC', // soft purple
  '#FCC419', // amber
  '#20C997', // seafoam
  '#FAB005', // deep gold
];

// ── Component ────────────────────────────────────────────────────────────────

interface SongSelectProps {
  onStartGame: (file: File, difficulty: Difficulty, songId: string, songName: string) => void;
  isLoading: boolean;
  bestRecords: Record<string, { bestScore: number; bestAccuracy: number }>;
  bestRecordsByDifficulty: Record<string, Partial<Record<Difficulty, { bestScore: number; bestAccuracy: number }>>>;
}

export const SongSelect = memo<SongSelectProps>(({ onStartGame, isLoading, bestRecords, bestRecordsByDifficulty }) => {
  const [selectedSong, setSelectedSong] = useState<SongEntry | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isFetching, setIsFetching] = useState(false);
  const [customSongs, setCustomSongs] = useState<StoredSong[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [tab, setTab] = useState<'library' | 'custom' | 'youtube' | 'ytmp3'>('library');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load persisted custom songs from IndexedDB on mount
  useEffect(() => {
    getAllStoredSongs()
      .then((songs) => setCustomSongs(songs.sort((a, b) => b.addedAt - a.addedAt)))
      .catch((err) => console.warn('Could not load stored songs:', err));
  }, []);

  // ── Add files (from input or drop) ────────────────────────────────────
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(isAudioFile);
    if (audioFiles.length === 0) {
      alert('No supported audio files found.\n\nSupported formats: MP3, WAV, OGG, FLAC, AAC, M4A, WebM');
      return;
    }

    const newSongs: StoredSong[] = [];
    for (const f of audioFiles) {
      const song: StoredSong = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: prettySongName(f.name),
        blob: f,
        addedAt: Date.now(),
        size: f.size,
      };
      await storeSong(song);
      newSongs.push(song);
    }

    setCustomSongs((prev) => [...newSongs, ...prev]);

    // Auto-select the first uploaded song and switch to custom tab
    if (newSongs.length > 0) {
      setTab('custom');
      const s = newSongs[0];
      setSelectedSong({ type: 'custom', id: s.id, name: s.name, blob: s.blob, size: s.size });
    }
  }, []);

  // ── File input handler ────────────────────────────────────────────────
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // reset so same file can be re-added
    }
  }, [addFiles]);

  // ── Drag & drop handlers ──────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  // ── Delete a custom song ──────────────────────────────────────────────
  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteSong(id);
    setCustomSongs((prev) => prev.filter((s) => s.id !== id));
    if (selectedSong?.id === id) setSelectedSong(null);
  }, [selectedSong]);

  // ── Play selected song ────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!selectedSong || isFetching) return;

    try {
      setIsFetching(true);

      let file: File;

      if (selectedSong.type === 'builtin') {
        const response = await fetch(selectedSong.path);
        if (!response.ok) {
          throw new Error(`Failed to load song: HTTP ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        file = new File([blob], selectedSong.path.split('/').pop() || 'song.mp3', {
          type: 'audio/mpeg',
        });
      } else {
        // Custom song — blob is already in memory / IndexedDB
        file = new File([selectedSong.blob], `${selectedSong.name}.mp3`, {
          type: selectedSong.blob.type || 'audio/mpeg',
        });
      }

      onStartGame(file, difficulty, selectedSong.id, selectedSong.name);
    } catch (err) {
      console.error('Failed to load song:', err);
      alert(`Error loading song: ${(err as Error).message}`);
    } finally {
      setIsFetching(false);
    }
  }, [selectedSong, difficulty, onStartGame, isFetching]);

  // ── Build display lists ───────────────────────────────────────────────

  const builtinEntries: SongEntry[] = BUILTIN_SONGS.map((s) => ({
    type: 'builtin' as const,
    ...s,
  }));

  const customEntries: SongEntry[] = customSongs.map((s) => ({
    type: 'custom' as const,
    id: s.id,
    name: s.name,
    blob: s.blob,
    size: s.size,
  }));

  const displayList = tab === 'library' ? builtinEntries : customEntries;

  return (
    <div className="song-select">
      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="song-tabs">
        <button
          className={`song-tabs__tab ${tab === 'library' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('library')}
        >
          Built in
        </button>
        <button
          className={`song-tabs__tab ${tab === 'custom' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('custom')}
        >
          Personal
        </button>
        <div className="song-tabs__brand">Rhythm AI</div>
        <button
          className={`song-tabs__tab ${tab === 'youtube' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('youtube')}
        >
          youtube
        </button>
        <button
          className={`song-tabs__tab ${tab === 'ytmp3' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('ytmp3')}
        >
          youtube to mp3
        </button>
      </div>

      {/* ── YouTube tab ───────────────────────────────────────────────── */}
      {tab === 'youtube' && (
        <div className="yt-panel">
          <div className="yt-panel__header">Youtube (under construction ⚠️)</div>
          <div className="yt-panel__body" />
        </div>
      )}

      {/* ── YT to MP3 tab ───────────────────────────────────────────────── */}
      {tab === 'ytmp3' && (
        <div className="yt-panel">
          <div className="yt-panel__header">Youtube to mp3</div>
          <div className="yt-panel__body" />
        </div>
      )}

      {/* ── Two-column layout for library / custom ────────────────────── */}
      {(tab === 'library' || tab === 'custom') && (
        <div className="song-layout">
          {/* Left: songs */}
          <div className="song-layout__left">
            <div className="song-layout__header">songs</div>

            {/* Upload zone (custom tab only) */}
            {tab === 'custom' && (
              <div
                className={`song-upload song-upload--compact ${isDragging ? 'song-upload--dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="song-upload__text">
                  Drop files or{' '}
                  <button
                    type="button"
                    className="song-upload__browse"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    browse
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  className="song-upload__hidden-input"
                  onChange={handleFileInput}
                />
              </div>
            )}

            <div className="song-list">
              {displayList.length === 0 && tab === 'custom' && (
                <div className="song-list__empty">
                  No uploaded songs yet — drop an audio file above!
                </div>
              )}
              {displayList.map((song, index) => {
                const isSelected = selectedSong?.id === song.id;
                return (
                  <div key={song.id} className="song-list__entry">
                    <button
                      className={`song-list__item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedSong(song)}
                      style={{ backgroundColor: SONG_COLORS[index % SONG_COLORS.length] }}
                    >
                      <div className="song-list__info">
                        <div className="song-list__name">{song.name}</div>
                        {bestRecords[song.id] && (
                          <div className="song-list__best">
                            Best: {bestRecords[song.id].bestScore.toLocaleString()} • {bestRecords[song.id].bestAccuracy.toFixed(2)}%
                          </div>
                        )}
                        {song.type === 'custom' && (
                          <div className="song-list__meta">{formatFileSize(song.size)}</div>
                        )}
                      </div>
                      {song.type === 'custom' && (
                        <button
                          className="song-list__delete"
                          title="Remove song"
                          onClick={(e) => handleDelete(e, song.id)}
                        >
                          ✕
                        </button>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: difficulty */}
          <div className="song-layout__right">
            <div className="song-layout__header">difficulty</div>

            <DifficultySelect
              selected={difficulty}
              onSelect={setDifficulty}
              bestByDifficulty={selectedSong ? bestRecordsByDifficulty[selectedSong.id] : undefined}
            />

            <button
              className="btn btn-success"
              onClick={handleStart}
              disabled={!selectedSong || isLoading || isFetching}
              style={{ width: '100%', marginTop: '0.5rem' }}
            >
              {isFetching ? 'Loading Song...' : isLoading ? 'Analyzing…' : '▶ Start Game'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

SongSelect.displayName = 'SongSelect';
