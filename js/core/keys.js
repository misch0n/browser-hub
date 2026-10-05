// Keyboard shortcuts, described once and labelled for the platform: a Mac
// shows ⌃R and ⌥B (Control and Option), everything else Ctrl+R and Alt+B.

// 'mac' | 'ios' | 'windows' | 'android' | 'linux' | 'other', from a navigator-like object.
export function detectOS(nav) {
  const n = nav || {};
  const platform = String((n.userAgentData && n.userAgentData.platform) || n.platform || '');
  const ua = String(n.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && n.maxTouchPoints > 1)) return 'ios'; // iPadOS says Mac
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) return 'mac';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Android/i.test(ua)) return 'android';
  if (/Linux|X11|CrOS/i.test(platform + ' ' + ua)) return 'linux';
  return 'other';
}

export const isApple = (os) => os === 'mac' || os === 'ios';

const MAC = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘', backspace: '⌫', enter: '↩', esc: 'esc', tab: '⇥' };
const PC = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', cmd: 'Win', backspace: 'Backspace', enter: 'Enter', esc: 'Esc', tab: 'Tab' };

// 'ctrl+r' -> '⌃R' on a Mac, 'Ctrl+R' elsewhere. Single keys pass through
// ('/', '↑'), and named keys get the platform's name.
export function keyLabel(chord, os) {
  const apple = isApple(os);
  const names = apple ? MAC : PC;
  const parts = chord.split('+').map((p) => {
    const k = p.toLowerCase();
    if (names[k]) return names[k];
    return p.length === 1 ? p.toUpperCase() : p;
  });
  return apple ? parts.join('') : parts.join('+');
}

// Each entry: { keys: [chord, ...] (alternatives), desc, pc?: desc on Windows/Linux }.
export const SHORTCUT_GROUPS = [
  {
    name: 'Run and complete',
    items: [
      { keys: ['enter'], desc: 'run the command' },
      { keys: ['tab'], desc: 'complete; again to list candidates; fixes a typo' },
      { keys: ['→'], desc: 'accept the grey suggestion' },
      { keys: ['esc'], desc: 'clear the prompt, close the palette or the widget drawer' },
    ],
  },
  {
    name: 'Find things',
    items: [
      { keys: ['/'], desc: 'command palette (on an empty prompt)' },
      { keys: ['?'], desc: 'these shortcuts (on an empty prompt)' },
      { keys: ['↑', '↓'], desc: 'walk command history' },
      { keys: ['ctrl+r'], desc: 'search history: type to filter, again for older, Enter runs, Tab edits, Esc cancels' },
    ],
  },
  {
    name: 'Edit the line',
    items: [
      { keys: ['ctrl+a', 'ctrl+e'], desc: 'start / end of the line' },
      { keys: ['ctrl+b', 'ctrl+f'], desc: 'back / forward one character' },
      { keys: ['alt+b', 'alt+f'], desc: 'back / forward one word' },
      {
        keys: ['ctrl+w', 'alt+backspace'], desc: 'cut the word before the cursor',
        pc: 'cut the word before the cursor (the browser keeps Ctrl+W for closing the tab: use Alt+Backspace)',
      },
      { keys: ['ctrl+u', 'ctrl+k'], desc: 'cut to the start / end of the line' },
      { keys: ['alt+d', 'ctrl+d'], desc: 'cut the next word / delete the next character' },
      { keys: ['ctrl+y'], desc: 'paste the last cut text' },
    ],
  },
];
