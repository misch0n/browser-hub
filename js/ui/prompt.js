import { complete, applyTab } from '../core/completion.js';
import { edit, actionFor, historySearch } from '../core/lineedit.js';

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

  function set(text) {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
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

  function update() {
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
        const v = input.value;
        histIdx = -1;
        set('');
        opts.onSubmit(v);
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
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) update(); });

  return {
    set,
    update,
    reset() { histIdx = -1; search = null; set(''); },
    focus() { input.focus({ preventScroll: true }); },
    blur() { input.blur(); },
    get value() { return input.value; },
  };
}
