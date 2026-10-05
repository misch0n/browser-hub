import { KINDS, fieldName, parseFieldEdit, findRecord, applyField } from '../core/records.js';
import { parseId, todayISO } from '../core/util.js';
import { dueSeg, tagSegs, dayLabel, shortDate } from '../core/format.js';
import { repeatLabel } from '../core/repeat.js';

// Printing one record with editable fields, and the `<cmd> edit <key>.<field>
// <value>` command behind them. Tapping a value in the output fills in and
// runs that same command, so the transcript and history show exactly what
// changed: the page and the command line are two ways to type one thing.

const keyOf = (kind, item) => (kind === 'alias' ? item.name : item.id);

function display(kind, field, item, today) {
  const none = [['none', 'faint']];
  switch (kind + '.' + field) {
    case 'task.due': return item.due ? [dueSeg(item.due, today, item.done)] : none;
    case 'task.tags': return item.tags.length ? tagSegs(item.tags).flatMap((s, i) => (i ? [[' ', ''], s] : [s])) : none;
    case 'task.done': return item.done ? [['✓ done', 'ok']] : [['○ open', 'dim']];
    case 'task.repeat': return item.repeat ? [['↻ ' + repeatLabel(item.repeat), '']] : none;
    case 'event.date': return [[shortDate(item.date, today), 'date'], [' · ' + dayLabel(item.date, today), 'faint']];
    case 'event.time': return item.time ? [[item.time, 'num']] : [['all day', 'faint']];
    case 'alias.base': return [[item.base, 'url']];
    case 'alias.template': return item.template ? [[item.template, 'url']] : none;
    case 'alias.escape': return [[item.escape, 'dim']];
    case 'alias.name': return [[item.name, 'accent']];
    default: return [[String(item[field]), '']];
  }
}

// Read-only rows shown under the editable ones.
function extras(kind, item, today) {
  const when = (iso) => [[dayLabel(todayISO(new Date(iso)), today), 'dim']];
  if (kind === 'note') return [['created', when(item.created)], ['updated', when(item.updated)]];
  if (kind === 'task') {
    const rows = [['created', when(item.created)]];
    if (item.repeat && item.lastDone) rows.push(['last done', [...when(item.lastDone), [' · ' + (item.doneCount || 1) + '×', 'faint']]]);
    return rows;
  }
  return [];
}

export function createRecords({ st, isBuiltin }) {
  function show(ctx, kind, item, headSegs) {
    const { out } = ctx;
    const k = KINDS[kind];
    const key = keyOf(kind, item);
    const today = todayISO(ctx.now());
    out.head(headSegs || [[k.label + ' ', 'dim'], [key, kind === 'alias' ? 'accent' : 'id']]);
    out.fields([
      ...Object.keys(k.fields).map((f) => [f, display(kind, f, item, today), { command: k.cmd + ' edit ' + key + '.' + f, current: k.fields[f].raw(item) }]),
      ...extras(kind, item, today),
    ]);
    out.dim('Tap a value to change it, or: ' + k.cmd + ' edit ' + key + '.<field> <value>');
  }

  // Handles `edit <key>.<field> [value]` for `kind`. Returns false when `rest`
  // isn't in that shape (or names no record id), so the caller can treat the
  // words as something else, as `n` does with note text.
  async function edit(ctx, kind, rest) {
    const p = parseFieldEdit(rest);
    if (!p) return false;
    const k = KINDS[kind];
    if (kind !== 'alias' && !parseId(k.prefix, p.target)) return false;
    const { out } = ctx;
    const item = findRecord(kind, st(), p.target);
    if (!item) {
      out.err('No ' + k.label + ' ' + p.target);
      return true;
    }
    const field = fieldName(kind, p.field);
    if (!field) {
      out.err(k.label[0].toUpperCase() + k.label.slice(1) + 's have no field ' + p.field);
      out.dim('Fields: ' + Object.keys(k.fields).join(', '));
      return true;
    }
    if (p.value === null) {
      // No value: put the command with the current value in the prompt.
      ctx.setInput(k.cmd + ' edit ' + keyOf(kind, item) + '.' + field + ' ' + k.fields[field].raw(item));
      out.head([['Editing ', ''], [keyOf(kind, item) + '.' + field, 'id']], 'info');
      out.dim('Change the value and press Enter · Esc cancels');
      return true;
    }
    const env = { now: ctx.now, isBuiltin, state: st() };
    const r = applyField(kind, item, field, p.value, env);
    if (r.error) {
      out.err(r.error);
      return true;
    }
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
      if (kind === 'note') d.items[i].updated = ctx.now().toISOString();
      saved = d.items[i];
    });
    if (!saved) {
      out.err('No ' + k.label + ' ' + key);
      return true;
    }
    show(ctx, kind, saved, [['Updated ', ''], [key + '.' + field, kind === 'alias' ? 'accent' : 'id']]);
    out.tone('ok');
    return true;
  }

  function showCmd(ctx, kind, target) {
    const item = findRecord(kind, st(), target);
    if (!item) return ctx.out.err('No ' + KINDS[kind].label + ' ' + target);
    show(ctx, kind, item);
  }

  return { show, showCmd, edit };
}
