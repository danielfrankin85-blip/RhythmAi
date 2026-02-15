# Rhythm Game Song Selection Screen - UI Specification

**Version:** 1.0  
**Last Updated:** February 14, 2026  
**Purpose:** Complete UI/UX specification for song selection interface

---

## 1. Overview

The song selection screen is the primary navigation hub where users choose their song, difficulty, and trigger beatmap generation. The interface prioritizes fast keyboard navigation, clear visual feedback, and accessible design.

---

## 2. Layout Architecture

### 2.1 Desktop Layout (≥ 1024px)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (Page Title + Description)                              │
│  h: 80px, padding: 24px                                         │
├─────────────────────────────────────────────────────────────────┤
│  TOP NAVIGATION TABS                                             │
│  h: 56px, gap: 8px between tabs                                 │
│  [Built In] [Personal] [Rhythm AI] [YouTube] [YouTube to MP3]   │
├──────────────────────────────┬──────────────────────────────────┤
│                              │                                  │
│  LEFT COLUMN (60%)           │  RIGHT COLUMN (40%)              │
│  min-width: 480px            │  min-width: 320px                │
│                              │  max-width: 400px                │
│  ┌────────────────────────┐ │  ┌────────────────────────────┐ │
│  │ SONG LIST PANEL        │ │  │ DIFFICULTY PANEL           │ │
│  │ scrollable, h: 480px   │ │  │ fixed content              │ │
│  │ gap: 8px between items │ │  │ gap: 8px between buttons   │ │
│  └────────────────────────┘ │  └────────────────────────────┘ │
│                              │                                  │
│                              │  ┌────────────────────────────┐ │
│                              │  │ BEATMAP OPTIONS PANEL      │ │
│                              │  │ (conditional render)       │ │
│                              │  └────────────────────────────┘ │
│                              │                                  │
│                              │  [START GAME BUTTON]             │
│                              │  w: 100%, h: 48px                │
└──────────────────────────────┴──────────────────────────────────┘
│  STATUS BAR (live updates)                                      │
│  h: 40px, padding: 12px                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Grid System:**
- Container: max-width 1400px, centered, 24px horizontal padding
- Column gap: 24px
- Left/Right split: 3fr / 2fr (flexible with constraints)

**Spacing Scale:**
- `xs`: 4px (micro adjustments)
- `sm`: 8px (tight grouping)
- `md`: 12px (default component padding)
- `lg`: 16px (section spacing)
- `xl`: 24px (major layout gaps)

### 2.2 Tablet Layout (768px - 1023px)

- Maintain two-column layout
- Left column: 55%
- Right column: 45%
- Reduce song list max height to 400px
- Stack beatmap panel below difficulty panel

### 2.3 Mobile Layout (< 768px)

```
┌─────────────────────────┐
│  HEADER (compact)       │
├─────────────────────────┤
│  TOP NAVIGATION         │
│  (horizontal scroll)    │
├─────────────────────────┤
│  SONG LIST PANEL        │
│  (full width)           │
│  h: 50vh                │
├─────────────────────────┤
│  DIFFICULTY PANEL       │
│  (full width, compact)  │
├─────────────────────────┤
│  BEATMAP OPTIONS        │
│  (conditional)          │
├─────────────────────────┤
│  START GAME BUTTON      │
└─────────────────────────┘
```

- Single column stacking
- Song list becomes collapsible accordion
- Difficulty buttons in 2x3 grid
- Sticky header + sticky start button

---

## 3. Component Breakdown

### 3.1 TopNavigationTabs

**Purpose:** Switch between song sources (Built In, Personal, etc.)

**Visual Structure:**
```
[Tab 1] [Tab 2] [Tab 3] [Tab 4] [Tab 5]
```

**Props Interface:**
```typescript
interface TopNavigationTabsProps {
  activeTab: TabId;
  onTabChange: (tabId: TabId) => void;
  tabCount: Record<TabId, number>; // optional badge counts
}
```

**State Responsibilities:**
- Parent manages `activeTab` state
- Component handles keyboard navigation internally via focus management

**Interaction States:**

