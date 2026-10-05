import { h, rich } from './dom.js';
import { monthGrid } from './components.js';
import { WIDGETS, EXPORT_REMINDER_DAYS } from '../core/catalog.js';
import { todayISO, toISO, pad2, truncate, firstLine, byIdNum, plural, daysBetween } from '../core/util.js';
import { MONTH_NAMES, DAY_NAMES_LONG, dayLabel, shortDate, dueSeg, bytes } from '../core/format.js';
import { agenda, eventDays, sortTasks } from '../core/agenda.js';
import { localZone, zoneRows, workOverlap, zoneLabel } from '../lib/zones.js';

const empty = (text) => h('div', { class: 'w-empty', text });
const row = (...cells) => h('div', { class: 'w-row' }, ...cells.map((c) => h('span', null, rich(c))));

// Each widget: { title, meta?(c) -> segments, render(c) -> Node, every: 'second' | 'minute' }
// c = { state, now, today, run(command), setInput(text), store }
const RENDERERS = {
  clock: {
    title: 'Clock',
    every: 'second',
    render({ now }) {
      const week = isoWeek(now);
      return h('div', { class: 'w-clock' },
        h('div', { class: 'w-time' },
          h('span', { class: 't-strong', text: pad2(now.getHours()) + ':' + pad2(now.getMinutes()) }),
          h('span', { class: 'w-sec t-faint', text: ':' + pad2(now.getSeconds()) })),
        h('div', { class: 'w-date' }, rich([[DAY_NAMES_LONG[now.getDay()], 'accent'], [' ' + now.getDate() + ' ' + MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear(), '']])),
        h('div', { class: 'w-sub' }, rich([['week ' + week, 'dim'], [' · ' + localZone(), 'faint']])));
    },
  },

  agenda: {
    title: 'Agenda',
    every: 'minute',
    meta({ state, today }) {
      const a = agenda(state, today, 7);
      return a.overdue.length ? [[a.overdue.length + ' overdue', 'err']] : [['7 days', 'faint']];
    },
    render({ state, today, run }) {
      const a = agenda(state, today, 7);
      if (!a.overdue.length && !a.days.length) return empty('Nothing this week');
      const box = h('div', { class: 'w-list' });
      let shown = 0;
      const MAX = 12;
      if (a.overdue.length) {
        box.appendChild(h('div', { class: 'w-group t-err', text: 'Overdue' }));
        for (const t of a.overdue.slice(0, 4)) {
          box.appendChild(row([[shortDate(t.due, today), 'err']], [[t.text, '']]));
          shown++;
        }
      }
      for (const d of a.days) {
        if (shown >= MAX) break;
        const label = dayLabel(d.date, today);
        box.appendChild(h('div', { class: 'w-group' }, rich(label === 'today' || label === 'tomorrow'
          ? [[label[0].toUpperCase() + label.slice(1), 'accent']] : [[shortDate(d.date, today), 'date']])));
        for (const e of d.events) { box.appendChild(row([[e.time || 'all day', e.time ? 'num' : 'faint']], [[e.title, '']])); shown++; }
        for (const t of d.tasks) { box.appendChild(row([['task due', 'warn']], [[t.text, '']])); shown++; }
      }
      box.appendChild(h('button', { class: 'w-link', type: 'button', text: 'agenda 30 →', onclick: () => run('agenda 30') }));
      return box;
    },
  },

  tasks: {
    title: 'Tasks',
    every: 'minute',
    meta({ state }) {
      const open = state.tasks.items.filter((t) => !t.done).length;
      return [[open + ' open', 'faint']];
    },
    render({ state, today, run }) {
      const open = sortTasks(state.tasks.items.filter((t) => !t.done));
      if (!open.length) return empty('All done ✓');
      const box = h('ul', { class: 'w-tasks' });
      for (const t of open.slice(0, 10)) {
        const due = t.due ? dueSeg(t.due, today) : null;
        box.appendChild(h('li', null,
          h('button', { class: 'w-check', type: 'button', title: 'Complete ' + t.id, 'aria-label': 'Complete ' + t.text, onclick: () => run('t done ' + t.id) }),
          h('span', { class: 'w-task-text' }, rich([[t.text, '']])),
          due ? h('span', { class: 'w-task-due' }, rich([due])) : null));
      }
      if (open.length > 10) box.appendChild(h('li', { class: 'w-more' }, h('button', { class: 'w-link', type: 'button', text: '+' + (open.length - 10) + ' more →', onclick: () => run('tasks') })));
      return box;
    },
  },

  calendar: {
    title: 'Calendar',
    every: 'minute',
    meta({ now }) { return [[MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear(), 'faint']]; },
    render({ state, now, today, run }) {
      const year = now.getFullYear(), month = now.getMonth() + 1;
      const grid = monthGrid({ year, month, today, marks: eventDays(state, year, month) });
      grid.classList.add('cal-small');
      return h('div', null, grid, h('button', { class: 'w-link', type: 'button', text: 'cal →', onclick: () => run('cal') }));
    },
  },

  zones: {
    title: 'Time zones',
    every: 'second',
    render({ state, now }) {
      const local = localZone();
      const zones = [local].concat(state.settings.zones.filter((z) => z !== local));
      const rows = zoneRows(now, zones);
      const box = h('div', { class: 'w-list' });
      rows.forEach((r) => {
        box.appendChild(h('div', { class: 'w-zone', title: r.zone + ' · UTC' + r.offset },
          h('span', { class: 'w-dot ' + (r.working ? 't-ok' : 't-faint'), text: r.working ? '●' : '○' }),
          h('span', { class: 'w-zone-name ' + (r.ref ? 't-accent' : ''), text: zoneLabel(r.zone, state.settings.zoneNames) }),
          h('span', { class: 'w-zone-day t-warn', text: r.date }),
          h('span', { class: 'w-zone-time t-num', text: r.time })));
      });
      if (zones.length === 1) box.appendChild(empty('Add zones: tz add <zone> [name]'));
      else {
        const o = workOverlap(now, zones);
        box.appendChild(h('div', { class: 'w-sub' }, rich([['overlap ', 'faint'], [o.length ? o.join(', ') : 'none', o.length ? 'ok' : 'dim']])));
      }
      return box;
    },
  },

  notes: {
    title: 'Notes',
    every: 'minute',
    meta({ state }) { return [[String(state.notes.items.length), 'faint']]; },
    render({ state, setInput }) {
      const list = state.notes.items.slice().sort((a, b) => byIdNum(b, a)).slice(0, 6);
      if (!list.length) return empty('No notes · n <text>');
      return h('ul', { class: 'w-notes' }, ...list.map((n) => h('li', null,
        h('button', { class: 'w-note', type: 'button', title: 'Edit ' + n.id, onclick: () => setInput('n edit ' + n.id + ': ' + n.text) },
          h('span', { class: 't-id', text: n.id }), ' ', h('span', { text: truncate(firstLine(n.text), 80) })))));
    },
  },

  backup: {
    title: 'Backup',
    every: 'minute',
    render({ state, today, run, usage }) {
      const last = state.meta.lastExport;
      const age = last ? daysBetween(toISO(new Date(last)), today) : null;
      const tone = age === null ? 'warn' : age >= EXPORT_REMINDER_DAYS ? 'warn' : 'ok';
      const c = (k) => state[k].items.length;
      return h('div', { class: 'w-list' },
        row([['export', 'dim']], [[last ? (age === 0 ? 'today' : plural(age, 'day') + ' ago') : 'never', tone]]),
        row([['data', 'dim']], [[c('notes') + ' notes · ' + c('tasks') + ' tasks · ' + c('events') + ' events', '']]),
        row([['storage', 'dim']], [[usage === null ? 'unknown' : bytes(usage), 'num']]),
        h('button', { class: 'w-link', type: 'button', text: 'export now →', onclick: () => run('export') }));
    },
  },
};

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

