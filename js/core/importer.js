import { SCHEMA, parseISO, parseTime, isValidZone, canonicalZone, truncate } from './util.js';
import { validateEntry, SHIPPED_DEFAULT } from './aliases.js';
import { migrateCollections, HISTORY_CAP } from './data.js';
import { isTheme, isWidget, DEFAULT_THEME, DEFAULT_WIDGETS } from './catalog.js';

// Merges an exported file into the current data. The file is untrusted:
// every field is checked, bad entries are skipped and reported, and nothing
// existing is overwritten silently.
//
// current: { meta, aliases, notes, tasks, events, settings, history } (documents)
// Returns { collections, counts, invalid, lines }: `collections` are full replacement
// documents, `lines` explain every skipped or changed entry.

const MAX_TEXT = 10000;

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isStamp = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const clone = (v) => JSON.parse(JSON.stringify(v));

export function merge(current, file, isBuiltin, now) {
  const lines = [];
  if (!file || typeof file !== 'object' || !Number.isInteger(file.schema) || file.schema < 1 ||
      !file.collections || typeof file.collections !== 'object') {
    throw new Error('not a control-center export file');
  }
  if (file.schema > SCHEMA) {
    throw new Error('file is from a newer version (schema ' + file.schema + ')');
  }
  const src = clone(file.collections);
  migrateCollections(src, file.schema);

  const out = clone(current);
  const counters = out.meta.counters;
  const nextId = (prefix) => { counters[prefix] = (counters[prefix] || 0) + 1; return prefix + counters[prefix]; };
  const stamp = (v) => (isStamp(v) ? v : now().toISOString());
  const items = (c) => (src[c] && Array.isArray(src[c].items) ? src[c].items : []);
  const added = { notes: 0, tasks: 0, events: 0, history: 0 };
  let invalid = 0;

  for (const n of items('notes')) {
    if (!n || !isStr(n.text, MAX_TEXT)) { invalid++; continue; }
    out.notes.items.push({ id: nextId('n'), text: n.text, created: stamp(n.created), updated: stamp(n.updated || n.created) });
    added.notes++;
  }

  for (const t of items('tasks')) {
    const due = t && t.due ? t.due : null;
    if (!t || !isStr(t.text, MAX_TEXT) || (due !== null && !parseISO(due))) { invalid++; continue; }
    const tags = Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)) : [];
    out.tasks.items.push({
      id: nextId('t'), text: t.text, due, tags, done: t.done === true,
      created: stamp(t.created), doneAt: t.done === true && isStamp(t.doneAt) ? t.doneAt : null,
    });
    added.tasks++;
  }

  for (const e of items('events')) {
    const time = e && e.time ? e.time : null;
    if (!e || !isStr(e.title, 200) || !parseISO(e.date) || (time !== null && parseTime(time) !== time)) { invalid++; continue; }
    out.events.items.push({ id: nextId('e'), date: e.date, time, title: e.title });
    added.events++;
  }

  // Aliases follow the conflict rules: never overwrite, report every collision.
  const srcAliases = src.aliases && Array.isArray(src.aliases.entries) ? src.aliases.entries : [];
  let aliasesAdded = 0;
  for (const raw of srcAliases) {
    const label = raw && typeof raw.name === 'string' ? truncate(raw.name, 40) : '?';
    const r = validateEntry(raw, isBuiltin);
    if (r.error) { lines.push("skipped alias '" + label + "': " + r.error); continue; }
    const existing = out.aliases.entries.find((x) => x.name === r.entry.name);
    if (existing) { lines.push("skipped alias '" + r.entry.name + "': already exists (" + existing.base + ')'); continue; }
    out.aliases.entries.push(r.entry);
    aliasesAdded++;
  }
  const wantDefault = src.aliases && src.aliases.defaultEngine;
  if (current.aliases.defaultEngine === SHIPPED_DEFAULT && typeof wantDefault === 'string' &&
      wantDefault !== SHIPPED_DEFAULT &&
      out.aliases.entries.some((e) => e.name === wantDefault && e.template && !isBuiltin(e.name))) {
    out.aliases.defaultEngine = wantDefault;
    lines.push("default engine is now '" + wantDefault + "'");
  }

  const zones = src.settings && Array.isArray(src.settings.zones) ? src.settings.zones : [];
  let zonesAdded = 0;
  for (const z of zones) {
    if (typeof z !== 'string' || z.length > 64 || !isValidZone(z)) { invalid++; continue; }
    const canon = canonicalZone(z);
    if (!out.settings.zones.includes(canon)) { out.settings.zones.push(canon); zonesAdded++; }
  }

  const hist = items('history').filter((h) => typeof h === 'string' && h.length > 0 && h.length <= 2000);
  out.history.items.push(...hist);
  added.history = hist.length;
  if (out.history.items.length > HISTORY_CAP) {
    out.history.items.splice(0, out.history.items.length - HISTORY_CAP);
  }

  // Display preferences come along only while this browser still has the defaults.
  const srcSettings = src.settings || {};
  if (current.settings.theme === DEFAULT_THEME && isTheme(srcSettings.theme) && srcSettings.theme !== DEFAULT_THEME) {
    out.settings.theme = srcSettings.theme;
    lines.push('theme is now ' + srcSettings.theme);
  }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (sameList(current.settings.widgets, DEFAULT_WIDGETS) && Array.isArray(srcSettings.widgets)) {
    const ws = srcSettings.widgets.filter((w, i, a) => isWidget(w) && a.indexOf(w) === i);
    if (!sameList(ws, DEFAULT_WIDGETS)) out.settings.widgets = ws;
  }

  const counts = { notes: added.notes, tasks: added.tasks, events: added.events, aliases: aliasesAdded, zones: zonesAdded };
  return { collections: out, counts, invalid, lines };
}