| State | Visual Treatment |
|-------|-----------------|
| **Default** | `bg: surface`, `text: muted`, `border: transparent` |
| **Hover** | `bg: surface-hover` (brightness +5%), cursor pointer |
| **Active/Selected** | `bg: accent`, `text: dark`, `font-weight: 600` |
| **Focus** | `ring: 2px accent` with 2px offset, no other change to active state |
| **Keyboard Focus** | Same as focus, plus visible focus indicator for non-mouse users |

**Keyboard Navigation:**
- `ArrowRight` / `ArrowLeft`: Move between tabs
- `Home`: Jump to first tab
- `End`: Jump to last tab
- `Enter` / `Space`: Activate focused tab

**ARIA:**
```html
<div role="tablist" aria-label="Song source tabs">
  <button
    role="tab"
    aria-selected="true|false"
    aria-controls="tabpanel-{id}"
    id="tab-{id}"
  >
    Built In
  </button>
</div>
```

---

### 3.2 SongListPanel

**Purpose:** Display scrollable list of songs for current tab

**Visual Structure:**
```
┌─────────────────────────────┐
│ Songs                        │  ← Header
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ [Icon] Song Title       │ │  ← Song Item
│ │        Metadata         │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ [Icon] Song Title       │ │
│ │        Metadata         │ │
│ └─────────────────────────┘ │
│ ...                         │
└─────────────────────────────┘
```

**Props Interface:**
```typescript
interface SongListPanelProps {
  songs: SongItem[];
  selectedSongId: string | null;
  onSongSelect: (songId: string) => void;
  bestRecords: Record<string, ScoreRecord>;
  emptyMessage: string;
}

interface SongItem {
  id: string;
  name: string;
  source: TabId;
  metadata?: string; // e.g., "3:45 • 140 BPM"
}
```

**State Responsibilities:**
- Parent manages `selectedSongId`
- Component handles scroll position restoration
- Component manages internal keyboard focus ring

**Song Item States:**

| State | Visual Treatment |
|-------|-----------------|
| **Default** | `bg: panel`, `border: border-subtle`, `text: default` |
| **Hover** | `bg: panel-hover`, `border: border-hover` (sky-300/30), `transform: translateX(2px)` |
| **Selected** | `bg: accent/10`, `border: accent` (2px solid), `shadow: glow` (0 0 0 4px accent/20) |
| **Focus** | `ring: 2px focus-ring`, outline offset 2px |
| **Disabled** | `opacity: 0.5`, `cursor: not-allowed`, no hover |

**Item Layout:**
```
┌───────────────────────────────────────┐
│ [Icon]  Song Title          [Delete] │  ← Primary row, h: 48px
│         Best: 12,345 • 98.5%         │  ← Metadata row (if present)
└───────────────────────────────────────┘
padding: 12px 16px
gap: 12px (icon to text)
```

**Keyboard Navigation:**
- `ArrowDown`: Move to next song
- `ArrowUp`: Move to previous song
- `Enter` / `Space`: Select focused song
- `Home`: Jump to first song
- `End`: Jump to last song
- `PageDown` / `PageUp`: Scroll by viewport height

**Scroll Behavior:**
- Smooth scroll with `scroll-behavior: smooth`
- Auto-scroll selected item into view on keyboard nav
- Scroll padding: 16px top/bottom
- Custom scrollbar: 8px wide, rounded track

**ARIA:**
```html
<section aria-labelledby="song-list-heading">
  <h2 id="song-list-heading">Songs</h2>
  <div
    role="listbox"
    aria-label="Song list"
    aria-activedescendant="song-{selectedId}"
  >
    <div
      role="option"
      aria-selected="true|false"
      id="song-{id}"
    >
      Song Name
    </div>
  </div>
</section>
```

**Empty State:**
```
┌─────────────────────────────┐
│                             │
│        [Icon]               │
│   No songs available        │
│   {emptyMessage}            │
│                             │
└─────────────────────────────┘
center-aligned, padding: 48px 24px
text: muted, text-sm
```

---

### 3.3 DifficultyPanel

**Purpose:** Select gameplay difficulty level

**Visual Structure:**
```
┌─────────────────────────┐
│ Difficulty              │  ← Header
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ EASY                │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ MEDIUM              │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ HARD                │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ EXTREME             │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ DEADLY              │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

**Props Interface:**
```typescript
interface DifficultyPanelProps {
  selectedDifficulty: Difficulty | null;
  onDifficultySelect: (difficulty: Difficulty) => void;
  disabledDifficulties?: Difficulty[]; // optional locked difficulties
}

