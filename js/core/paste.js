// Long pastes in the prompt, as in Claude's CLI: a paste of several lines (or
// a very long one) shows as a placeholder, `[Pasted text #1 +12 lines]`.
// Moving the cursor into it puts the text itself there; Backspace right after
// it (or Delete right before it) removes the whole paste. The command gets the
// full text; the transcript echoes the placeholder.
//
// The prompt is a single line, so line breaks in expanded text show as ⏎ and
// become real line breaks again when the command runs.

export const NL = '⏎';
const LONG = 200;

export const shouldCollapse = (text) => /[\r\n]/.test(text) || text.length > LONG;
export const toField = (text) => String(text).replace(/\r\n?|\n/g, NL);
export const fromField = (value) => String(value).split(NL).join('\n');

export function labelFor(text, n) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length;
  return lines > 1 ? '[Pasted text #' + n + ' +' + lines + ' lines]' : '[Pasted text #' + n + ', ' + text.length.toLocaleString('en') + ' characters]';
}

// Where the placeholders are in `value`: [{ label, start, end }].
export function placeholders(value, pastes) {
  const out = [];
  for (const label of pastes.keys()) {
    let i = value.indexOf(label);
    while (i >= 0) {
      out.push({ label, start: i, end: i + label.length });
      i = value.indexOf(label, i + label.length);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// The command to run: placeholders replaced by their text, ⏎ by line breaks.
export function expandAll(value, pastes) {
  let v = value;
  for (const p of placeholders(value, pastes).reverse()) v = v.slice(0, p.start) + toField(pastes.get(p.label)) + v.slice(p.end);
  return fromField(v);
}

// The cursor inside a placeholder (not at its edges): the text goes in its place.
// -> { value, caret } or null
export function expandAt(value, caret, pastes) {
  const p = placeholders(value, pastes).find((x) => caret > x.start && caret < x.end);
  if (!p) return null;
  const text = toField(pastes.get(p.label));
  return { value: value.slice(0, p.start) + text + value.slice(p.end), caret: p.start + text.length, label: p.label };
}

// Backspace just after a placeholder, or Delete just before one: the whole paste goes.
export function removeAt(value, caret, key, pastes) {
  const p = placeholders(value, pastes).find((x) => (key === 'Backspace' ? caret === x.end : caret === x.start));
  if (!p) return null;
  return { value: value.slice(0, p.start) + value.slice(p.end), caret: p.start, label: p.label };
}
