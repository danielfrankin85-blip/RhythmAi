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
  { id: 'b12', name: 'Epstein F**k N***a', path: '/music/epstein_fuck_nigga_%23smokingepsteinpackheburnin_320k.mp3' },
  { id: 'b13', name: 'Lil Tecca - Dark Thoughts', path: '/music/Lil_Tecca_-_Dark_Thoughts_(Official_Video)_320k.mp3' },
  { id: 'b14', name: 'Picasso Mixx', path: '/music/SpotiDownloader.com%20-%20picasso%20mixx%20-%20DJ%20CIGAN%20EXLUSIVES.mp3' },
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

// ── Component ────────────────────────────────────────────────────────────────

interface SongSelectProps {
  onStartGame: (file: File, difficulty: Difficulty) => void;
  isLoading: boolean;
}

export const SongSelect = memo<SongSelectProps>(({ onStartGame, isLoading }) => {
  const [selectedSong, setSelectedSong] = useState<SongEntry | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isFetching, setIsFetching] = useState(false);
  const [customSongs, setCustomSongs] = useState<StoredSong[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [tab, setTab] = useState<'library' | 'custom'>('library');
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

      onStartGame(file, difficulty);
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
      <div className="song-select__header">
        <h2 className="song-select__title">Select Your Song</h2>
        <p className="song-select__description">
          Pick a built-in song or upload your own — the AI analyzes any audio and generates a beatmap
        </p>
      </div>

      {/* ── Upload zone (drag-and-drop + button) ─────────────────────────── */}
      <div
        className={`song-upload ${isDragging ? 'song-upload--dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="song-upload__icon">📂</div>
        <div className="song-upload__text">
          Drag & drop audio files here, or{' '}
          <button
            type="button"
            className="song-upload__browse"
            onClick={() => fileInputRef.current?.click()}
          >
            browse files
          </button>
        </div>
        <div className="song-upload__hint">
          MP3, WAV, OGG, FLAC, AAC, M4A — any audio file works
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

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="song-tabs">
        <button
          className={`song-tabs__tab ${tab === 'library' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('library')}
        >
          🎵 Built-in ({builtinEntries.length})
        </button>
        <button
          className={`song-tabs__tab ${tab === 'custom' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('custom')}
        >
          📁 My Songs ({customEntries.length})
        </button>
      </div>

      {/* ── Song list ────────────────────────────────────────────────────── */}
      <div className="song-list">
        {displayList.length === 0 && tab === 'custom' && (
          <div className="song-list__empty">
            No uploaded songs yet — drop an audio file above to get started!
          </div>
        )}
        {displayList.map((song) => (
          <button
            key={song.id}
            className={`song-list__item ${selectedSong?.id === song.id ? 'selected' : ''}`}
            onClick={() => setSelectedSong(song)}
          >
            <div className="song-list__icon">{song.type === 'builtin' ? '🎵' : '📁'}</div>
            <div className="song-list__info">
              <div className="song-list__name">{song.name}</div>
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
        ))}
      </div>

      {selectedSong && (
        <>
          <DifficultySelect selected={difficulty} onSelect={setDifficulty} />

          <button
            className="btn btn-success"
            onClick={handleStart}
            disabled={isLoading || isFetching}
            style={{ width: '100%', marginTop: '1rem' }}
          >
            {isFetching ? 'Loading Song...' : isLoading ? 'Analyzing Audio & Generating Beatmap...' : '▶ Start Game'}
          </button>
        </>
      )}
    </div>
  );
});

SongSelect.displayName = 'SongSelect';