type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme' | 'deadly';
```

**State Responsibilities:**
- Parent manages `selectedDifficulty`
- Component manages keyboard navigation focus

**Button States:**

| State | Visual Treatment |
|-------|-----------------|
| **Default** | `bg: panel`, `border: border`, `text: default`, `uppercase` |
| **Hover** | `bg: panel-hover`, `border: accent/30`, subtle scale (1.02) |
| **Selected** | `bg: accent/10`, `border: accent` (2px), `shadow: glow`, `text: accent`, badge "selected" |
| **Focus** | `ring: 2px focus-ring` |
| **Disabled/Locked** | `opacity: 0.4`, lock icon, `cursor: not-allowed`, tooltip "Unlock by completing..." |

**Button Layout:**
```
┌─────────────────────────────┐
│ EASY                [Badge] │  ← h: 48px, padding: 12px 16px
└─────────────────────────────┘
font-size: 14px
font-weight: 600
letter-spacing: 0.05em
text-transform: uppercase
```

**Optional Metadata (per difficulty):**
- Best score for this song+difficulty
- Star rating (1-5 stars)
- Note density indicator

**Keyboard Navigation:**
- `ArrowDown`: Next difficulty
- `ArrowUp`: Previous difficulty
- `Enter` / `Space`: Select focused difficulty
- `1-5` keys: Quick select (1=easy, 5=deadly)

**ARIA:**
```html
<section aria-labelledby="difficulty-heading">
  <h2 id="difficulty-heading">Difficulty</h2>
  <div role="radiogroup" aria-label="Difficulty selection">
    <button
      role="radio"
      aria-checked="true|false"
      aria-disabled="false"
    >
      Easy
    </button>
  </div>
</section>
```

**Color-Coded Difficulties (optional visual enhancement):**
- Easy: `green-500` accent
- Medium: `yellow-500` accent
- Hard: `orange-500` accent
- Extreme: `red-500` accent
- Deadly: `purple-500` accent

*Note: Never rely on color alone; always pair with text label.*

---

### 3.4 BeatmapOptionsPanel

**Purpose:** Configure beatmap generation settings (appears after song + difficulty selected)

**Visual Structure:**
```
┌─────────────────────────────┐
│ Beatmap Options             │  ← Header
├─────────────────────────────┤
│ Ready for: Song Name        │
│ Difficulty: HARD            │
├─────────────────────────────┤
│ Note Density    [Dropdown]  │  ← Settings row
│ Scroll Speed    [Dropdown]  │
│ Lane Count      [Dropdown]  │
├─────────────────────────────┤
│ [Create Beatmap Button]     │  ← CTA
└─────────────────────────────┘
```

**Conditional Rendering:**
- **Show when:** `selectedSong !== null AND selectedDifficulty !== null`
- **Hide when:** Either selection is cleared
- **Animation:** Slide down + fade in (200ms ease-out)

**Props Interface:**
```typescript
interface BeatmapOptionsPanelProps {
  enabled: boolean;
  songName: string;
  difficultyName: string;
  isLoading: boolean;
  onCreateBeatmap: () => void;
}
```

**State Responsibilities:**
- Parent manages visibility logic (`enabled` prop)
- Parent triggers beatmap generation
- Component manages internal form state (dropdowns)

**Panel States:**

| State | Visual Treatment |
|-------|-----------------|
| **Entering** | `opacity: 0 → 1`, `translateY: -8px → 0`, duration 200ms |
| **Exiting** | `opacity: 1 → 0`, `translateY: 0 → -8px`, duration 150ms |
| **Loading** | Disable all controls, show spinner on button |

**ARIA:**
```html
<section
  aria-label="Beatmap options"
  aria-live="polite"
  aria-atomic="true"
>
  <h3>Beatmap Options</h3>
  <p>Ready for: <strong>{songName}</strong></p>
  <label for="note-density">Note Density</label>
  <select id="note-density">...</select>
