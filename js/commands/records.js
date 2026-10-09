import { KINDS, fieldName, fieldsOfItem, parseFieldEdit, findRecord, applyField } from '../core/records.js';
import { parseId, todayISO } from '../core/util.js';
import { dueSeg, tagSegs, dayLabel, longDate } from '../core/format.js';
import { repeatLabel, nextOn } from '../core/repeat.js';
import { nextBirthday } from '../core/personal.js';
import { oneValue } from '../core/args.js';

// One grammar for everything you keep: notes, tasks, events, snippets, links to read later,
// your foods, diagrams and aliases (zones and widgets bring their own adapters).
//
//   tasks                          list them
//   tasks add <text>               add one
//   tasks t3                       show one, fields tappable
//   tasks t3 edit                  edit it in place
//   tasks t3 edit due fri          change one field (edit due: the current value in the prompt)
//   tasks t3 rm                    remove it
//   tasks t3 done                  verbs of its own (tasks: done)
//
// Each also has a short name that does the same, and adds when given plain
// text: t, n, ev, alias (t buy milk = tasks add buy milk). Tapping a value in
// the output runs the matching `edit` command, so the transcript and history
// show exactly what changed.

export const NOUNS = {
  note: { noun: 'notes', short: 'n', one: 'note' },
  task: { noun: 'tasks', short: 't', one: 'task' },
  event: { noun: 'events', short: 'ev', one: 'event' },
  snippet: { noun: 'snippets', short: 'snip', one: 'snippet' },
  link: { noun: 'later', short: 'later', one: 'link' },
  food: { noun: 'cook calorie', short: 'cook calorie', one: 'food' },
  diagram: { noun: 'diagrams', short: 'diagrams', one: 'diagram' },
  birthday: { noun: 'birthdays', short: 'birthdays', one: 'birthday' },
  list: { noun: 'lists', short: 'lists', one: 'list' },
  sub: { noun: 'subs', short: 'subs', one: 'subscription' },
  entry: { noun: 'log', short: 'log', one: 'journal entry' },
  meal: { noun: 'eat', short: 'eat', one: 'meal' },
  alias: { noun: 'aliases', short: 'alias', one: 'alias' },
};

const firstCodeLine = (code) => (code.split('\n').find((l) => l.trim() && !/^\s*%%/.test(l)) || '').trim().slice(0, 60);

const keyOf = (kind, item) => (kind === 'alias' ? item.name : item.id);
export const refOf = (kind, item) => NOUNS[kind].noun + ' ' + keyOf(kind, item);

