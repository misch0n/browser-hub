// Readline-style line editing, as in bash and zsh. Pure: the prompt feeds it
// the text and cursor and applies what comes back.
//
// edit(action, value, cursor, killed) -> { value, cursor, killed } or null when
// the action changes nothing. `killed` is the kill buffer that Ctrl+Y pastes;
// every kill replaces it.

const isWordChar = (ch) => /[\p{L}\p{N}_]/u.test(ch);

// Start of the word before `i` (Alt+B): skip non-word characters, then the word.
function wordStart(value, i) {
  while (i > 0 && !isWordChar(value[i - 1])) i--;
  while (i > 0 && isWordChar(value[i - 1])) i--;
  return i;
}

// End of the word after `i` (Alt+F, Alt+D).
function wordEnd(value, i) {
  while (i < value.length && !isWordChar(value[i])) i++;
  while (i < value.length && isWordChar(value[i])) i++;
  return i;
}

// Start of the whitespace-separated word before `i` (Ctrl+W), so a URL or a
// path goes in one press.
function bigWordStart(value, i) {
  while (i > 0 && /\s/.test(value[i - 1])) i--;
  while (i > 0 && !/\s/.test(value[i - 1])) i--;
  return i;
}

function kill(value, from, to) {
  if (from === to) return null;
  return { value: value.slice(0, from) + value.slice(to), cursor: from, killed: value.slice(from, to) };
}

function move(value, cursor, killed, to) {
  return to === cursor ? null : { value, cursor: to, killed };
}

export function edit(action, value, cursor, killed) {
  switch (action) {
    case 'start': return move(value, cursor, killed, 0);
    case 'end': return move(value, cursor, killed, value.length);
    case 'back-char': return move(value, cursor, killed, Math.max(0, cursor - 1));
    case 'forward-char': return move(value, cursor, killed, Math.min(value.length, cursor + 1));
    case 'back-word': return move(value, cursor, killed, wordStart(value, cursor));
    case 'forward-word': return move(value, cursor, killed, wordEnd(value, cursor));
    case 'kill-start': return kill(value, 0, cursor);
    case 'kill-end': return kill(value, cursor, value.length);
    case 'kill-big-word-back': return kill(value, bigWordStart(value, cursor), cursor);
    case 'kill-word-back': return kill(value, wordStart(value, cursor), cursor);
    case 'kill-word-forward': return kill(value, cursor, wordEnd(value, cursor));
    case 'delete-char': {
      if (cursor >= value.length) return null;
      return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor, killed };
    }
    case 'yank': {
      if (!killed) return null;
      return { value: value.slice(0, cursor) + killed + value.slice(cursor), cursor: cursor + killed.length, killed };
    }
    default: return null;
  }
}

// Which action a key press means, or null. Ctrl+key on every platform; the
// Meta words use Alt (Option on a Mac, where e.key is a symbol, so match
// e.code). Cmd and AltGr-style Ctrl+Alt chords are left to the system.
const CTRL = { a: 'start', e: 'end', b: 'back-char', f: 'forward-char', u: 'kill-start', k: 'kill-end',
  w: 'kill-big-word-back', d: 'delete-char', y: 'yank' };
const ALT = { KeyB: 'back-word', KeyF: 'forward-word', KeyD: 'kill-word-forward', Backspace: 'kill-word-back' };

export function actionFor(e) {
  if (e.metaKey || e.shiftKey) return null;
  if (e.ctrlKey && !e.altKey) return CTRL[(e.key || '').toLowerCase()] || null;
  if (e.altKey && !e.ctrlKey) return ALT[e.code] || null;
  return null;
}