</section>
```

**Create Beatmap Button:**
- Full width
- Height: 48px
- `bg: accent`, `text: dark`, `font-weight: 600`
- Hover: `bg: accent-strong` (darker shade)
- Loading: Show spinner + "Generating..." text
- Disabled when loading

---

### 3.5 StatusBar (Bottom)

**Purpose:** Live feedback for user actions

**Visual Structure:**
```
┌─────────────────────────────────────────────┐
│ [Icon] Status message here...               │
└─────────────────────────────────────────────┘
h: 40px, padding: 12px 24px
```

**Props Interface:**
```typescript
interface StatusBarProps {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}
```

**Status Types:**

| Type | Icon | Color |
|------|------|-------|
| Info | ℹ️ | `text: muted` |
| Success | ✓ | `text: green-400` |
| Warning | ⚠ | `text: yellow-400` |
| Error | ✕ | `text: red-400` |

**Behavior:**
- Auto-update when selections change
- Persist until next action
- Screen reader announces via `aria-live="polite"`

**Example Messages:**
- "Select a song and difficulty to continue."
- "Song selected: {name} • Choose a difficulty."
- "Ready to generate beatmap for {song} on {difficulty}."
- "Uploaded 3 personal song(s)."

**ARIA:**
```html
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  {message}
</div>
```

---

## 4. Interaction Flow

### 4.1 Selection States

**State Machine:**

```
┌─────────────┐
│ INITIAL     │  No song, no difficulty
└──────┬──────┘
       │ User selects song
       ▼
┌─────────────┐
│ SONG        │  Song selected, no difficulty
│ SELECTED    │  → Difficulty panel enabled
└──────┬──────┘
       │ User selects difficulty
       ▼
┌─────────────┐
│ READY       │  Song + difficulty selected
│ FOR BEATMAP │  → Beatmap panel appears
└──────┬──────┘  → Start Game enabled
       │ User clears song or switches tab
       ▼
┌─────────────┐
│ INITIAL     │  Reset state
└─────────────┘
```

**Visual Feedback Per State:**

| State | Song List | Difficulty Panel | Beatmap Panel | Start Button |
|-------|-----------|------------------|---------------|--------------|
| Initial | All enabled | All disabled (muted) | Hidden | Disabled |
| Song Selected | One selected | All enabled | Hidden | Disabled |
| Ready | One selected | One selected | Visible | Enabled |

### 4.2 Tab Switching Behavior

**When user switches tabs:**
1. Fade out current song list (100ms)
2. Clear song selection (reset state to INITIAL)
3. Load new song list
4. Fade in new song list (100ms)
5. Hide beatmap panel with slide-up animation
6. Disable difficulty panel (return to muted state)
7. Update status bar: "Switched to {tab name}"

**Preserve:**
- Selected difficulty (stays selected but disabled visually)
- Scroll position is NOT preserved (reset to top)

### 4.3 File Upload Flow (Personal tab)

**UI Elements:**
```
┌─────────────────────────────────────────┐
│ [Icon] Drop files or browse            │  ← Drop zone
│        MP3, WAV, OGG, FLAC...          │
└─────────────────────────────────────────┘
h: 80px, border: dashed, hover: solid accent
```

**Drag States:**

| State | Visual Treatment |
|-------|-----------------|
| Idle | `border: dashed border-subtle`, `bg: panel` |
| Drag Over | `border: solid accent`, `bg: accent/5`, `shadow: glow` |
| Uploading | Progress bar overlay, disable interactions |

**Upload Feedback:**
1. Files drop → Show loading spinner
2. Parse files (client-side validation)
3. Add to Personal tab song list (top of list)
4. Auto-select first uploaded song
5. Status bar: "Uploaded {n} song(s)"
6. If invalid files: Show error toast, list invalid file names

---

## 5. Color System

### 5.1 Semantic Colors

```css
--game-bg:            #0b0f14  /* Page background */
--game-surface:       #111827  /* Panels, cards */
--game-panel:         #1f2937  /* Inner panels (song items, diff buttons) */
--game-border:        #374151  /* Default borders */
--game-border-hover:  #475569  /* Hover borders */

--game-accent:        #38bdf8  /* Primary action (sky-400) */
--game-accent-strong: #0ea5e9  /* Hover/active accent (sky-500) */
--game-accent-weak:   #7dd3fc  /* Focus rings, glows (sky-300) */