function display(kind, field, item, today) {
  const none = [['none', 'faint']];
  switch (kind + '.' + field) {
    case 'task.due': return item.due ? [dueSeg(item.due, today, item.done)] : none;
    case 'task.tags': return item.tags.length ? tagSegs(item.tags).flatMap((s, i) => (i ? [[' ', ''], s] : [s])) : none;
    case 'task.done': return item.done ? [['✓ done', 'ok']] : [['○ open', 'dim']];
    case 'task.repeat': return item.repeat ? [['↻ ' + repeatLabel(item.repeat), '']] : none;
    case 'event.date': return [[longDate(item.date, today), 'date'], [' · ' + dayLabel(item.date, today), 'faint']];
    case 'event.time': return item.time ? [[item.time, 'num']] : [['all day', 'faint']];
    case 'event.repeat': return item.repeat ? [['↻ ' + repeatLabel(item.repeat), '']] : none;
    case 'birthday.date': {
      const n = nextBirthday(item, today);
      return [[longDate(n.date, today).replace(/ \d{4}$/, ''), 'date'], [item.year ? ' ' + item.year : '', 'dim'],
        [' · ' + (n.age !== null ? 'turns ' + n.age + ' ' : '') + (n.days === 0 ? 'today' : 'in ' + n.days + (n.days === 1 ? ' day' : ' days')), 'faint']];
    }
    case 'sub.price': return [[item.price.toFixed(2), 'num']];
    case 'sub.every': return [['↻ ' + repeatLabel(item.every), '']];
    case 'sub.next': {
      const n = nextOn(item.every, item.next, today);
      return [[longDate(n, today), 'date'], [' · ' + dayLabel(n, today), 'faint']];
    }
    case 'entry.date': return [[longDate(item.date, today), 'date'], [' · ' + dayLabel(item.date, today), 'faint']];
    case 'meal.grams': return [[String(Math.round(item.grams * 10) / 10) + ' g', 'num'], [item.label ? ' · ' + item.label : '', 'dim']];
    case 'meal.date': return [[longDate(item.date, today), 'date']];
    case 'meal.time': return item.time ? [[item.time, 'num']] : none;
    case 'snippet.name': return [[item.name, 'accent']];
    case 'food.name': return [[item.name, 'strong']];
    case 'diagram.name': return [[item.name, 'strong']];
    case 'diagram.code': return [[firstCodeLine(item.code), 'pre'], ['  ' + item.code.split('\n').length + ' lines · tap for the live editor', 'faint']];
    case 'food.kcal': return [[item.kcal + ' kcal', 'num'], [' per 100 g', 'faint']];
    case 'food.protein': case 'food.fat': case 'food.carbs': case 'food.sugar': case 'food.fiber': case 'food.sat': case 'food.salt':
      return item[field] === null || item[field] === undefined ? none : [[item[field] + ' g', 'num']];
    case 'food.portion': return item.portionG ? [[item.portionName + ' = ' + item.portionG + ' g', '']] : none;
    case 'link.url': return [[item.url, 'url']];
    case 'link.title': return item.title ? [[item.title, 'strong']] : none;
    case 'link.read': return item.read ? [['✓ read', 'ok']] : [['○ unread', 'dim']];
    case 'alias.base': return [[item.base, 'url']];
    case 'alias.template': return item.template ? [[item.template, 'url']] : none;
    case 'alias.escape': return [[item.escape, 'dim']];
    case 'alias.name': return [[item.name, 'accent']];
    case 'alias.command': return [[item.command, 'strong']];
    default: return [[String(item[field]), 'pre']]; // line breaks kept
  }
}

const num1 = (v) => (typeof v === 'number' ? String(Math.round(v * 10) / 10) : '–');

// Read-only rows shown under the editable ones.
function extras(kind, item, today) {
  const when = (iso) => [[dayLabel(todayISO(new Date(iso)), today), 'dim']];
  if (kind === 'note' || kind === 'snippet' || kind === 'food' || kind === 'diagram') return [['created', when(item.created)], ['updated', when(item.updated)]];
  if (kind === 'link') return [['added', when(item.created)], ...(item.read && item.readAt ? [['read', when(item.readAt)]] : [])];
  if (kind === 'task') {
    const rows = [['created', when(item.created)]];
    if (item.repeat && item.lastDone) rows.push(['last done', [...when(item.lastDone), [' · ' + (item.doneCount || 1) + '×', 'faint']]]);
    return rows;
  }
  if (kind === 'meal') {
    return [['food', [[item.food, 'strong']]], ['energy', [[Math.round(item.kcal) + ' kcal', 'num'],
      [' · protein ' + num1(item.protein) + ' g · fat ' + num1(item.fat) + ' g · carbs ' + num1(item.carbs) + ' g', 'dim']]]];
  }
  if (kind === 'birthday' || kind === 'list' || kind === 'sub' || kind === 'entry') return [['added', when(item.created)]];
  if (kind === 'event' && item.repeat) {
    const next = nextOn(item.repeat, item.date, today);
    return [['next', [[longDate(next, today), 'date'], [' · ' + dayLabel(next, today), 'faint']]], ['series', [['edits and removal apply to every occurrence', 'faint']]]];
  }
  return [];
}

