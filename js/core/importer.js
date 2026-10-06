import { SCHEMA, parseISO, parseTime, isValidZone, canonicalZone, truncate } from './util.js';
import { validateEntry, siteRoot, SHIPPED_DEFAULT } from './aliases.js';
import { SNIPPET_NAME, linkURL, KINDS } from './records.js';
import { parseRepeat } from './repeat.js';
import { migrateCollections, HISTORY_CAP } from './data.js';
import { isTheme, isWidget, DEFAULT_THEME, DEFAULT_WIDGETS } from './catalog.js';

// Merges an exported file into the current data. The file is untrusted:
// every field is checked, bad entries are skipped and reported, and nothing
// existing is overwritten silently.
//
// current: { meta, aliases, notes, tasks, events, snippets, later, settings, history } (documents)
// Returns { collections, counts, invalid, lines }: `collections` are full replacement
// documents, `lines` explain every skipped or changed entry.

const MAX_TEXT = 10000;

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isStamp = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const clone = (v) => JSON.parse(JSON.stringify(v));

// An xsearch (Safari extension) export is a plain object of name -> URL with
// %s: { "mobile": "https://…%s…" }. Read it as a file of aliases.
function fromXsearch(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file) || 'schema' in file || 'collections' in file) return null;
  const pairs = Object.entries(file);
  if (!pairs.length || !pairs.every(([, v]) => typeof v === 'string' && /^https?:\/\//i.test(v))) return null;
  const entries = pairs.map(([name, url]) => {
    const template = /%s|\{[1-9]?\}/.test(url) ? url : undefined;
    return { name, base: template ? siteRoot(url) : url, template, escape: 'query' };
  });
  return { schema: SCHEMA, collections: { aliases: { entries } } };
}

export function merge(current, file, isBuiltin, now) {
  const lines = [];
  const xs = fromXsearch(file);
  if (xs) {
    file = xs;
    lines.push('read as an xsearch export: ' + xs.collections.aliases.entries.length + ' search engines');
  }
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
  const added = { notes: 0, tasks: 0, events: 0, snippets: 0, later: 0, foods: 0, history: 0 };
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
    const task = {
      id: nextId('t'), text: t.text, due, tags, done: t.done === true,
      created: stamp(t.created), doneAt: t.done === true && isStamp(t.doneAt) ? t.doneAt : null,
    };
    const repeat = typeof t.repeat === 'string' ? parseRepeat(t.repeat) : null;
    if (repeat) {
      task.repeat = repeat;
      if (isStamp(t.lastDone)) task.lastDone = t.lastDone;
      if (Number.isInteger(t.doneCount) && t.doneCount > 0) task.doneCount = t.doneCount;
    }
    out.tasks.items.push(task);
    added.tasks++;
  }

  for (const e of items('events')) {
    const time = e && e.time ? e.time : null;
    if (!e || !isStr(e.title, 200) || !parseISO(e.date) || (time !== null && parseTime(time) !== time)) { invalid++; continue; }
    out.events.items.push({ id: nextId('e'), date: e.date, time, title: e.title });
    added.events++;
  }

  // Snippets go by name: one already here with that name keeps its text.
  for (const s of items('snippets')) {
    const name = s && typeof s.name === 'string' ? s.name.toLowerCase() : '';
    if (!SNIPPET_NAME.test(name) || /^s\d+$/.test(name) || !isStr(s.text, MAX_TEXT)) { invalid++; continue; }
    if (out.snippets.items.some((x) => x.name === name)) { lines.push("skipped snippet '" + name + "': already exists"); continue; }
    out.snippets.items.push({ id: nextId('s'), name, text: s.text, created: stamp(s.created), updated: stamp(s.updated || s.created) });
    added.snippets++;
  }

  for (const l of items('later')) {
    const url = l && typeof l.url === 'string' ? linkURL(l.url) : null;
    if (!url || (l.title != null && !isStr(l.title, 200))) { invalid++; continue; }
    if (out.later.items.some((x) => x.url === url)) continue; // saved here already
    const read = l.read === true;
    out.later.items.push({ id: nextId('l'), url, title: l.title || null, read, readAt: read && isStamp(l.readAt) ? l.readAt : null, created: stamp(l.created) });
    added.later++;
  }

  // Your foods: each value checked like an edit; one with the same name here already is kept.
  for (const f of items('foods')) {
    if (!f || !isStr(f.name, 80)) { invalid++; continue; }
    const food = { id: null, name: f.name.trim(), created: stamp(f.created), updated: stamp(f.updated || f.created), portionG: null, portionName: null };
    let ok = true;
    for (const k of ['kcal', 'protein', 'fat', 'carbs', 'sugar', 'fiber', 'sat', 'salt']) {
      const v = f[k] === null || f[k] === undefined ? 'none' : String(f[k]);
      const r = KINDS.food.fields[k].parse(v);
      if (r.error) { ok = false; break; }
      food[k] = r.value;
    }
    if (f.portionG && typeof f.portionName === 'string') {
      const r = KINDS.food.fields.portion.parse(f.portionName + ' = ' + f.portionG + ' g');
      if (r.error) ok = false; else { food.portionG = r.value.g; food.portionName = r.value.name; }
    }
    if (!ok) { invalid++; continue; }
    if (out.foods.items.some((x) => x.name.toLowerCase() === food.name.toLowerCase())) { lines.push("skipped food '" + food.name + "': already exists"); continue; }
    food.id = nextId('f');
    out.foods.items.push(food);
    added.foods++;
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
  // Clock names come along for zones that have none here yet.
  const srcNames = src.settings && src.settings.zoneNames;
  if (!out.settings.zoneNames || typeof out.settings.zoneNames !== 'object') out.settings.zoneNames = {};
  if (srcNames && typeof srcNames === 'object' && !Array.isArray(srcNames)) {
    for (const z of Object.keys(srcNames)) {
      const name = srcNames[z];
      if (typeof name !== 'string' || !name.trim() || name.length > 32 || z.length > 64 || !isValidZone(z)) continue;
      const canon = canonicalZone(z);
      if (!Object.prototype.hasOwnProperty.call(out.settings.zoneNames, canon)) out.settings.zoneNames[canon] = name.trim();
    }
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

  const counts = { notes: added.notes, tasks: added.tasks, events: added.events, snippets: added.snippets, later: added.later, foods: added.foods, aliases: aliasesAdded, zones: zonesAdded };
  return { collections: out, counts, invalid, lines };
}