--game-text:          #f8fafc  /* Primary text (slate-50) */
--game-text-muted:    #9ca3af  /* Secondary text (gray-400) */
--game-text-disabled: #6b7280  /* Disabled text (gray-500) */
```

### 5.2 State Color Mappings

| UI State | Background | Border | Text | Shadow |
|----------|-----------|--------|------|--------|
| Default | `surface` | `border` | `text` | none |
| Hover | `panel` | `border-hover` | `text` | none |
| Selected | `accent/10` | `accent` (2px) | `text` | `0 0 0 4px accent/20` |
| Focus | inherit | inherit | inherit | `0 0 0 2px accent-weak` |
| Disabled | `surface` | `border` | `text-disabled` | none |

### 5.3 Difficulty Color Overrides (Optional)

When a difficulty is selected, apply a subtle color tint:

```css
.difficulty-easy.selected {
  --local-accent: #22c55e; /* green-500 */
}
.difficulty-deadly.selected {
  --local-accent: #a855f7; /* purple-500 */
}
```

Use `--local-accent` for border and glow, maintain readability.

---

## 6. Animation & Transitions

### 6.1 Timing Functions

```css
--ease-out:     cubic-bezier(0.16, 1, 0.3, 1);  /* Snap out */
--ease-in-out:  cubic-bezier(0.4, 0, 0.2, 1);   /* Balanced */
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1); /* Overshoot */
```

### 6.2 Transition Durations

| Interaction | Duration | Easing |
|-------------|----------|--------|
| Hover (color, border) | 120ms | ease-out |
| Selection change | 180ms | ease-out |
| Panel expand/collapse | 250ms | ease-in-out |
| Tab switch (fade) | 150ms | ease-in-out |
| Focus ring appear | 100ms | ease-out |
| Loading spinner | 600ms (loop) | linear |

### 6.3 Animation Specs

**Song Item Selection:**
```css
transition: all 180ms ease-out;
/* On select: */
transform: scale(1.01);
box-shadow: 0 0 0 4px var(--game-accent-weak);
```

**Beatmap Panel Enter:**
```css
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
animation: slideIn 200ms ease-out;
```

**Tab Fade Transition:**
```css
@keyframes crossfade {
  0% { opacity: 1; }
  50% { opacity: 0; }
  100% { opacity: 1; }
}
animation: crossfade 300ms ease-in-out;
```

**Loading Spinner:**
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
animation: spin 600ms linear infinite;
```

**Reduced Motion:**
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 7. Keyboard Navigation

### 7.1 Focus Order

1. Top Navigation Tabs (sequential, left to right)
2. File Upload Input (if visible)
3. Song List Panel (enter with Tab, navigate with arrows)
4. Difficulty Panel (enter with Tab, navigate with arrows)
5. Beatmap Panel Controls (sequential through dropdowns)
6. Create Beatmap Button / Start Game Button

### 7.2 Focus Trap

When a modal or overlay appears (future: settings dialog), trap focus within that container until dismissed.

### 7.3 Navigation Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Move to next focusable element |
| `Shift+Tab` | Move to previous focusable element |
| `Arrow Keys` | Navigate within current component (tabs, list, difficulty) |
| `Enter` / `Space` | Activate focused element |
| `Escape` | Clear selection (when in song list or difficulty panel) |
| `Home` | Jump to first item in list |
| `End` | Jump to last item in list |
| `1-5` | Quick-select difficulty (only when difficulty panel focused) |
| `/` | Focus search input (future enhancement) |

### 7.4 Focus Visibility

**Mouse users:** Focus ring is subtle or hidden on click.  
**Keyboard users:** Focus ring is always visible (detect via `:focus-visible`).

```css
button:focus {
  outline: none; /* Remove default */
}

button:focus-visible {
  outline: 2px solid var(--game-accent-weak);
  outline-offset: 2px;
}
```

---

## 8. Accessibility (WCAG 2.1 AA)

### 8.1 Color Contrast

**Text Contrast Ratios:**
- Normal text (16px): ≥ 4.5:1
- Large text (18px+, bold 14px+): ≥ 3:1

**Verification:**
- `text` on `surface`: ✓ 14.2:1
- `text-muted` on `surface`: ✓ 6.8:1
- `accent` (as text) on dark bg: ✓ 5.2:1

### 8.2 ARIA Roles & Labels

**All interactive elements MUST have:**
- Accessible name (via `aria-label` or visible text)
- Appropriate role (`button`, `tab`, `option`, `radio`)
- State indicators (`aria-selected`, `aria-checked`, `aria-disabled`)

