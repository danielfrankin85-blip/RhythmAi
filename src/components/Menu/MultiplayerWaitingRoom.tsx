import { memo, useState, useCallback, useRef } from 'react';
import type { SongInfo } from '../../multiplayer/MultiplayerManager';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';

interface MultiplayerWaitingRoomProps {
  role: 'host' | 'guest';
  roomCode: string;
  lobbyState: string;
  songInfo: SongInfo | null;
  opponentConnected: boolean;
  onSelectSong: (file: File, difficulty: Difficulty) => void;
  onGuestReady: (file: File) => void;
  onStartGame: () => void;
  onLeave: () => void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'extreme'];

export const MultiplayerWaitingRoom = memo<MultiplayerWaitingRoomProps>(({
  role,
  roomCode,
  lobbyState,
  songInfo,
  opponentConnected,
  onSelectSong,
  onGuestReady,
  onStartGame,
  onLeave,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomCode]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleHostConfirm = useCallback(() => {
    if (selectedFile) onSelectSong(selectedFile, difficulty);
  }, [selectedFile, difficulty, onSelectSong]);

  const handleGuestConfirm = useCallback(() => {
    if (selectedFile) onGuestReady(selectedFile);
  }, [selectedFile, onGuestReady]);

  return (
    <div className="mp-waiting">
      <h2 className="mp-waiting__title">
        {role === 'host' ? 'Your Room' : 'Joined Room'}
      </h2>

      {/* Room Code */}
      <div className="mp-waiting__code-box">
        <span className="mp-waiting__code-label">Room Code</span>
        <span className="mp-waiting__code">{roomCode}</span>
        <button className="btn mp-waiting__copy" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Connection status */}
      <div className="mp-waiting__status">
        <span className={`mp-waiting__dot ${opponentConnected ? 'mp-waiting__dot--on' : ''}`} />
        <span>{opponentConnected ? 'Opponent connected' : 'Waiting for opponent...'}</span>
      </div>

      {/* Host flow: pick song when guest is connected */}
      {role === 'host' && opponentConnected && lobbyState === 'waiting-song' && (
        <div className="mp-waiting__song-pick">
          <p className="mp-waiting__hint">Select an MP3 file and difficulty</p>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="mp-waiting__file"
          />
          {selectedFile && (
            <>
              <div className="mp-waiting__file-name">{selectedFile.name}</div>
              <div className="mp-waiting__diff-row">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    className={`btn mp-waiting__diff-btn ${d === difficulty ? 'btn-success' : ''}`}
                    onClick={() => setDifficulty(d)}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <button className="btn btn-success" onClick={handleHostConfirm}>
                Confirm Song
              </button>
            </>
          )}
        </div>
      )}

      {/* Host: waiting for guest to load */}
      {role === 'host' && lobbyState === 'waiting-guest-ready' && (
        <div className="mp-waiting__status-msg">
          <div className="loading__spinner" />
          <p>Waiting for opponent to load the song...</p>
        </div>
      )}

      {/* Host: ready to start */}
      {role === 'host' && lobbyState === 'ready' && (
        <div className="mp-waiting__ready">
          <p className="mp-waiting__ready-text">Both players ready!</p>
          <button className="btn btn-success mp-waiting__start-btn" onClick={onStartGame}>
            Start Game
          </button>
        </div>
      )}

      {/* Guest: waiting for host to pick song */}
      {role === 'guest' && lobbyState === 'waiting-song' && (
        <div className="mp-waiting__status-msg">
          <div className="loading__spinner" />
          <p>Waiting for host to select a song...</p>
        </div>
      )}

      {/* Guest: host picked a song, guest needs to load the same file */}
      {role === 'guest' && lobbyState === 'waiting-guest-ready' && songInfo && (
        <div className="mp-waiting__song-pick">
          <p className="mp-waiting__hint">
            Host selected: <strong>{songInfo.songName}</strong> on <strong>{songInfo.difficulty}</strong>
          </p>
          <p className="mp-waiting__hint">Upload the same MP3 file to continue</p>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="mp-waiting__file"
          />
          {selectedFile && (
            <>
              <div className="mp-waiting__file-name">{selectedFile.name}</div>
              <button className="btn btn-success" onClick={handleGuestConfirm}>
                Ready!
              </button>
            </>
          )}
        </div>
      )}

      {/* Guest: waiting for host to start */}
      {role === 'guest' && lobbyState === 'ready' && (
        <div className="mp-waiting__status-msg">
          <p className="mp-waiting__ready-text">Ready! Waiting for host to start...</p>
        </div>
      )}

      <button className="btn mp-waiting__leave" onClick={onLeave}>
        Leave Room
      </button>
    </div>
  );
});

MultiplayerWaitingRoom.displayName = 'MultiplayerWaitingRoom';
