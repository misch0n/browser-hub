import { addDays, byIdNum, cmp } from './util.js';

// Open before done, then by due date (undated last), then by id.
export function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (a.done ? 1 : 0) - (b.done ? 1 : 0) || cmp(a.due || '9999', b.due || '9999') || byIdNum(a, b));
}

export const sortEvents = (a, b) => cmp(a.date, b.date) || cmp(a.time || '', b.time || '') || byIdNum(a, b);

// Overdue open tasks, then every day in [today, today + n) that has events or due tasks.
export function agenda(state, today, n) {
  const open = state.tasks.items.filter((t) => !t.done && t.due);
  const overdue = open.filter((t) => t.due < today).sort((a, b) => cmp(a.due, b.due) || byIdNum(a, b));
  const days = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i);
    const events = state.events.items.filter((e) => e.date === date).sort(sortEvents);
    const tasks = open.filter((t) => t.due === date).sort(byIdNum);
    if (events.length || tasks.length) days.push({ date, offset: i, events, tasks });
  }
  return { overdue, days };
}

// Days of the month (1-31) that have at least one event.
export function eventDays(state, year, month) {
  const prefix = year + '-' + String(month).padStart(2, '0') + '-';
  return [...new Set(state.events.items.filter((e) => e.date.startsWith(prefix)).map((e) => +e.date.slice(8)))];
}
