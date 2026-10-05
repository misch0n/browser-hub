(function (CC) {
  'use strict';

  // Merges an exported file into the current data. The file is untrusted:
  // every field is checked, bad entries are skipped and reported, and nothing
  // existing is overwritten silently.
  //
  // current: { meta, aliases, notes, tasks, events, settings, history } (documents)
  // Returns { collections, lines } where `collections` are full replacement documents.

  const { parseISO, parseTime, isValidZone, canonicalZone, truncate } = CC.util;
  const MAX_TEXT = 10000;

  const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const isStamp = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function merge(current, file, isBuiltin, now) {
    const lines = [];
    if (!file || typeof file !== 'object' || typeof file.schema !== 'number' ||
        !file.collections || typeof file.collections !== 'object') {
      throw new Error('not a control-center export file');
    }
    if (file.schema > CC.SCHEMA) {
      throw new Error('file is from a newer version (schema ' + file.schema + ')');
    }
    const src = clone(file.collections);
    CC.dataInternals.migrateCollections(src, file.schema);

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
      const r = CC.aliases.validateEntry(raw, isBuiltin);
      if (r.error) { lines.push("skipped alias '" + label + "': " + r.error); continue; }
      const existing = out.aliases.entries.find((x) => x.name === r.entry.name);
      if (existing) { lines.push("skipped alias '" + r.entry.name + "': already exists (" + existing.base + ')'); continue; }
      out.aliases.entries.push(r.entry);
      aliasesAdded++;
    }
    const wantDefault = src.aliases && src.aliases.defaultEngine;
    if (current.aliases.defaultEngine === CC.aliases.SHIPPED_DEFAULT && typeof wantDefault === 'string' &&
        wantDefault !== CC.aliases.SHIPPED_DEFAULT &&
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
    if (out.history.items.length > CC.dataInternals.HISTORY_CAP) {
      out.history.items.splice(0, out.history.items.length - CC.dataInternals.HISTORY_CAP);
    }

    lines.unshift('imported ' + added.notes + ' notes, ' + added.tasks + ' tasks, ' + added.events + ' events, ' +
      aliasesAdded + ' aliases, ' + zonesAdded + ' time zones' +
      (invalid ? ' (' + invalid + ' invalid entries skipped)' : ''));
    return { collections: out, lines };
  }

  CC.importer = { merge };
})((globalThis.CC = globalThis.CC || {}));