**Live Regions:**
- Status bar: `aria-live="polite"`
- Loading states: `aria-busy="true"`
- Error messages: `aria-live="assertive"`

### 8.3 Screen Reader Announcements

**On selection change:**
```
"Song selected: [Song Name]. Choose a difficulty to continue."
```

**On difficulty select:**
```
"Difficulty [easy/medium/etc] selected. Ready to create beatmap."
```

**On beatmap panel appear:**
```
"Beatmap options available. Configure settings or start game."
```

**On error:**
```
"Error: [message]. Please try again."
```

### 8.4 Focus Management

**When panel appears/disappears:**
- Maintain focus in logical sequence
- Don't steal focus without user action
- Return focus to trigger element when closing modals

**Disabled elements:**
- Use `aria-disabled="true"` instead of `disabled` attribute when element should remain in tab order with explanation
- Provide tooltip or `aria-describedby` for locked features

### 8.5 Touch Targets

**Minimum sizes:**
- Buttons: 48x48px
- Song list items: 48px min height
- Tab buttons: 44px min height

**Spacing:**
- 8px minimum gap between tappable elements on mobile

---

## 9. Responsive Adaptations

### 9.1 Breakpoint Strategy

```
Mobile:   < 768px    (sm)
Tablet:   768-1023px (md)
Desktop:  ≥ 1024px   (lg)
Large:    ≥ 1440px   (xl)
```

### 9.2 Mobile-Specific Adaptations (< 768px)

**Layout Changes:**
- Single column stack
- Top tabs: horizontal scroll with snap points
- Song list: reduced height (50vh max)
- Difficulty buttons: 2-column grid instead of single column
- Sticky header (tabs) + sticky footer (start button)

**Interaction Changes:**
- Hover states become active/pressed states (`:active` pseudo-class)
- Remove subtle hover animations (no mouse pointer)
- Increase touch target sizes (minimum 48x48px)
- Simplify shadows and glows (performance)

**Typography Adjustments:**
- Song names: smaller font (14px → 16px line height 1.4)
- Tab labels: 14px → 15px
- Reduce letter-spacing on uppercase text

**Spacing Adjustments:**
- Reduce padding: 24px → 16px (container)
- Reduce gaps: 24px → 12px (sections)
- Tighter song list items: 12px padding instead of 16px

### 9.3 Tablet Adaptations (768-1023px)

- Maintain two-column layout
- Slightly narrower panels
- Reduce song list height to 400px
- Keep full keyboard navigation support

### 9.4 Large Desktop (≥ 1440px)

- Increase container max-width to 1600px
- Add more whitespace between columns (32px gap)
- Display more songs in viewport (600px list height)
- Optional: Add third column for beatmap history/recommendations

---

## 10. Component State Responsibilities

### 10.1 Parent (SongSelect) State

The parent component manages:

```typescript
interface SongSelectState {
  activeTab: TabId;
  selectedSongId: string | null;
  selectedDifficulty: Difficulty | null;
  personalSongs: SongItem[];
  statusMessage: string;
  isLoading: boolean;
}
```

**Derived State:**
- `canCreateBeatmap`: `selectedSong && selectedDifficulty`
- `currentSongs`: filtered by `activeTab`
- `beatmapPanelVisible`: derived from `canCreateBeatmap`

### 10.2 Child Component Local State

**TopNavigationTabs:**
- Internal focus index (for keyboard nav)

**SongListPanel:**
- Scroll position
- Internal focus index

**DifficultyPanel:**
- Internal focus index

**BeatmapOptionsPanel:**
- Form values (note density, scroll speed, etc.)
- Validation errors

---

## 11. Edge Cases & Error States

### 11.1 Empty States

**No songs in current tab:**
```
┌─────────────────────────────┐
│                             │
│        [Icon]               │
│   No songs available        │
│   {contextual message}      │
│                             │
└─────────────────────────────┘
```

**Contextual empty messages:**
- Built In: "Song library is empty. Contact support."
- Personal: "Upload your first song to get started."
- YouTube: "Search for a YouTube video above to import."

### 11.2 Loading States

**File upload in progress:**
- Overlay on drop zone with spinner
- Disable all interactions
- Status bar: "Uploading {filename}..."

