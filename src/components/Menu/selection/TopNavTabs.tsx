import { useRef } from 'react';
import type { NavigationTab } from './types';

interface TopNavTabsProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
}

const TAB_OPTIONS: Array<{ id: NavigationTab; label: string }> = [
  { id: 'builtin', label: 'Built In' },
  { id: 'personal', label: 'Personal' },
  { id: 'rhythm-ai', label: 'Rhythm AI' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'yt-mp3', label: 'YouTube to MP3' },
];

export function TopNavTabs({ activeTab, onTabChange }: TopNavTabsProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (index: number) => {
    const normalized = (index + TAB_OPTIONS.length) % TAB_OPTIONS.length;
    const nextTab = TAB_OPTIONS[normalized];
    onTabChange(nextTab.id);
    buttonRefs.current[normalized]?.focus();
  };

  return (
    <div className="rounded-xl border border-game-border bg-game-surface p-2">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Song source tabs">
        {TAB_OPTIONS.map((tab, index) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tab-panel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  focusAndSelect(index + 1);
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  focusAndSelect(index - 1);
                }
              }}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-game-accent text-slate-900'
                  : 'bg-game-panel text-game-text hover:bg-slate-600/40'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
