import type { Difficulty } from '../../../beatmap/BeatmapGenerator';

export type NavigationTab = 'builtin' | 'personal' | 'rhythm-ai' | 'youtube' | 'yt-mp3';

export interface SongOption {
  id: string;
  name: string;
  source: NavigationTab;
  path?: string;
  file?: File;
}

export interface DifficultyOption {
  value: Difficulty;
  label: string;
}
