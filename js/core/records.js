// Editable fields of notes, tasks, events and aliases. Pure: reading the
// command, checking the new value and producing the changed record. Commands
// in commands/records.js do the saving and printing.
//
//   n edit n1.text buy flour            field edit: <id>.<field> <value>
//   t edit t3.due fri
//   ev edit e2.time none
//   alias edit gh.template https://github.com/{}
//
// The value is everything after the field, as typed; one quoted argument is
// unquoted, which is how to keep leading spaces or say "none" literally.

import { oneValue } from './args.js';
import { parseDate, parseTime, parseISO, parseId, todayISO } from './util.js';
import { validateEntry } from './aliases.js';
import { parseRepeat, firstDue } from './repeat.js';

const NONE = /^(none|-|clear)$/i;
const MAX_TEXT = 10000;

const text = (max) => (v) => {
  const t = v.trim();
  if (!t) return { error: 'needs some text' };
  if (t.length > max) return { error: 'is too long (' + max + ' characters at most)' };
  return { value: t };
};

export const KINDS = {
  note: {
    col: 'notes', cmd: 'n', prefix: 'n', label: 'note',
    fields: {
      text: { aliases: ['name', 'body', 'title'], parse: text(MAX_TEXT), raw: (x) => x.text },
    },
  },
  task: {
    col: 'tasks', cmd: 't', prefix: 't', label: 'task',
    fields: {
      text: { aliases: ['name', 'title'], parse: text(MAX_TEXT), raw: (x) => x.text },
      due: {
        aliases: ['date'],
        raw: (x) => x.due || 'none',
        parse(v, env) {
          if (NONE.test(v.trim())) return { value: null };
          const d = parseDate(v.trim(), env.now());
          return d ? { value: d } : { error: "can't read the date '" + v.trim() + "' (try 2026-10-31, tomorrow, fri, +3d or none)" };
        },
      },
      tags: {
        aliases: ['tag'],
        raw: (x) => (x.tags.length ? x.tags.map((t) => '#' + t).join(' ') : 'none'),
        parse(v) {
          if (NONE.test(v.trim())) return { value: [] };
          const tags = [];
          for (const w of v.split(/[\s,]+/).filter(Boolean)) {
            const t = w.replace(/^#/, '').toLowerCase();
            if (!/^[\w-]{1,40}$/.test(t)) return { error: "'" + w + "' is not a tag (letters, digits, _ and -)" };
            if (!tags.includes(t)) tags.push(t);
          }
          return { value: tags };
        },
      },
      repeat: {
        aliases: ['every', 'recur'],
        raw: (x) => x.repeat || 'none',
        parse(v) {
          if (NONE.test(v.trim())) return { value: null };
          const r = parseRepeat(v.replace(/^every:?\s*/i, ''));
          return r ? { value: r } : { error: "can't read '" + v.trim() + "' (try day, weekday, week, 2w, month, mon,thu or none)" };
        },
        apply(item, value, env) {
          if (value) {
            item.repeat = value;
            if (!item.due) item.due = firstDue(value, todayISO(env.now()));
            item.done = false;
            item.doneAt = null;
          } else {
            delete item.repeat;
          }
        },
      },
      done: {
        aliases: ['status'],
        raw: (x) => (x.done ? 'yes' : 'no'),
        parse(v) {
          const s = v.trim().toLowerCase();
          if (['yes', 'y', 'true', 'done', '1'].includes(s)) return { value: true };
          if (['no', 'n', 'false', 'open', '0', 'undone'].includes(s)) return { value: false };
          return { error: 'is yes or no' };
        },
        apply(item, value, env) {
          item.done = value;
          item.doneAt = value ? item.doneAt || env.now().toISOString() : null;
        },
      },
    },
  },
  event: {
    col: 'events', cmd: 'ev', prefix: 'e', label: 'event',
    fields: {
      title: { aliases: ['name', 'text'], parse: text(200), raw: (x) => x.title },
      date: {
        aliases: ['day'],
        raw: (x) => x.date,
        parse(v, env) {
          const d = parseDate(v.trim(), env.now());
          return d ? { value: d } : { error: "can't read the date '" + v.trim() + "'" };
        },
      },
      time: {
        aliases: [],
        raw: (x) => x.time || 'none',
        parse(v) {
          const s = v.trim();
          if (NONE.test(s) || /^all[\s-]?day$/i.test(s)) return { value: null };
          const t = parseTime(s);
          return t ? { value: t } : { error: "can't read the time '" + s + "' (24-hour HH:MM, or none for all day)" };
        },
      },
    },
  },
  alias: {
    col: 'aliases', cmd: 'alias', label: 'alias',
    fields: {
      name: { aliases: [], raw: (x) => x.name, parse: (v) => ({ value: v.trim().toLowerCase() }) },
      base: { aliases: ['url'], raw: (x) => x.base, parse: (v) => ({ value: v.trim() }) },
      template: {
        aliases: ['search', 'tpl'],
        raw: (x) => x.template || 'none',
        parse: (v) => ({ value: NONE.test(v.trim()) ? null : v.trim() }),
      },
      escape: {
        aliases: [],
        raw: (x) => x.escape,
        parse(v) {
          const s = v.trim().toLowerCase();
          return s === 'query' || s === 'path' ? { value: s } : { error: 'is query or path' };
        },
      },
    },
  },
};

// The canonical field name for `name` (or one of its aliases), or null.
export function fieldName(kind, name) {
  const f = String(name).toLowerCase();
  const fields = KINDS[kind].fields;
  if (fields[f]) return f;
  return Object.keys(fields).find((k) => fields[k].aliases.includes(f)) || null;
}

// `<target>.<field> <value>` -> { target, field, value } or null when the
// shape doesn't match (so the words can mean something else).
export function parseFieldEdit(rest) {
  const m = /^(\S+?)\.([a-z]+)(?:\s+([\s\S]*))?$/i.exec(rest.trim());
  if (!m) return null;
  return { target: m[1], field: m[2], value: m[3] === undefined ? null : oneValue(m[3]) };
}

// The record a target names: an id (n3 / 3) for notes, tasks and events, a
// name for aliases.
export function findRecord(kind, state, target) {
  const k = KINDS[kind];
  if (kind === 'alias') return state.aliases.entries.find((e) => e.name === String(target).toLowerCase()) || null;
  const id = parseId(k.prefix, target);
  return id ? state[k.col].items.find((x) => x.id === id) || null : null;
}

// Checks `value` for `field` and returns { item } (a changed copy) or { error }.
// env: { now(), isBuiltin(name), state }
export function applyField(kind, item, field, value, env) {
  const spec = KINDS[kind].fields[field];
  const r = spec.parse(String(value), env);
  if (r.error) return { error: field + ' ' + r.error };
  const next = JSON.parse(JSON.stringify(item));
  if (spec.apply) spec.apply(next, r.value, env);
  else next[field] = r.value;
  if (kind === 'event' && !parseISO(next.date)) return { error: 'date is not valid' };
  if (kind !== 'alias') return { item: next };

  // Aliases are checked as a whole, with the same rules as `alias set`.
  if (next.template === null) delete next.template;
  const v = validateEntry(next, env.isBuiltin);
  if (v.error) return { error: v.error };
  const doc = env.state.aliases;
  if (v.entry.name !== item.name && doc.entries.some((e) => e.name === v.entry.name)) {
    return { error: "alias '" + v.entry.name + "' already exists" };
  }
  if (item.name === doc.defaultEngine && !v.entry.template) {
    return { error: "'" + item.name + "' is the default engine and needs a template" };
  }
  if (v.entry.escape === 'path' && !v.entry.template) v.entry.escape = 'query';
  return { item: v.entry };
}
