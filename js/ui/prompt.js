import { complete, applyTab } from '../core/completion.js';
import { edit, actionFor, historySearch } from '../core/lineedit.js';
import { shouldCollapse, labelFor, expandAll, expandAt, removeAt, toField } from '../core/paste.js';

// The input line: ghost-text completion, Tab, history, and a live hint that
// says what Enter would do.
//
// opts: { input, ghostTyped, ghostRest, hint, env(), history(), describe(value) -> segments,
//         onSubmit(value), onPalette(), onShortcuts(), onEscape() -> bool (true if handled),
//         onList(input, candidates) }
export function createPrompt(opts) {
  const { input, ghostTyped, ghostRest } = opts;
  let histIdx = -1;
  let draft = '';
  let composing = false;
  let killed = ''; // what Ctrl+Y pastes: the last text cut by Ctrl+W/U/K or Alt+D/Backspace
  // Ctrl+R history search, as in bash: the prompt holds the query, the hint
  // shows the match. { query, idx, saved } while searching, else null.
  let search = null;
  // askSecret(): the next Enter hands over the text instead of running it,
  // with the field masked; it is never echoed or kept in history.
  let secret = null; // { resolve, placeholder }
  // Long pastes, shown as placeholders until the cursor goes into one (core/paste.js).
  const pastes = new Map();
  let pasteN = 0;

  // Puts `text` in the field; a recalled multi-line command shows as a placeholder again.
  function set(text) {
    let v = String(text);
    if (/[\r\n]/.test(v)) {
      const m = /^(\S+\s+)([\s\S]*)$/.exec(v);
      const body = m ? m[2] : v;
      const label = labelFor(body, ++pasteN);
      pastes.set(label, body);
      v = (m ? m[1] : '') + label;
    }
    input.value = toField(v);
    input.setSelectionRange(input.value.length, input.value.length);
    update();
  }

  function insertAtCursor(text) {
    const a = input.selectionStart, b = input.selectionEnd;
    input.value = input.value.slice(0, a) + text + input.value.slice(b);
    input.setSelectionRange(a + text.length, a + text.length);
    histIdx = -1;
    update();
  }

  function ghostFor(v) {
    if (!v || input.selectionStart !== v.length || input.selectionEnd !== v.length) return '';
    // The ghost is drawn in a layer under the input; once the text scrolls
    // horizontally the two no longer line up, so don't draw it.
    if (input.scrollWidth > input.clientWidth + 1) return '';
    const { token, candidates } = complete(v, opts.env());
    if (!token || !candidates.length) return '';
    return candidates[0].value.slice(token.length);
  }

  function endSecret(value) {
    const s = secret;
    secret = null;
    input.type = 'text';
    input.placeholder = s.placeholder;
    input.value = '';
    update();
    s.resolve(value);
  }

  function update() {
    // The cursor went into a paste placeholder: show the text itself.
    if (!secret && pastes.size && input.selectionStart === input.selectionEnd) {
      const r = expandAt(input.value, input.selectionStart, pastes);
      if (r) {
        input.value = r.value;
        input.setSelectionRange(r.caret, r.caret);
      }
    }
    if (secret) {
      ghostTyped.textContent = '';
      ghostRest.textContent = '';
      opts.hint('', '', null, null, { secret: true });
      return;
    }
    const v = input.value;
    if (search && v !== search.query) {
      // The query changed: look again from the newest entry.
      search.query = v;
      search.idx = historySearch(opts.history(), v, Infinity, null);
    }
    const rest = search ? '' : ghostFor(v);
    ghostTyped.textContent = rest ? v : '';
    ghostRest.textContent = rest;
    const match = search && search.idx >= 0 ? opts.history()[search.idx] : null;
    opts.hint(v, rest, histIdx === -1 ? null : { at: histIdx + 1, of: opts.history().length },
      search ? { query: v, match } : null);
  }

  function startOrOlder() {
    const items = opts.history();
    if (!search) {
      search = { query: input.value, idx: historySearch(items, input.value, Infinity, null), saved: input.value };
    } else if (search.idx >= 0) {
      const older = historySearch(items, search.query, search.idx, items[search.idx]);
      if (older >= 0) search.idx = older;
    }
    histIdx = -1;
    update();
  }

  // Leaves search mode. `text` goes into the prompt (the match, or what was
  // there before on cancel).
  function endSearch(text) {
    search = null;
    set(text);
  }

  function walk(dir) {
    const items = opts.history();
    if (dir < 0) {
      if (!items.length) return;
      if (histIdx === -1) { draft = input.value; histIdx = items.length; }
      if (histIdx > 0) histIdx--;
      set(items[histIdx]);
    } else {
      if (histIdx === -1) return;
      histIdx++;
      if (histIdx >= items.length) { histIdx = -1; set(draft); } else set(items[histIdx]);
    }
  }

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { setTimeout(() => { composing = false; }, 0); });

  input.addEventListener('keydown', (e) => {
    // Safari fires compositionend *before* the keydown of the Enter that
    // confirms an IME conversion; keyCode 229 marks that keydown.
    if (e.isComposing || composing || e.keyCode === 229) return;
    if (secret) {
      if (e.key === 'Enter') { e.preventDefault(); endSecret(input.value.trim() || null); }
      else if (e.key === 'Escape') { e.preventDefault(); endSecret(null); }
      return; // nothing else: no completion, history or line editing on a secret
    }
    const action = actionFor(e);
    if (action === 'history-search') { e.preventDefault(); startOrOlder(); return; }
    if (search) {
      const match = search.idx >= 0 ? opts.history()[search.idx] : null;
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = match || input.value;
        search = null;
        set('');
        opts.onSubmit(v);
        return;
      }
      if (e.key === 'Escape' || action === 'cancel') { e.preventDefault(); endSearch(search.saved); return; }
      // Keys that move or complete take the match into the prompt to edit.
      if (['Tab', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key) || action === 'start' || action === 'end') {
        e.preventDefault();
        endSearch(match || input.value);
        return;
      }
    }
    if (action === 'cancel') return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && pastes.size && input.selectionStart === input.selectionEnd) {
      const r = removeAt(input.value, input.selectionStart, e.key, pastes);
      if (r) {
        e.preventDefault();
        input.value = r.value;
        input.setSelectionRange(r.caret, r.caret);
        histIdx = -1;
        update();
        return;
      }
    }
    if (action) {
      // Handled even when nothing changes, so Ctrl+A never selects the page
      // and Ctrl+E / Ctrl+K never jump to the browser's search box.
      e.preventDefault();
      const r = edit(action, input.value, input.selectionStart, killed);
      if (!r) return;
      killed = r.killed;
      if (r.value !== input.value) { histIdx = -1; input.value = r.value; }
      input.setSelectionRange(r.cursor, r.cursor);
      update();
      return;
    }
    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        // The command gets the pasted text; the transcript shows what was in the field.
        const shown = input.value;
        const v = expandAll(shown, pastes);
        histIdx = -1;
        pastes.clear();
        set('');
        opts.onSubmit(v, shown);
        break;
      }
      case 'Tab': {
        e.preventDefault(); // focus never leaves the prompt
        const r = applyTab(input.value, opts.env());
        if (r.input !== undefined) set(r.input);
        else if (r.list) opts.onList(input.value, r.list);
        break;
      }
      case 'ArrowUp': e.preventDefault(); walk(-1); break;
      case 'ArrowDown': e.preventDefault(); walk(1); break;
      case 'ArrowRight':
        // Like a shell: → at the end of the line accepts the ghost text.
        if (ghostRest.textContent && input.selectionStart === input.value.length) {
          e.preventDefault();
          set(input.value + ghostRest.textContent);
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (opts.onEscape()) break;
        histIdx = -1;
        set('');
        break;
      case '/':
      case '?':
        if (input.value === '' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          (e.key === '/' ? opts.onPalette : opts.onShortcuts)();
        }
        break;
      default:
    }
  });

  input.addEventListener('input', () => { histIdx = -1; update(); });
  input.addEventListener('paste', (e) => {
    if (secret) return; // a token goes in as it is
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text || !shouldCollapse(text)) return;
    e.preventDefault();
    const label = labelFor(text, ++pasteN);
    pastes.set(label, text);
    insertAtCursor(label);
  });
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) update(); });

  return {
    // Asks for a secret (a token) in the prompt: masked, not echoed, not in
    // history. Resolves to the text, or null on Esc.
    askSecret(label) {
      if (secret) endSecret(null);
      return new Promise((resolve) => {
        secret = { resolve, placeholder: input.placeholder };
        histIdx = -1;
        search = null;
        input.value = '';
        input.type = 'password';
        input.placeholder = label;
        update();
        input.focus({ preventScroll: true });
      });
    },
    get askingSecret() { return !!secret; },
    // Acts as if `spec` were pressed in the prompt: 'Escape', 'Tab', 'ArrowUp',
    // 'ctrl+r' … (the phone key bar).
    press(spec) {
      const m = /^ctrl\+(.)$/i.exec(spec);
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: m ? m[1].toLowerCase() : spec, code: m ? 'Key' + m[1].toUpperCase() : spec,
        ctrlKey: !!m, bubbles: true, cancelable: true,
      }));
    },
    set,
    update,
    reset() { if (secret) endSecret(null); histIdx = -1; search = null; pastes.clear(); set(''); },
    focus() { input.focus({ preventScroll: true }); },
    blur() { input.blur(); },
    get value() { return input.value; },
  };
}
