import { addDays, byIdNum, cmp } from './util.js';
import { occursOn, nextOn } from './repeat.js';

// Open before done, then by due date (undated last), then by id.
export function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (a.done ? 1 : 0) - (b.done ? 1 : 0) || cmp(a.due || '9999', b.due || '9999') || byIdNum(a, b));
}

export const sortEvents = (a, b) => cmp(a.date, b.date) || cmp(a.time || '', b.time || '') || byIdNum(a, b);

// The events on one day. A recurring event appears as its occurrence on that
// day: the same item with `date` set to the day and `start` to the series' first.
export function eventsOn(state, date) {
  return state.events.items
    .filter((e) => (e.repeat ? occursOn(e.repeat, e.date, date) : e.date === date))
    .map((e) => (e.repeat ? { ...e, date, start: e.date } : e))
    .sort(sortEvents);
}

// Every occurrence in [from, to] (dates inclusive), in order.
export function eventsIn(state, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(...eventsOn(state, d));
  return out;
}

// The next occurrence of each event from `from` on (a one-off: itself, if not past).
export function upcoming(state, from) {
  return state.events.items
    .map((e) => (e.repeat ? { ...e, date: nextOn(e.repeat, e.date, from), start: e.date } : e))
    .filter((e) => e.date && e.date >= from)
    .sort(sortEvents);
}

// Overdue open tasks, then every day in [today, today + n) that has events or due tasks.
export function agenda(state, today, n) {
  const open = state.tasks.items.filter((t) => !t.done && t.due);
  const overdue = open.filter((t) => t.due < today).sort((a, b) => cmp(a.due, b.due) || byIdNum(a, b));
  const days = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i);
    const events = eventsOn(state, date);
    const tasks = open.filter((t) => t.due === date).sort(byIdNum);
    if (events.length || tasks.length) days.push({ date, offset: i, events, tasks });
  }
  return { overdue, days };
}

// Days of the month (1-31) that have at least one event.
export function eventDays(state, year, month) {
  const prefix = year + '-' + String(month).padStart(2, '0') + '-';
  const last = new Date(year, month, 0).getDate();
  return [...new Set(eventsIn(state, prefix + '01', prefix + String(last).padStart(2, '0')).map((e) => +e.date.slice(8)))];
}