// Renders the enabled widgets into `listEl` and keeps them current.
// opts: { listEl, data, store, now(), run(command), setInput(text), onClose(id) }
export function createWidgets(opts) {
  const cards = new Map(); // id -> { el, body, meta }
  let usage = null;

  function context() {
    const now = opts.now();
    return { state: opts.data.state, now, today: todayISO(now), run: opts.run, setInput: opts.setInput, usage };
  }

  function card(id) {
    const r = RENDERERS[id];
    const meta = h('span', { class: 'w-meta' });
    const body = h('div', { class: 'w-body' });
    const close = h('button', { class: 'w-close', type: 'button', title: 'Hide ' + id, 'aria-label': 'Hide ' + id + ' widget', text: '×', onclick: () => opts.onClose(id) });
    const el = h('section', { class: 'widget', 'data-widget': id },
      h('header', { class: 'w-head' }, h('span', { class: 'w-title', text: r.title }), meta, close), body);
    return { el, body, meta };
  }

  function paint(id, c) {
    const r = RENDERERS[id];
    const k = cards.get(id);
    k.body.textContent = '';
    try {
      k.body.appendChild(r.render(c));
      k.meta.textContent = '';
      if (r.meta) k.meta.appendChild(rich(r.meta(c)));
    } catch (e) {
      k.body.appendChild(empty('Could not render: ' + e.message));
    }
  }

  // Full re-render: called when data or the enabled list changes.
  function render() {
    const enabled = opts.data.state.settings.widgets.filter((id) => RENDERERS[id]);
    for (const [id, k] of cards) {
      if (!enabled.includes(id)) { k.el.remove(); cards.delete(id); }
    }
    const c = context();
    enabled.forEach((id) => {
      if (!cards.has(id)) cards.set(id, card(id));
      opts.listEl.appendChild(cards.get(id).el); // also applies the stored order
      paint(id, c);
    });
    if (!enabled.length) {
      if (!opts.listEl.querySelector('.w-none')) {
        opts.listEl.appendChild(h('div', { class: 'w-none' }, rich([['No widgets on. ', 'dim'], ['widgets', 'accent'], [' lists them, ', 'dim'], ['widgets clock', 'accent'], [' turns one on.', 'dim']])));
      }
    } else {
      const none = opts.listEl.querySelector('.w-none');
      if (none) none.remove();
    }
    if (enabled.includes('backup') && opts.store.usage) {
      opts.store.usage().then((u) => {
        if (u !== usage) { usage = u; if (cards.has('backup')) paint('backup', context()); }
      }, () => {});
    }
  }

  // Clock-driven refresh: every second for 'second' widgets, at minute change for the rest.
  let lastMinute = -1;
  function tick() {
    const c = context();
    const minute = Math.floor(c.now.getTime() / 60000);
    for (const id of cards.keys()) {
      if (RENDERERS[id].every === 'second' || minute !== lastMinute) paint(id, c);
    }
    lastMinute = minute;
  }

  let timer = null;
  function start() {
    if (timer) return;
    const loop = () => {
      tick();
      timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    };
    timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
  }
  function stop() { clearTimeout(timer); timer = null; }

  return { render, tick, start, stop, ids: WIDGETS.map((w) => w.id) };
}
