import React, { memo, useState } from 'react';
import { TargetFPS } from '../../engine/GameEngine';

interface SettingsProps {
  currentFPS: TargetFPS;
  onFPSChange: (fps: TargetFPS) => void;
  keyBindings: string[];
  onKeyBindingsChange: (bindings: string[]) => void;
  musicVolume: number;
  onMusicVolumeChange: (volume: number) => void;
  sfxVolume: number;
  onSfxVolumeChange: (volume: number) => void;
  onClose: () => void;
}

/**
 * Settings panel for configuring game performance options and keybinds.
 * 
 * FPS Options:
 * - 60 FPS: Best for lower-end hardware, most compatible
 * - 100 FPS: Balanced performance and precision (recommended)
 * - 144 FPS: Maximum precision for high-refresh displays
 */
export const Settings: React.FC<SettingsProps> = memo(({ currentFPS, onFPSChange, keyBindings, onKeyBindingsChange, musicVolume, onMusicVolumeChange, sfxVolume, onSfxVolumeChange, onClose }) => {
  const [editingLane, setEditingLane] = useState<number | null>(null);
  
  const fpsOptions = [
    { 
      value: TargetFPS.FPS_60, 
      label: '60 FPS', 
      description: 'Balanced - Works on all displays' 
    },
    { 
      value: TargetFPS.FPS_100, 
      label: '100 FPS', 
      description: 'Recommended - High precision' 
    },
    { 
      value: TargetFPS.FPS_144, 
      label: '144 FPS', 
      description: 'Maximum - For 144Hz+ displays' 
    },
  ];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings__header">
          <h2 className="settings__title">Settings</h2>
          <button className="settings__close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="settings__section">
          <h3 className="settings__section-title">Game Performance</h3>
          <p className="settings__section-desc">
            Higher FPS provides more precise timing but requires more CPU power.
            Choose based on your display and hardware capabilities.
          </p>

          <div className="settings__fps-options">
            {fpsOptions.map((option) => (
              <button
                key={option.value}
                className={`settings__fps-option ${currentFPS === option.value ? 'active' : ''}`}
                onClick={() => onFPSChange(option.value)}
              >
                <div className="settings__fps-label">{option.label}</div>
                <div className="settings__fps-desc">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="settings__section">
          <h3 className="settings__section-title">Key Bindings</h3>
          <p className="settings__section-desc">
            Click on a lane button below and press any key to set a new binding.
          </p>

          <div className="settings__keybinds">
            {keyBindings.map((key, index) => (
              <KeyBindButton
                key={index}
                lane={index}
                currentKey={key}
                isEditing={editingLane === index}
                onEdit={() => setEditingLane(index)}
                onKeyCapture={(newKey) => {
                  const newBindings = [...keyBindings];
                  newBindings[index] = newKey;
                  onKeyBindingsChange(newBindings);
                  setEditingLane(null);
                }}
                onCancel={() => setEditingLane(null)}
              />
            ))}
          </div>

          <button
            className="settings__reset-btn"
            onClick={() => {
              onKeyBindingsChange(['d', 'f', 'j', 'k']);
              setEditingLane(null);
            }}
          >
            Reset to Default (D F J K)
          </button>
        </div>

        <div className="settings__section">
          <h3 className="settings__section-title">Audio</h3>
          <p className="settings__section-desc">
            Adjust music and hit-beat sound levels. Changes apply immediately.
          </p>

          <div className="settings__audio-controls">
            <div className="settings__audio-row">
              <div className="settings__audio-label">Music Volume</div>
              <input
                className="settings__audio-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={musicVolume}
                onChange={(e) => onMusicVolumeChange(Number(e.target.value))}
              />
              <div className="settings__audio-value">{Math.round(musicVolume * 100)}%</div>
            </div>

            <div className="settings__audio-row">
              <div className="settings__audio-label">Perfect Beat Volume</div>
              <input
                className="settings__audio-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sfxVolume}
                onChange={(e) => onSfxVolumeChange(Number(e.target.value))}
              />
              <div className="settings__audio-value">{Math.round(sfxVolume * 100)}%</div>
            </div>
          </div>
        </div>

        <div className="settings__info">
          <p>
            <strong>Note:</strong> FPS changes take effect when starting a new game.
            The game loop runs at the selected FPS for consistent timing regardless of your display's refresh rate.
          </p>
        </div>
      </div>
    </div>
  );
});

Settings.displayName = 'Settings';

// ── KeyBindButton Component ──────────────────────────────────────────────────

interface KeyBindButtonProps {
  lane: number;
  currentKey: string;
  isEditing: boolean;
  onEdit: () => void;
  onKeyCapture: (key: string) => void;
  onCancel: () => void;
}

const KeyBindButton: React.FC<KeyBindButtonProps> = ({ lane, currentKey, isEditing, onEdit, onKeyCapture, onCancel }) => {
  const laneColors = ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f'];
  const laneNames = ['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4'];

  React.useEffect(() => {
    if (!isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      // Capture the key
      const key = e.key.toLowerCase();
      
      // Reject modifier keys alone
      if (['shift', 'control', 'alt', 'meta', 'capslock', 'tab', 'enter'].includes(key)) {
        return;
      }

      onKeyCapture(key);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, onKeyCapture, onCancel]);

  return (
    <div className="keybind-item">
      <div className="keybind-item__label" style={{ color: laneColors[lane] }}>
        {laneNames[lane]}
      </div>
      <button
        className={`keybind-item__button ${isEditing ? 'editing' : ''}`}
        onClick={onEdit}
        disabled={isEditing}
      >
        {isEditing ? 'Press any key...' : currentKey.toUpperCase()}
      </button>
    </div>
  );
};