**Beatmap generation in progress:**
- Disable Create Beatmap button
- Show spinner on button
- Button text: "Generating Beatmap..."
- Disable Start Game button

### 11.3 Error States

**Upload failed:**
- Show error toast (top-right corner)
- Status bar: "Upload failed: {reason}"
- Keep UI interactive (allow retry)

**Invalid file type:**
- Highlight invalid files in error color
- Show list of accepted formats
- Allow user to try again

**Network error (YouTube import):**
- Show error in YouTube section
- Provide retry button
- Offer offline alternatives

---

## 12. Performance Guidelines

### 12.1 Rendering Optimization

- Virtualize song list if > 100 items (use `react-window` or similar)
- Debounce keyboard navigation (prevent rapid re-renders)
- Memoize computed values (derived state)
- Use CSS transitions over JavaScript animations

### 12.2 Animation Performance

- Prefer `transform` and `opacity` (GPU-accelerated)
- Avoid animating `width`, `height`, `top`, `left`
- Use `will-change` sparingly on animated elements
- Disable complex animations on low-end devices

### 12.3 Scroll Performance

- Use `scroll-behavior: smooth` for programmatic scrolling
- Implement passive event listeners for touch events
- Throttle scroll event handlers (if any)

---

## 13. Future Enhancements (Not Required Now)

### 13.1 Search & Filter
- Add search input above song list
- Filter songs by name, artist, BPM
- Quick filters: "Recently played", "High scores"

### 13.2 Sorting Options
- Sort by: Name, Date Added, Best Score
- Ascending/Descending toggle

### 13.3 Playlist Management
- Group songs into playlists
- "Recently Played" auto-playlist
- "Favorites" playlist

### 13.4 Song Preview
- Hover to play 10-second preview
- Waveform visualization mini-player

### 13.5 Difficulty Recommendations
- AI-suggested difficulty based on past performance
- "Try Hard mode" badge when ready

---

## 14. Design Tokens Reference

### 14.1 Spacing

```javascript
spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px'
}
```

### 14.2 Border Radius

```javascript
radius = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px'
}
```

### 14.3 Typography

```javascript
fontSize = {
  xs: '12px',   // metadata
  sm: '14px',   // secondary text
  base: '16px', // default
  lg: '18px',   // section headers
  xl: '20px',   // page title
  '2xl': '24px' // hero text
}

fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700
}

lineHeight = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75
}
```

### 14.4 Elevation (Shadows)

```javascript
shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.25)',
  md: '0 4px 8px rgba(0, 0, 0, 0.3)',
  lg: '0 8px 16px rgba(0, 0, 0, 0.35)',
  glow: '0 0 0 4px rgba(56, 189, 248, 0.2)'
}
```

---

## 15. Checklist for Implementation

### Phase 1: Core Layout
- [ ] Responsive grid system (mobile/tablet/desktop)
- [ ] Top navigation tabs with keyboard support
- [ ] Song list panel with scroll
- [ ] Difficulty panel

### Phase 2: Interactions
- [ ] Selection state management
- [ ] Hover/focus/active states for all interactive elements
- [ ] Keyboard navigation (arrows, enter, tab)
- [ ] Beatmap panel conditional rendering

### Phase 3: Polish
- [ ] Animations and transitions
- [ ] Loading states and spinners
- [ ] Empty states
- [ ] Error handling

### Phase 4: Accessibility
- [ ] ARIA roles and labels
- [ ] Screen reader testing
- [ ] Keyboard-only navigation testing
- [ ] Color contrast verification

### Phase 5: Responsive
- [ ] Mobile layout adjustments
- [ ] Touch target sizes
- [ ] Tablet breakpoint
- [ ] Large desktop enhancements

---

## 16. References & Resources

**Design System Inspiration:**
- Spotify (music selection UI)
- Steam (game library grid)
- Guitar Hero / Rock Band (difficulty selection)

**Accessibility Standards:**
- WCAG 2.1 Level AA
- WAI-ARIA 1.2 Authoring Practices

**Testing Tools:**
- Axe DevTools (accessibility audit)
- Lighthouse (performance + a11y)
- VoiceOver / NVDA (screen reader testing)

---

**End of Specification**

*This document should be reviewed and approved by product, design, and engineering leads before implementation begins.*