export function createRecords({ st, isBuiltin }) {
  const label = (kind) => KINDS[kind].label;
  const fieldsOf = (kind) => Object.keys(KINDS[kind].fields);
  const verbsOf = (kind, own) => ['edit', ...Object.keys(own || {}), 'rm'];

  // Prints one entry with its fields; opts: { head, open: field to start editing in place }.
  function show(ctx, kind, item, opts = {}) {
    const { out } = ctx;
    const k = KINDS[kind];
    const ref = refOf(kind, item);
    const today = todayISO(ctx.now());
    out.head(opts.head || [[label(kind) + ' ', 'dim'], [keyOf(kind, item), kind === 'alias' ? 'accent' : 'id']]);
    out.fields([
      ...fieldsOfItem(kind, item).map((f) => [f, display(kind, f, item, today),
        { command: ref + ' edit ' + f, current: k.fields[f].raw(item), open: opts.open === f }]),
      ...extras(kind, item, today),
    ]);
    out.dim('Tap a value to change it, or: ' + ref + ' edit <field> <value>');
  }

  // Sets one field (value as typed: one quoted argument is unquoted).
  async function setField(ctx, kind, item, fieldArg, value) {
    const { out } = ctx;
    const k = KINDS[kind];
    const field = fieldName(kind, fieldArg);
    if (!field || !fieldsOfItem(kind, item).includes(field)) {
      out.err((item.command ? 'Aliases that run a command' : label(kind)[0].toUpperCase() + label(kind).slice(1) + 's') + ' have no field ' + fieldArg);
      out.dim('Fields: ' + fieldsOfItem(kind, item).join(', '));
      return;
    }
    const ref = refOf(kind, item);
    if (value === null) {
      // No value: the command with the current value, in the prompt.
      ctx.setInput(ref + ' edit ' + field + ' ' + k.fields[field].raw(item));
      out.head([['Editing ', ''], [ref + ' ' + field, 'id']], 'info');
      out.dim('Change the value and press Enter · Esc cancels');
      return;
    }
    const r = applyField(kind, item, field, value, { now: ctx.now, isBuiltin, state: st() });
    if (r.error) return out.err(r.error);
    const key = keyOf(kind, item);
    let saved = null;
    await ctx.data.mutate(k.col, (d) => {
      if (kind === 'alias') {
        const i = d.entries.findIndex((e) => e.name === key);
        if (i < 0) return;
        d.entries[i] = r.item;
        if (d.defaultEngine === key) d.defaultEngine = r.item.name; // a rename keeps the default
        saved = r.item;
        return;
      }
      const i = d.items.findIndex((x) => x.id === key);
      if (i < 0) return;
      // Replace, not merge: a cleared field (repeat none) must go.
      d.items[i] = r.item;
      if (kind === 'note' || kind === 'snippet' || kind === 'food' || kind === 'diagram') d.items[i].updated = ctx.now().toISOString();
      saved = d.items[i];
    });
    if (!saved) return out.err('No ' + label(kind) + ' ' + key);
    show(ctx, kind, saved, { head: [['Updated ', ''], [refOf(kind, saved) + ' ' + field, kind === 'alias' ? 'accent' : 'id']] });
    out.tone('ok');
  }

  async function remove(ctx, kind, item) {
    const { out } = ctx;
    const key = keyOf(kind, item);
    if (kind === 'alias') {
      if (key === st().aliases.defaultEngine) {
        out.err("'" + key + "' is the default engine");
        out.dim('Choose another first: engine default <name>');
        return;
      }
      await ctx.data.mutate('aliases', (d) => { d.entries = d.entries.filter((x) => x.name !== key); });
      return out.head([['Removed ', ''], [key, 'accent']], 'ok');
    }
    await ctx.data.mutate(KINDS[kind].col, (d) => { d.items = d.items.filter((x) => x.id !== key); });
    out.head([['Removed ' + label(kind) + ' ', ''], [key, 'id'], [kind === 'event' && item.repeat ? ' · the whole series (' + repeatLabel(item.repeat) + ')' : '', 'dim']], 'ok');
    out.line(kind === 'link' ? item.title || item.url : item.name || item.food || item.text || item.title, 'gone');
  }

  // The entry `word` names: an id for notes, tasks and events (t3, or just 3
  // when `bare` is allowed), a name for aliases. -> { item } | { missing } | null
  function target(kind, word, bare) {
    if (!word) return null;
    if (kind === 'alias') {
      const item = findRecord(kind, st(), word);
      return item ? { item } : null;
    }
    const prefix = KINDS[kind].prefix;
    if ((kind === 'snippet' && !/^s?\d+$/i.test(word)) || (kind === 'list' && !/^c?\d+$/i.test(word))) { // snippets and lists also go by name
      const item = findRecord(kind, st(), word);
      return item ? { item } : null;
    }
    if (!new RegExp('^' + prefix + '\\d+$', 'i').test(word) && !(bare && /^\d+$/.test(word))) return null;
    const item = findRecord(kind, st(), word);
    return item ? { item } : { missing: parseId(prefix, word) };
  }

  // The grammar, for anything described by an adapter:
  //   { noun, label, target(word, bare) -> { item } | { missing } | null, key(item),
  //     fields: [names], show(ctx, item, opts), setField(ctx, item, field, value | null),
  //     remove(ctx, item), ids() -> [{ value, label }] }
  // Notes, tasks, events and aliases get theirs from adapterFor(); time zones
  // and widgets bring their own.
  function adapterFor(kind) {
    return {
      noun: NOUNS[kind].noun, label: label(kind), fields: fieldsOf(kind), fieldsFor: (item) => fieldsOfItem(kind, item),
      target: (word, bare) => target(kind, word, bare),
      key: (item) => keyOf(kind, item),
      show: (ctx, item, opts) => show(ctx, kind, item, opts),
      setField: (ctx, item, field, value) => setField(ctx, kind, item, field, value),
      remove: (ctx, item) => remove(ctx, kind, item),
      ids: () => (kind === 'alias'
        ? st().aliases.entries.map((e) => ({ value: e.name, label: e.command ? 'runs ' + e.command : e.template ? 'engine' : 'alias' }))
        : kind === 'snippet' ? st().snippets.items.map((x) => ({ value: x.name, label: x.text.split('\n')[0].slice(0, 50) }))
          : kind === 'list' ? st().lists.items.map((x) => ({ value: x.name, label: x.entries.length + ' items' }))
          : st()[KINDS[kind].col].items.map((x) => ({ value: x.id, label: (x.text || x.title || x.url || x.name || x.food || '').slice(0, 50) }))),
    };
  }
  const asAdapter = (kindOrAdapter) => (typeof kindOrAdapter === 'string' ? adapterFor(kindOrAdapter) : kindOrAdapter);

  // Routes `<noun> …`, or its short name with spec.short set.
  // spec: { short?, list(ctx, rest), add(ctx, rest), verbs?: { name: (ctx, item, rest) }, show?(ctx, item) }
  async function route(ctx, kindOrAdapter, rest, spec) {
    const A = asAdapter(kindOrAdapter);
    const { out } = ctx;
    const text = rest.trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return spec.list(ctx, '');
    if (words[0].toLowerCase() === 'add') return spec.add(ctx, text.slice(3).trim());

    // <key>.<field> <value>: the dot form, still understood.
    const dot = parseFieldEdit(text);
    const dotTarget = dot && A.target(dot.target, !spec.short);
    if (dotTarget && dotTarget.item) return A.setField(ctx, dotTarget.item, dot.field, dot.value);

    const t = A.target(words[0], !spec.short);
    const verb = (words[1] || '').toLowerCase();
    const verbs = ['edit', ...Object.keys(spec.verbs || {}), 'rm'];
    // With the short name, `t t3 something` is still task text unless `something` is a verb.
    const isItem = t && (!spec.short || !words[1] || verbs.includes(verb) || verb === 'show');
    if (!isItem) return spec.short ? spec.add(ctx, text) : spec.list(ctx, text);
    if (t.missing) return out.err('No ' + A.label + ' ' + t.missing);
    const item = t.item;
    const key = A.key(item);
    // The raw text after the first i words.
    const after = (i) => {
      let s = text;
      for (let k = 0; k < i; k++) s = s.replace(/^\s*\S+/, '');
      return s.trim();
    };
    if (!verb || verb === 'show') return spec.show ? spec.show(ctx, item) : A.show(ctx, item);
    if (verb === 'edit') {
      const field = words[2];
      if (!field) {
        return A.show(ctx, item, { open: A.fields[0],
          head: [['Editing ', ''], [A.noun + ' ' + key, 'id'], [' · tap any value, Enter saves, Esc leaves it', 'dim']] });
      }
      const v = after(3);
      return A.setField(ctx, item, field, v ? oneValue(v) : null);
    }
    if (verb === 'rm' || verb === 'remove' || verb === 'delete') return A.remove(ctx, item);
    if (spec.verbs && spec.verbs[verb]) return spec.verbs[verb](ctx, item, after(2));
    out.err(A.noun + ' ' + key + ': no action ' + words[1]);
    out.dim('Try: ' + verbs.map((v) => A.noun + ' ' + key + ' ' + v).join(' · '));
  }

  // Tab completion for `<noun> …`: ids, then actions, then field names.
  function complete(kindOrAdapter, prev, spec = {}) {
    const A = asAdapter(kindOrAdapter);
    if (prev.length === 0) return [{ value: 'add' }, ...(spec.first || []), ...A.ids()];
    const t = A.target(prev[0], true);
    if (prev.length === 1 && t && t.item) return ['edit', ...Object.keys(spec.verbs || {}), 'rm'].map((v) => ({ value: v }));
    if (prev.length === 2 && prev[1] === 'edit' && t && t.item) return (A.fieldsFor ? A.fieldsFor(t.item) : A.fields).map((f) => ({ value: f }));
    return [];
  }

  // Usage lines, all in the same shape.
  function usageFor(kindOrAdapter, spec) {
    const A = asAdapter(kindOrAdapter);
    const id = spec.id || (kindOrAdapter === 'alias' ? '<name>' : '<id>');
    return [
      A.noun + (spec.filter ? ' ' + spec.filter : ''),
      A.noun + ' add ' + spec.addArgs,
      A.noun + ' ' + id,
      A.noun + ' ' + id + ' edit [<field> [<value>]]',
      ...(spec.verbUsage || Object.keys(spec.verbs || {})).map((v) => A.noun + ' ' + id + ' ' + v),
      A.noun + ' ' + id + ' rm',
    ];
  }

  // The older verb-first forms (t done t3, n rm n2, ev show e1, alias edit
  // gh.template …) rewritten to the shared order, so they keep working.
  // Only exact shapes: `t done laundry` stays task text. -> rest or null
  function legacy(kind, rest, verbs = []) {
    const words = rest.trim().split(/\s+/);
    const verb = (words[0] || '').toLowerCase();
    if (!['show', 'edit', 'rm', ...verbs].includes(verb)) return null;
    const second = words[1] || '';
    const dot = /^([^.\s]+)\.[a-z]+$/i.exec(second);
    const keyFor = (w) => { const t = target(kind, w, true); return t ? (t.item ? keyOf(kind, t.item) : t.missing) : null; };
    if (verb === 'edit' && dot && keyFor(dot[1])) return keyFor(dot[1]) + rest.trim().replace(/^\S+\s+[^.\s]+/, '');
    if (words.length !== 2 || !keyFor(second)) return null;
    return verb === 'show' ? keyFor(second) : keyFor(second) + ' ' + verb;
  }

  return { show, setField, remove, route, complete, usageFor, target, fieldsOf, legacy, adapterFor };
}
