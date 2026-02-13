import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';
import { DifficultySelect } from './DifficultySelect';

// ── YouTube helpers ──────────────────────────────────────────────────────────

/** Extract a YouTube video ID from any common URL format */
function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  // Direct ID (11 chars, alphanumeric + - + _)
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    // youtu.be/<id>
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    // youtube.com/watch?v=<id>
    const v = url.searchParams.get('v');
    if (v) return v;
    // youtube.com/embed/<id> or /shorts/<id>
    const parts = url.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) return parts[1];
  } catch { /* not a valid URL — fall through */ }

  // Regex fallback
  const match = trimmed.match(/(?:v=|\/|embed\/|shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Public Piped / Invidious instances we try in order (all have CORS support) */
// Proxied through our own /api/youtube serverless route to avoid CORS issues

interface YTStreamResult {
  title: string;
  audioUrl: string;
  duration: number; // seconds
}

async function fetchYouTubeAudio(videoId: string): Promise<YTStreamResult> {
  // Call our own serverless proxy which fetches Piped/Invidious server-side
  const resp = await fetch(`/api/youtube?v=${encodeURIComponent(videoId)}`, {
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(
      body.error ||
      'Could not extract audio from this YouTube video.\n\n' +
      'All proxy servers are currently unavailable or the video is restricted.\n' +
      'Try again in a moment, or paste a different link.'
    );
  }

  const data = await resp.json();
  return {
    title: data.title ?? `YouTube – ${videoId}`,
    audioUrl: data.audioUrl,
    duration: data.duration ?? 0,
  };
}

async function downloadYouTubeBlob(audioUrl: string): Promise<Blob> {
  // Route through our own serverless proxy to avoid CORS on the audio stream
  const resp = await fetch(`/api/youtube-download?url=${encodeURIComponent(audioUrl)}`, {
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    throw new Error('Failed to download the audio stream. The video may be geo-restricted or too large.');
  }

  return await resp.blob();
}

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
  const [tab, setTab] = useState<'library' | 'custom' | 'youtube'>('library');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // YouTube-specific state
  const [ytUrl, setYtUrl] = useState('');
  const [ytStatus, setYtStatus] = useState<'idle' | 'resolving' | 'downloading' | 'error'>('idle');
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytTitle, setYtTitle] = useState<string | null>(null);

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

  // ── YouTube link handler ──────────────────────────────────────────────
  const handleYouTubeLoad = useCallback(async () => {
    const videoId = extractYouTubeId(ytUrl);
    if (!videoId) {
      setYtError('Invalid YouTube URL. Paste a link like https://youtube.com/watch?v=... or https://youtu.be/...');
      setYtStatus('error');
      return;
    }

    try {
      setYtStatus('resolving');
      setYtError(null);
      setYtTitle(null);

      // Step 1: Resolve stream URL
      const result = await fetchYouTubeAudio(videoId);
      setYtTitle(result.title);
      setYtStatus('downloading');

      // Step 2: Download the audio blob
      const blob = await downloadYouTubeBlob(result.audioUrl);

      // Step 3: Persist to IndexedDB like a regular custom song
      const song: StoredSong = {
        id: `yt-${videoId}-${Date.now()}`,
        name: result.title,
        blob,
        addedAt: Date.now(),
        size: blob.size,
      };
      await storeSong(song);
      setCustomSongs((prev) => [song, ...prev]);

      // Auto-select and jump to custom tab
      setSelectedSong({ type: 'custom', id: song.id, name: song.name, blob: song.blob, size: song.size });
      setTab('custom');
      setYtStatus('idle');
      setYtUrl('');
      setYtTitle(null);
    } catch (err) {
      setYtError((err as Error).message);
      setYtStatus('error');
    }
  }, [ytUrl]);

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
        <button
          className={`song-tabs__tab ${tab === 'youtube' ? 'song-tabs__tab--active' : ''}`}
          onClick={() => setTab('youtube')}
        >
          ▶ YouTube
        </button>
      </div>

      {/* ── YouTube link input ───────────────────────────────────────────── */}
      {tab === 'youtube' && (
        <div className="yt-section">
          <div className="yt-section__header">
            <div className="yt-section__icon">▶</div>
            <div>
              <div className="yt-section__title">Import from YouTube</div>
              <div className="yt-section__subtitle">
                Paste any YouTube link — the AI will extract the audio, analyze it, and generate a beatmap
              </div>
            </div>
          </div>

          <div className="yt-section__input-row">
            <input
              type="text"
              className="yt-section__input"
              placeholder="https://youtube.com/watch?v=... or https://youtu.be/..."
              value={ytUrl}
              onChange={(e) => { setYtUrl(e.target.value); setYtError(null); setYtStatus('idle'); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && ytUrl.trim() && ytStatus === 'idle') handleYouTubeLoad(); }}
              disabled={ytStatus === 'resolving' || ytStatus === 'downloading'}
            />
            <button
              className="yt-section__btn"
              onClick={handleYouTubeLoad}
              disabled={!ytUrl.trim() || ytStatus === 'resolving' || ytStatus === 'downloading'}
            >
              {ytStatus === 'resolving' ? '🔍 Resolving...'
                : ytStatus === 'downloading' ? '⬇ Downloading...'
                : '🎵 Load Song'}
            </button>
          </div>

          {ytTitle && ytStatus === 'downloading' && (
            <div className="yt-section__progress">
              <div className="yt-section__progress-spinner" />
              <span>Downloading: <strong>{ytTitle}</strong></span>
            </div>
          )}

          {ytStatus === 'resolving' && (
            <div className="yt-section__progress">
              <div className="yt-section__progress-spinner" />
              <span>Finding audio stream…</span>
            </div>
          )}

          {ytError && (
            <div className="yt-section__error">
              ⚠ {ytError}
            </div>
          )}

          <div className="yt-section__tips">
            <strong>Tips:</strong>
            <ul>
              <li>Works with regular videos, Shorts, and music videos</li>
              <li>The song is saved to "My Songs" after download</li>
              <li>Some region-locked or age-restricted videos may not work</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Song list ────────────────────────────────────────────────────── */}
      {tab !== 'youtube' && (
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
      )}

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
