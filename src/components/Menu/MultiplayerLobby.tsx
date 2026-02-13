import { memo, useState, useCallback } from 'react';

interface MultiplayerLobbyProps {
  onCreateGame: () => void;
  onJoinGame: (code: string) => void;
  onBack: () => void;
  isConnecting: boolean;
  error: string | null;
}

export const MultiplayerLobby = memo<MultiplayerLobbyProps>(({
  onCreateGame,
  onJoinGame,
  onBack,
  isConnecting,
  error,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'join'>('choose');

  const handleJoin = useCallback(() => {
    const code = joinCode.trim().toUpperCase();
    if (code.length >= 4) {
      onJoinGame(code);
    }
  }, [joinCode, onJoinGame]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleJoin();
  }, [handleJoin]);

  return (
    <div className="mp-lobby">
      <h2 className="mp-lobby__title">Multiplayer</h2>

      {error && <div className="mp-lobby__error">{error}</div>}

      {mode === 'choose' && !isConnecting && (
        <div className="mp-lobby__choices">
          <button className="btn btn-success mp-lobby__btn" onClick={onCreateGame}>
            Create Game
          </button>
          <button className="btn mp-lobby__btn" onClick={() => setMode('join')}>
            Join Game
          </button>
          <button className="btn mp-lobby__btn mp-lobby__btn--back" onClick={onBack}>
            Back
          </button>
        </div>
      )}

      {mode === 'join' && !isConnecting && (
        <div className="mp-lobby__join">
          <p className="mp-lobby__hint">Enter the room code from your friend</p>
          <input
            className="mp-lobby__input"
            type="text"
            maxLength={6}
            placeholder="ABCD12"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="mp-lobby__join-actions">
            <button
              className="btn btn-success"
              onClick={handleJoin}
              disabled={joinCode.trim().length < 4}
            >
              Connect
            </button>
            <button className="btn" onClick={() => setMode('choose')}>
              Back
            </button>
          </div>
        </div>
      )}

      {isConnecting && (
        <div className="mp-lobby__connecting">
          <div className="loading__spinner" />
          <p>Connecting...</p>
        </div>
      )}
    </div>
  );
});

MultiplayerLobby.displayName = 'MultiplayerLobby';
