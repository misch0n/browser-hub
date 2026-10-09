// Names the commands validate against. The UI owns how each one looks.

export const THEMES = [
  { id: 'auto', desc: 'follows the system: claude-light or claude-dark' },
  { id: 'claude-dark', desc: 'warm dark, Claude orange accent' },
  { id: 'claude-light', desc: 'warm paper, Claude orange accent' },
  { id: 'nord', desc: 'cool arctic blues' },
  { id: 'dracula', desc: 'dark with vivid pastels' },
  { id: 'gruvbox', desc: 'retro warm dark' },
  { id: 'solarized-dark', desc: 'Solarized, dark' },
  { id: 'solarized-light', desc: 'Solarized, light' },
  { id: 'contrast', desc: 'high contrast, black background' },
];

export const WIDGETS = [
  { id: 'clock', desc: 'time and date' },
  { id: 'agenda', desc: 'overdue tasks, events and due tasks for the week' },
  { id: 'tasks', desc: 'open tasks; click the circle to complete one' },
  { id: 'calendar', desc: 'this month, event days marked' },
  { id: 'zones', desc: 'your time zones and working-hours overlap' },
  { id: 'notes', desc: 'latest notes' },
  { id: 'backup', desc: 'last export, item counts, storage used' },
  { id: 'timers', desc: 'running timers and stopwatches, live; tap one for its controls' },
];

export const DEFAULT_THEME = 'auto';
export const DEFAULT_WIDGETS = ['clock', 'agenda', 'tasks'];
export const EXPORT_REMINDER_DAYS = 14;

export const isTheme = (id) => THEMES.some((t) => t.id === id);
export const isWidget = (id) => WIDGETS.some((w) => w.id === id);
