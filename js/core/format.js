// Pure formatting shared by command output and widgets. Rich text is a list of
// segments: [text, cls], where cls is a semantic tone the stylesheet colours
// ('ok' 'err' 'warn' 'info' 'dim' 'faint' 'accent' 'strong' 'id' 'tag' 'date' 'num' 'url').

import { parseISO, daysBetween } from './util.js';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
export const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 'Tuesday 6 October', or 'Tuesday 6 October 2027' outside the current year.
// Day and month names are always written in full.
export function longDate(iso, today) {
  const d = parseISO(iso);
  const s = DAY_NAMES_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
  return today && iso.slice(0, 4) === today.slice(0, 4) ? s : s + ' ' + d.getFullYear();
}

// 'today' / 'tomorrow' / 'yesterday' / 'Tuesday 6 October'.
export function dayLabel(iso, today) {
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return longDate(iso, today);
}

// A due date as a coloured segment: overdue red, today amber, soon blue.
export function dueSeg(due, today, done) {
  if (!due) return ['', 'faint'];
  if (done) return [longDate(due, today), 'faint'];
  const n = daysBetween(today, due);
  if (n < 0) return [(n === -1 ? '1 day' : -n + ' days') + ' overdue', 'err'];
  if (n === 0) return ['today', 'warn'];
  if (n === 1) return ['tomorrow', 'info'];
  if (n < 7) return [longDate(due, today), 'date'];
  return [longDate(due, today), 'dim'];
}

export const tagSegs = (tags) => tags.map((t) => ['#' + t, 'tag']);

// Splits a usage line into a highlighted command name and dimmed arguments.
export function usageSegs(usage) {
  const i = usage.indexOf(' ');
  return i < 0 ? [[usage, 'accent']] : [[usage.slice(0, i), 'accent'], [usage.slice(i), 'dim']];
}

// Syntax colouring for pretty-printed JSON: one segment list per line.
export function jsonLines(text) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  return text.split('\n').map((line) => {
    const segs = [];
    let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      if (m.index > last) segs.push([line.slice(last, m.index), 'dim']);
      if (m[1]) {
        segs.push([m[1], m[2] ? 'id' : 'ok']);
        if (m[2]) segs.push([m[2], 'dim']);
      } else if (m[3]) segs.push([m[3], 'accent']);
      else if (m[4]) segs.push([m[4], 'faint']);
      else segs.push([m[5], 'num']);
      last = re.lastIndex;
    }
    if (last < line.length) segs.push([line.slice(last), 'dim']);
    return segs;
  });
}

export function bytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// What a name is, as a short coloured label, the same everywhere (help, the
// palette, Tab lists, the hint): built-in commands by their group, the
// user's own aliases and engines, and settings.
const GROUP_LABELS = { 'Aliases & engines': 'links' };
export function kindSeg(kind) {
  if (kind === 'alias') return ['your alias', 'k-alias'];
  if (kind === 'command') return ['your command alias', 'k-alias'];
  if (kind === 'engine') return ['your engine', 'k-engine'];
  if (kind === 'theme' || kind === 'widget') return [kind, 'k-set'];
  return [GROUP_LABELS[kind] || String(kind).toLowerCase(), 'k-cmd'];
}
