import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';
import { DifficultySelect } from './DifficultySelect';

// ── YouTube helpers ──────────────────────────────────────────────────────────

/** Public Piped / Invidious instances we try in order (all have CORS support) */
// Proxied through our own /api/youtube serverless route to avoid CORS issues

interface YTStreamResult {
  title: string;
  audioUrl: string;
  duration: number; // seconds
}

async function fetchYouTubeAudio(videoId: string, apiKey?: string): Promise<YTStreamResult> {
  // If user has API key, use official YouTube Data API (more reliable)
  if (apiKey && apiKey.trim()) {
    const resp = await fetch(
      `/api/youtube-auth?v=${encodeURIComponent(videoId)}&apiKey=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(30000) }
    );

    const contentType = resp.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await resp.json().catch(() => null) : null;

    if (!resp.ok) {
      const fallbackText = !isJson ? await resp.text().catch(() => '') : '';
      const body = data ?? { error: fallbackText || `HTTP ${resp.status}` };
      throw new Error(body.error || 'YouTube API authentication failed');
    }

    if (!data || typeof data !== 'object' || !('audioUrl' in data)) {
      throw new Error('YouTube API returned an invalid response');
    }

    return {
      title: (data as { title?: string }).title ?? `YouTube – ${videoId}`,
      audioUrl: (data as { audioUrl: string }).audioUrl,
      duration: (data as { duration?: number }).duration ?? 0,
    };
  }

  // Fall back to proxy servers (Piped/Invidious/cobalt)
  const resp = await fetch(`/api/youtube?v=${encodeURIComponent(videoId)}`, {
    signal: AbortSignal.timeout(30000),
  });

  const contentType = resp.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await resp.json().catch(() => null) : null;

  if (!resp.ok) {
    const fallbackText = !isJson ? await resp.text().catch(() => '') : '';
    const body = data ?? { error: fallbackText || `HTTP ${resp.status}` };
    throw new Error(
      body.error ||
      'Could not extract audio from this YouTube video.\n\n' +
      'All proxy servers are currently unavailable or the video is restricted.\n' +
      'Try again in a moment, or paste a different link.'
    );
  }

  if (!data || typeof data !== 'object' || !('audioUrl' in data)) {
    throw new Error(
      'YouTube API returned an invalid response in local dev. Restart `npm run dev` so /api proxy is applied, then try again.'
    );
  }

  return {
    title: (data as { title?: string }).title ?? `YouTube – ${videoId}`,
    audioUrl: (data as { audioUrl: string }).audioUrl,
    duration: (data as { duration?: number }).duration ?? 0,
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

// ── Component ────────────────────────────────────────────────────────────────

interface SongSelectProps {
  onStartGame: (file: File, difficulty: Difficulty, songId: string, songName: string) => void;
  isLoading: boolean;
  bestRecords: Record<string, { bestScore: number; bestAccuracy: number }>;
}

export const SongSelect = memo<SongSelectProps>(({ onStartGame, isLoading, bestRecords }) => {
  const [selectedSong, setSelectedSong] = useState<SongEntry | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isFetching, setIsFetching] = useState(false);
  const [customSongs, setCustomSongs] = useState<StoredSong[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [tab, setTab] = useState<'library' | 'custom' | 'youtube'>('library');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // YouTube search state
  const [ytQuery, setYtQuery] = useState('');
  const [ytResults, setYtResults] = useState<Array<{ videoId: string; title: string; thumbnail: string; uploaderName: string; duration: number }>>([]);
  const [ytStatus, setYtStatus] = useState<'idle' | 'searching' | 'resolving' | 'downloading' | 'error'>('idle');
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytTitle, setYtTitle] = useState<string | null>(null);
  const [ytActiveId, setYtActiveId] = useState<string | null>(null);
  const [ytApiKey, setYtApiKey] = useState<string>(() => localStorage.getItem('ytApiKey') ?? '');

  // Load persisted custom songs from IndexedDB on mount
  useEffect(() => {
    getAllStoredSongs()
      .then((songs) => setCustomSongs(songs.sort((a, b) => b.addedAt - a.addedAt)))
      .catch((err) => console.warn('Could not load stored songs:', err));
  }, []);

  // Save YouTube API key to localStorage when it changes
  useEffect(() => {
    if (ytApiKey) {
      localStorage.setItem('ytApiKey', ytApiKey);
    } else {
      localStorage.removeItem('ytApiKey');
    }
  }, [ytApiKey]);

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

  // ── YouTube search handler ────────────────────────────────────────────
  const handleYouTubeSearch = useCallback(async () => {
    const q = ytQuery.trim();
    if (!q) return;
    try {
      setYtStatus('searching');
      setYtError(null);
      setYtResults([]);
      const resp = await fetch(`/api/youtube-search?q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(body.error || 'Search failed');
      }
      const data = await resp.json();
      setYtResults(data.results ?? []);
      setYtStatus('idle');
    } catch (err) {
      setYtError((err as Error).message);
      setYtStatus('error');
    }
  }, [ytQuery]);

  // ── YouTube pick handler (click a search result) ──────────────────────
  const handleYouTubePick = useCallback(async (videoId: string, title: string) => {
    try {
      setYtActiveId(videoId);
      setYtStatus('resolving');
      setYtError(null);
      setYtTitle(title);

      // Step 1: Resolve stream URL (use API key if available)
      const result = await fetchYouTubeAudio(videoId, ytApiKey);
      setYtTitle(result.title);
      setYtStatus('downloading');

      // Step 2: Download the audio blob
      const blob = await downloadYouTubeBlob(result.audioUrl);

      // Step 3: Persist to IndexedDB
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
      setYtActiveId(null);
      setYtTitle(null);
    } catch (err) {
      setYtError((err as Error).message);
      setYtStatus('error');
      setYtActiveId(null);
    }
  }, [ytApiKey]);

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

      {/* ── YouTube search ────────────────────────────────────────────── */}
      {tab === 'youtube' && (
        <div className="yt-section">
          <div className="yt-section__header">
            <div className="yt-section__icon">▶</div>
            <div>
              <div className="yt-section__title">Search YouTube</div>
              <div className="yt-section__subtitle">
                Search for any song — click a result to download, analyze, and play
              </div>
            </div>
          </div>

          {/* API Key Settings */}
          <div className="yt-section__api-key">
            <div className="yt-section__api-key-header">
              <span>⚙️ YouTube API Key (optional but recommended)</span>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="yt-section__api-key-link"
              >
                Get free API key →
              </a>
            </div>
            <input
              type="password"
              className="yt-section__api-key-input"
              placeholder="Paste your YouTube Data API v3 key here..."
              value={ytApiKey}
              onChange={(e) => { setYtApiKey(e.target.value); setYtError(null); }}
              disabled={ytStatus === 'resolving' || ytStatus === 'downloading'}
            />
            <div className="yt-section__api-key-info">
              {ytApiKey ? (
                <span style={{ color: '#4ade80' }}>✓ Using official YouTube API (more reliable)</span>
              ) : (
                <span style={{ color: '#fbbf24' }}>⚠ Using proxy servers (may fail for some videos)</span>
              )}
            </div>
          </div>

          <div className="yt-section__input-row">
            <input
              type="text"
              className="yt-section__input"
              placeholder="Search for a song..."
              value={ytQuery}
              onChange={(e) => { setYtQuery(e.target.value); setYtError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && ytQuery.trim() && ytStatus !== 'searching') handleYouTubeSearch(); }}
              disabled={ytStatus === 'resolving' || ytStatus === 'downloading'}
            />
            <button
              className="yt-section__btn"
              onClick={handleYouTubeSearch}
              disabled={!ytQuery.trim() || ytStatus === 'searching' || ytStatus === 'resolving' || ytStatus === 'downloading'}
            >
              {ytStatus === 'searching' ? '🔍 Searching...' : '🔍 Search'}
            </button>
          </div>

          {(ytStatus === 'resolving' || ytStatus === 'downloading') && ytTitle && (
            <div className="yt-section__progress">
              <div className="yt-section__progress-spinner" />
              <span>{ytStatus === 'resolving' ? 'Finding audio stream…' : <>Downloading: <strong>{ytTitle}</strong></>}</span>
            </div>
          )}

          {ytError && (
            <div className="yt-section__error">
              ⚠ {ytError}
            </div>
          )}

          {/* ── Search results ────────────────────────────────────────── */}
          {ytResults.length > 0 && (
            <div className="yt-results">
              {ytResults.map((r) => {
                const mins = Math.floor(r.duration / 60);
                const secs = r.duration % 60;
                const isActive = ytActiveId === r.videoId;
                return (
                  <button
                    key={r.videoId}
                    className={`yt-results__item ${isActive ? 'yt-results__item--active' : ''}`}
                    onClick={() => handleYouTubePick(r.videoId, r.title)}
                    disabled={ytStatus === 'resolving' || ytStatus === 'downloading'}
                  >
                    <img
                      className="yt-results__thumb"
                      src={r.thumbnail}
                      alt=""
                      loading="lazy"
                    />
                    <div className="yt-results__info">
                      <div className="yt-results__title">{r.title}</div>
                      <div className="yt-results__meta">
                        {r.uploaderName}{r.duration > 0 ? ` • ${mins}:${secs.toString().padStart(2, '0')}` : ''}
                      </div>
                    </div>
                    {isActive && (
                      <div className="yt-results__spinner" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {ytResults.length === 0 && ytStatus === 'idle' && ytQuery.trim() && (
            <div className="yt-section__tips">
              No results yet — hit Search or press Enter
            </div>
          )}
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
