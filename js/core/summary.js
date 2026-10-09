// The daily summary: what is overdue, due and on today, and a glance at
// tomorrow. Shown pinned at the top of the page on every device until it is
// dismissed for the day (settings.summaryDismissed, synced with the rest of
// the settings), and printed by `today`.

import { agenda } from './agenda.js';
import { dayLabel } from './format.js';

export function daySummary(state, today) {
  const a = agenda(state, today, 2);
  const day = (i) => a.days.find((d) => d.offset === i) || { events: [], tasks: [] };
  return {
    today,
    overdue: a.overdue,
    events: day(0).events,
    due: day(0).tasks,
    tomorrow: { events: day(1).events.length, tasks: day(1).tasks.length },
  };
}

export const summaryVisible = (settings, today) => settings.summary !== 'off' && settings.summaryDismissed !== today;

// Rows of rich segments, most pressing first: overdue, today's events, due today.
export function summaryRows(sum) {
  const rows = [];
  for (const t of sum.overdue) {
    rows.push([[dayLabel(t.due, sum.today), 'err'], ['  ', ''], [t.id, 'id', { run: 'tasks ' + t.id }], ['  ' + t.text, '']]);
  }
  for (const e of sum.events) {
    rows.push([[e.time || 'all day', e.time ? 'num' : 'faint'], ['  ', ''], [e.id, 'id', { run: e.run || 'events ' + e.id }], ['  ' + e.title, '']]);
  }
  for (const t of sum.due) {
    rows.push([['due today', 'warn'], ['  ', ''], [t.id, 'id', { run: 'tasks ' + t.id }], ['  ' + t.text, ''], [t.repeat ? '  ↻' : '', 'faint']]);
  }
  return rows;
}

// '2 overdue · 1 event · 3 due' or '' when the day is clear.
export function summaryCounts(sum) {
  const parts = [];
  if (sum.overdue.length) parts.push([sum.overdue.length + ' overdue', 'err']);
  if (sum.events.length) parts.push([sum.events.length + (sum.events.length === 1 ? ' event' : ' events'), 'date']);
  if (sum.due.length) parts.push([sum.due.length + ' due', 'warn']);
  return parts.flatMap((p, i) => (i ? [[' · ', 'faint'], p] : [p]));
}

export function tomorrowLine(sum) {
  const { events, tasks } = sum.tomorrow;
  if (!events && !tasks) return [['Tomorrow is clear', 'faint']];
  const parts = [];
  if (events) parts.push(events + (events === 1 ? ' event' : ' events'));
  if (tasks) parts.push(tasks + (tasks === 1 ? ' task due' : ' tasks due'));
  return [['Tomorrow: ' + parts.join(', '), 'faint']];
}
