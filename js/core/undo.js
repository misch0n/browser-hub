// Undo as patches: what one command changed, item by item, so undoing it
// only touches those items and can tell when something else has changed
// them since (another tab, a sync from another device).
//
// patch = { col, arr?, key?, before: { k: item | null }, after: { k: item | null },
//           fields: { before: {}, after: {} } }
// For collections with a list (notes/tasks/events items by id, aliases
// entries by name), `before`/`after` hold each changed item, null meaning
// absent. Every other top-level field that changed goes in `fields`.

import { canonical } from './merge.js';

export const UNDOABLE = ['aliases', 'notes', 'tasks', 'events', 'settings', 'log'];
const LISTS = { notes: ['items', 'id'], tasks: ['items', 'id'], events: ['items', 'id'], aliases: ['entries', 'name'] };

const same = (a, b) => canonical(a) === canonical(b);
const idNum = (id) => parseInt(String(id).slice(1), 10);

// The patch from `before` to `after` for collection `col`, or null if nothing changed.
export function diff(col, before, after) {
  const p = { col, before: {}, after: {}, fields: { before: {}, after: {} } };
  const list = LISTS[col];
  let changed = false;
  if (list) {
    const [arr, key] = list;
    p.arr = arr;
    p.key = key;
    const b = new Map((before[arr] || []).map((x) => [x[key], x]));
    const a = new Map((after[arr] || []).map((x) => [x[key], x]));
    for (const k of new Set([...b.keys(), ...a.keys()])) {
      const bx = b.has(k) ? b.get(k) : null;
      const ax = a.has(k) ? a.get(k) : null;
      if (!same(bx, ax)) { p.before[k] = bx; p.after[k] = ax; changed = true; }
    }
  }
  for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (list && f === list[0]) continue;
    if (!same(before[f], after[f])) {
      p.fields.before[f] = before[f];
      p.fields.after[f] = after[f];
      changed = true;
    }
  }
  return changed ? JSON.parse(JSON.stringify(p)) : null;
}

// Keys (or fields) whose current value is no longer what the patch left
// behind in direction `from` ('after' when undoing, 'before' when redoing).
export function conflicts(doc, patch, from) {
  const out = [];
  if (patch.arr) {
    const cur = new Map((doc[patch.arr] || []).map((x) => [x[patch.key], x]));
    for (const k of Object.keys(patch[from])) {
      if (!same(cur.has(k) ? cur.get(k) : null, patch[from][k])) out.push(k);
    }
  }
  for (const f of Object.keys(patch.fields[from])) {
    if (!same(doc[f], patch.fields[from][f])) out.push(f);
  }
  return out;
}

// Applies the patch's `to` side ('before' to undo, 'after' to redo) to `doc` in place.
export function apply(doc, patch, to) {
  if (patch.arr) {
    const list = (doc[patch.arr] || []).filter((x) => !Object.prototype.hasOwnProperty.call(patch[to], x[patch.key]));
    for (const k of Object.keys(patch[to])) if (patch[to][k] !== null) list.push(JSON.parse(JSON.stringify(patch[to][k])));
    if (patch.key === 'id') list.sort((a, b) => idNum(a.id) - idNum(b.id));
    doc[patch.arr] = list;
  }
  for (const f of Object.keys(patch.fields[to])) {
    if (patch.fields[to][f] === undefined) delete doc[f];
    else doc[f] = JSON.parse(JSON.stringify(patch.fields[to][f]));
  }
  return doc;
}

// One line about what a step changed: 'tasks t3 removed', 'notes n1 changed', 'settings'.
export function describe(patches) {
  const parts = [];
  for (const p of patches) {
    if (!p.arr) { parts.push(p.col); continue; }
    const keys = Object.keys(p.after);
    const what = (k) => (p.before[k] === null ? ' added' : p.after[k] === null ? ' removed' : ' changed');
    if (keys.length <= 3) parts.push(...keys.map((k) => p.col.replace(/s$/, '') + ' ' + k + what(k)));
    else parts.push(keys.length + ' ' + p.col + ' changed');
    if (Object.keys(p.fields.after).length) parts.push(p.col + ' ' + Object.keys(p.fields.after).join(', '));
  }
  return parts.join(', ');
}

// True if the step removed anything (worth offering "undo" right away).
export const removes = (patches) => patches.some((p) => p.arr && Object.values(p.after).some((v) => v === null));
