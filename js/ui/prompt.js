import { complete, applyTab } from '../core/completion.js';

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
    const rest = ghostFor(v);
    ghostTyped.textContent = rest ? v : '';
    ghostRest.textContent = rest;
    opts.hint(v, rest, histIdx === -1 ? null : { at: histIdx + 1, of: opts.history().length });
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
    reset() { histIdx = -1; set(''); },
    focus() { input.focus({ preventScroll: true }); },
    blur() { input.blur(); },
    get value() { return input.value; },
  };
}
